import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  AuthenticatedSession,
  CurrentUser,
  TwoFactorChallenge,
  TwoFactorSetup,
  TwoFactorSetupRequired,
} from '@samtec/contracts';
import { REFRESH_COOKIE_MAX_AGE_SECONDS } from '../../common/cookies.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthChallenge, User } from '../../generated/prisma/client.js';
import { AuditService } from './audit.service.js';
import { NO_SUCH_USER_HASH, verifyPassword } from './password.js';
import { SignInThrottleService } from './sign-in-throttle.service.js';
import { ACCESS_TOKEN_SECONDS, TokensService } from './tokens.service.js';
import { generateTotpSecret, otpauthUri, verifyTotpCode } from './totp.js';

/** A password challenge (enter your code) lasts 5 minutes. */
const CHALLENGE_MINUTES = 5;
/** A two-factor setup (scan the QR code) gets a little longer: 10 minutes. */
const SETUP_MINUTES = 10;
/** This many wrong codes cancel the challenge; sign in with the password again. */
const MAX_CODE_ATTEMPTS = 5;

/** The one message for every way a sign-in can be wrong, so nothing is revealed. */
const WRONG_CREDENTIALS = 'Email or password is incorrect.';
/** The one message for every dead or foreign challenge token. */
const CHALLENGE_GONE = 'This sign-in has expired. Sign in with your password again.';

/** What `login` can decide. The controller turns each kind into its HTTP shape. */
export type LoginOutcome =
  | { kind: 'session'; session: AuthenticatedSession; refreshToken: string }
  | { kind: 'challenge'; response: TwoFactorChallenge }
  | { kind: 'setup'; response: TwoFactorSetupRequired };

export interface RotatedSession {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
}

/**
 * All the sign-in flows, exactly as the contract describes them. Read the
 * contract's `/auth/*` descriptions first; this file is those promises as code.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly throttle: SignInThrottleService,
    private readonly audit: AuditService,
  ) {}

  async login(rawEmail: string, password: string): Promise<LoginOutcome> {
    const email = rawEmail.trim().toLowerCase();
    await this.throttle.assertNotLocked(email);

    const user = await this.prisma.user.findFirst({ where: { email } });
    // When the email has no account, still check the password against a
    // stand-in hash: both cases then cost the same time, so response timing
    // cannot reveal which emails have accounts.
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? NO_SUCH_USER_HASH);
    if (!user || !passwordOk || !user.isActive) {
      await this.throttle.recordFailure(email);
      throw new UnauthorizedException(WRONG_CREDENTIALS);
    }
    await this.throttle.recordSuccess(email);

    if (user.twoFactorEnabledAt) {
      const challengeToken = await this.issueChallenge(user, 'VERIFY_CODE', CHALLENGE_MINUTES);
      return {
        kind: 'challenge',
        response: {
          status: 'TWO_FACTOR_REQUIRED',
          challengeToken,
          expiresInSeconds: CHALLENGE_MINUTES * 60,
        },
      };
    }

    if (user.role === 'ADMIN' || user.role === 'HR_PAYROLL') {
      const setupToken = await this.issueChallenge(user, 'SET_UP', SETUP_MINUTES);
      return {
        kind: 'setup',
        response: {
          status: 'TWO_FACTOR_SETUP_REQUIRED',
          setupToken,
          expiresInSeconds: SETUP_MINUTES * 60,
        },
      };
    }

    return { kind: 'session', ...(await this.establishSession(user)) };
  }

  /** Step two of signing in for accounts that already use an authenticator app. */
  async verifyTwoFactor(
    challengeToken: string,
    code: string,
  ): Promise<{ session: AuthenticatedSession; refreshToken: string }> {
    const { challenge, user } = await this.loadChallenge(challengeToken, 'VERIFY_CODE');
    const secret = user.twoFactorSecretEncrypted
      ? this.tokens.decryptSecret(user.twoFactorSecretEncrypted)
      : null;
    if (!secret) {
      throw new UnauthorizedException(CHALLENGE_GONE);
    }

    const matchedStep = await this.checkCode(challenge, secret, code, user.twoFactorLastUsedStep);
    await this.prisma.authChallenge.delete({ where: { id: challenge.id } });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorLastUsedStep: BigInt(matchedStep) },
    });
    return this.establishSession(user);
  }

  /** Creates a fresh authenticator secret for the QR code. Enabling comes next. */
  async startTwoFactorSetup(setupToken: string): Promise<TwoFactorSetup> {
    const { challenge, user } = await this.loadChallenge(setupToken, 'SET_UP');
    const secret = generateTotpSecret();
    // The secret waits on the challenge until the user proves their app works.
    // Calling setup again simply replaces it, as the contract says.
    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { pendingSecretEncrypted: this.tokens.encryptSecret(secret) },
    });
    return { otpauthUri: otpauthUri(user.email, secret), manualEntryKey: secret };
  }

  /** The first correct code proves the app was set up; two-factor turns on. */
  async enableTwoFactor(
    setupToken: string,
    code: string,
  ): Promise<{ session: AuthenticatedSession; refreshToken: string }> {
    const { challenge, user } = await this.loadChallenge(setupToken, 'SET_UP');
    if (!challenge.pendingSecretEncrypted) {
      throw new BadRequestException('Call POST /auth/2fa/setup first to get your QR code.');
    }
    const secret = this.tokens.decryptSecret(challenge.pendingSecretEncrypted);
    if (!secret) {
      throw new UnauthorizedException(CHALLENGE_GONE);
    }

    const matchedStep = await this.checkCode(challenge, secret, code, null);
    await this.prisma.authChallenge.delete({ where: { id: challenge.id } });
    const enabledUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecretEncrypted: challenge.pendingSecretEncrypted,
        twoFactorEnabledAt: new Date(),
        twoFactorLastUsedStep: BigInt(matchedStep),
      },
    });
    await this.audit.record({
      companyId: user.companyId,
      actorUserId: user.id,
      action: 'auth.two_factor_enabled',
      entityType: 'user',
      entityId: user.id,
    });
    return this.establishSession(enabledUser);
  }

  /**
   * Swaps a refresh token for a fresh access token, rotating the refresh
   * token itself. A refresh token that was already rotated must never appear
   * again — if it does, someone copied it, and every session of that user is
   * revoked so both the thief and the user are signed out everywhere.
   */
  async refresh(refreshToken: string | undefined): Promise<RotatedSession> {
    if (!refreshToken) {
      throw new UnauthorizedException('Sign in to continue.');
    }
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.tokens.hashToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Sign in to continue.');
    }
    if (session.revokedAt) {
      await this.prisma.userSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        companyId: session.user.companyId,
        actorUserId: session.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'user',
        entityId: session.userId,
        detail: { revokedAllSessions: true },
      });
      throw new UnauthorizedException('Sign in to continue.');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    const next = await this.createSessionRow(session.userId);
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: next.sessionId },
    });
    return {
      accessToken: await this.tokens.signAccessToken(this.asSignedIn(session.user)),
      expiresInSeconds: ACCESS_TOKEN_SECONDS,
      refreshToken: next.refreshToken,
    };
  }

  /** Revokes the refresh token, if one was sent. Signing out never fails. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.tokens.hashToken(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt) {
      return;
    }
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      companyId: session.user.companyId,
      actorUserId: session.userId,
      action: 'auth.signed_out',
      entityType: 'user',
      entityId: session.userId,
    });
  }

  /** The signed-in user, fresh from the database (roles can change). */
  async me(userId: string): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isActive) {
      throw new UnauthorizedException('Sign in to continue.');
    }
    return toCurrentUser(user);
  }

  // ---------------------------------------------------------------------------

  private async establishSession(
    user: User,
  ): Promise<{ session: AuthenticatedSession; refreshToken: string }> {
    const { refreshToken } = await this.createSessionRow(user.id);
    await this.audit.record({
      companyId: user.companyId,
      actorUserId: user.id,
      action: 'auth.signed_in',
      entityType: 'user',
      entityId: user.id,
    });
    return {
      session: {
        status: 'AUTHENTICATED',
        accessToken: await this.tokens.signAccessToken(this.asSignedIn(user)),
        expiresInSeconds: ACCESS_TOKEN_SECONDS,
        user: toCurrentUser(user),
      },
      refreshToken,
    };
  }

  private async createSessionRow(
    userId: string,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = this.tokens.newOpaqueToken();
    const row = await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: this.tokens.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_SECONDS * 1000),
      },
    });
    return { sessionId: row.id, refreshToken };
  }

  /** Issues a one-time token for the next sign-in step, replacing older ones. */
  private async issueChallenge(
    user: User,
    purpose: 'VERIFY_CODE' | 'SET_UP',
    minutes: number,
  ): Promise<string> {
    await this.prisma.authChallenge.deleteMany({ where: { userId: user.id, purpose } });
    const token = this.tokens.newOpaqueToken();
    await this.prisma.authChallenge.create({
      data: {
        userId: user.id,
        purpose,
        tokenHash: this.tokens.hashToken(token),
        expiresAt: new Date(Date.now() + minutes * 60_000),
      },
    });
    return token;
  }

  /** Finds a live challenge for this token, or answers 401 without saying why. */
  private async loadChallenge(
    token: string,
    purpose: 'VERIFY_CODE' | 'SET_UP',
  ): Promise<{ challenge: AuthChallenge; user: User }> {
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { tokenHash: this.tokens.hashToken(token) },
      include: { user: true },
    });
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.expiresAt < new Date() ||
      challenge.failedAttempts >= MAX_CODE_ATTEMPTS ||
      !challenge.user.isActive
    ) {
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    return { challenge, user: challenge.user };
  }

  /**
   * Checks a 6-digit code. A wrong code counts against the challenge (5
   * cancel it); a code at or before the last accepted step is a replay and is
   * refused. Returns the time step the code matched.
   */
  private async checkCode(
    challenge: AuthChallenge,
    secret: string,
    code: string,
    lastUsedStep: bigint | null,
  ): Promise<number> {
    const matchedStep = verifyTotpCode(secret, code);
    if (matchedStep !== null && (lastUsedStep === null || BigInt(matchedStep) > lastUsedStep)) {
      return matchedStep;
    }
    const failedAttempts = challenge.failedAttempts + 1;
    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { failedAttempts },
    });
    if (failedAttempts >= MAX_CODE_ATTEMPTS) {
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    if (matchedStep !== null) {
      throw new UnauthorizedException('That code was already used. Wait for the next one.');
    }
    throw new UnauthorizedException('The code is incorrect.');
  }

  private asSignedIn(user: User) {
    return {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      employeeId: user.employeeId,
    };
  }
}

/** Maps a database user to the contract's `CurrentUser` shape. */
export function toCurrentUser(user: User): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabledAt !== null,
    employeeId: user.employeeId,
  };
}
