import { UnauthorizedException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeIdentityDb } from '../../../test/fakes/identity-db.js';
import { RateLimitException } from '../../common/rate-limit.exception.js';
import { AppConfig } from '../../config/app-config.js';
import { AuditService } from './audit.service.js';
import { AuthService } from './auth.service.js';
import { hashPassword, TEST_ONLY_SCRYPT_PARAMS } from './password.js';
import { SignInThrottleService } from './sign-in-throttle.service.js';
import { TokensService } from './tokens.service.js';
import { totpCode, totpStep } from './totp.js';

/**
 * The sign-in flows against a fake in-memory database. The same flows also
 * run against real PostgreSQL in test/db.e2e-spec.ts.
 */

const config = new AppConfig({
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused@localhost:5432/unused',
  CORS_ORIGINS: ['http://localhost:5173'],
  AUTH_SECRET: 'test-only-auth-secret-at-least-32-chars!',
});

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword('demo-password', TEST_ONLY_SCRYPT_PARAMS);
});

function makeAuth() {
  const db = new FakeIdentityDb();
  const prisma = db.asPrisma();
  const tokens = new TokensService(config);
  const auth = new AuthService(
    prisma,
    tokens,
    new SignInThrottleService(prisma),
    new AuditService(prisma),
  );
  return { db, auth, tokens };
}

describe('login', () => {
  it('answers an unknown email and a wrong password identically', async () => {
    const { db, auth } = makeAuth();
    db.addUser({ email: 'ama@samtec.example', passwordHash, role: 'SUPERVISOR' });

    const unknown = await auth
      .login('nobody@samtec.example', 'demo-password')
      .catch((e: unknown) => e);
    const wrong = await auth
      .login('ama@samtec.example', 'not-the-password')
      .catch((e: unknown) => e);

    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect((unknown as UnauthorizedException).message).toBe(
      (wrong as UnauthorizedException).message,
    );
  });

  it('signs a supervisor straight in and writes an audit entry', async () => {
    const { db, auth } = makeAuth();
    const user = db.addUser({ email: 'ama@samtec.example', passwordHash, role: 'SUPERVISOR' });

    const outcome = await auth.login('ama@samtec.example', 'demo-password');

    expect(outcome.kind).toBe('session');
    if (outcome.kind !== 'session') throw new Error('unreachable');
    expect(outcome.session.user.email).toBe('ama@samtec.example');
    expect(outcome.refreshToken.length).toBeGreaterThan(20);
    expect(db.sessions).toHaveLength(1);
    expect(db.auditEntries).toContainEqual({ action: 'auth.signed_in', entityId: user.id });
  });

  it('is not case-sensitive about the email', async () => {
    const { db, auth } = makeAuth();
    db.addUser({ email: 'ama@samtec.example', passwordHash, role: 'SUPERVISOR' });

    const outcome = await auth.login('  Ama@SAMTEC.example ', 'demo-password');

    expect(outcome.kind).toBe('session');
  });

  it('refuses a disabled account without revealing that it exists', async () => {
    const { db, auth } = makeAuth();
    db.addUser({ email: 'gone@samtec.example', passwordHash, role: 'SUPERVISOR', isActive: false });

    const error = await auth.login('gone@samtec.example', 'demo-password').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe('Email or password is incorrect.');
  });

  it('locks an email after five wrong passwords, whether or not it has an account', async () => {
    const { auth } = makeAuth();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.login('nobody@samtec.example', 'guess').catch(() => undefined);
    }
    const locked = await auth.login('nobody@samtec.example', 'guess').catch((e: unknown) => e);

    expect(locked).toBeInstanceOf(RateLimitException);
  });

  it('sends an ADMIN without two-factor authentication to set it up', async () => {
    const { db, auth } = makeAuth();
    db.addUser({ email: 'admin@samtec.example', passwordHash, role: 'ADMIN' });

    const outcome = await auth.login('admin@samtec.example', 'demo-password');

    expect(outcome.kind).toBe('setup');
    expect(db.sessions).toHaveLength(0); // Not signed in yet.
  });
});

describe('two-factor setup and verification', () => {
  async function setUpTwoFactor(role: 'ADMIN' | 'HR_PAYROLL' = 'HR_PAYROLL') {
    const { db, auth, tokens } = makeAuth();
    const user = db.addUser({ email: 'hr@samtec.example', passwordHash, role });
    const login = await auth.login('hr@samtec.example', 'demo-password');
    if (login.kind !== 'setup') throw new Error('Expected a setup outcome');
    const setupToken = login.response.setupToken;
    const setup = await auth.startTwoFactorSetup(setupToken);
    return { db, auth, tokens, user, setupToken, secret: setup.manualEntryKey };
  }

  it('turns two-factor on only after a correct code, then requires it at sign-in', async () => {
    const { db, auth, user, setupToken, secret } = await setUpTwoFactor();

    const wrong = await auth.enableTwoFactor(setupToken, '000000').catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect(db.users[0]?.twoFactorEnabledAt).toBeNull();

    const result = await auth.enableTwoFactor(setupToken, totpCode(secret, totpStep()));
    expect(result.session.user.twoFactorEnabled).toBe(true);
    expect(db.users[0]?.twoFactorEnabledAt).not.toBeNull();
    expect(db.auditEntries).toContainEqual({
      action: 'auth.two_factor_enabled',
      entityId: user.id,
    });

    const nextLogin = await auth.login('hr@samtec.example', 'demo-password');
    expect(nextLogin.kind).toBe('challenge');
  });

  it('refuses a code that was already accepted (replay protection)', async () => {
    const { auth, setupToken, secret } = await setUpTwoFactor();
    const usedStep = totpStep();
    const usedCode = totpCode(secret, usedStep);
    await auth.enableTwoFactor(setupToken, usedCode);

    const login = await auth.login('hr@samtec.example', 'demo-password');
    if (login.kind !== 'challenge') throw new Error('Expected a challenge');
    const replay = await auth
      .verifyTwoFactor(login.response.challengeToken, usedCode)
      .catch((e: unknown) => e);
    expect(replay).toBeInstanceOf(UnauthorizedException);
    expect((replay as UnauthorizedException).message).toContain('already used');

    // The next step's code is fresh, so it works.
    const session = await auth.verifyTwoFactor(
      login.response.challengeToken,
      totpCode(secret, usedStep + 1),
    );
    expect(session.session.status).toBe('AUTHENTICATED');
  });

  it('cancels the challenge after five wrong codes', async () => {
    const { auth, setupToken, secret } = await setUpTwoFactor();
    await auth.enableTwoFactor(setupToken, totpCode(secret, totpStep()));
    const login = await auth.login('hr@samtec.example', 'demo-password');
    if (login.kind !== 'challenge') throw new Error('Expected a challenge');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.verifyTwoFactor(login.response.challengeToken, '000000').catch(() => undefined);
    }
    // Even the right code is now refused: sign in with the password again.
    const done = await auth
      .verifyTwoFactor(login.response.challengeToken, totpCode(secret, totpStep() + 1))
      .catch((e: unknown) => e);

    expect(done).toBeInstanceOf(UnauthorizedException);
    expect((done as UnauthorizedException).message).toContain('expired');
  });

  it('refuses a challenge token where a setup token is expected', async () => {
    const { auth, setupToken } = await setUpTwoFactor();

    // Use the setup token as if it were a verify token: wrong purpose.
    const error = await auth.verifyTwoFactor(setupToken, '123456').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
  });
});

describe('refresh token rotation', () => {
  async function signedInSupervisor() {
    const { db, auth, tokens } = makeAuth();
    db.addUser({ email: 'ama@samtec.example', passwordHash, role: 'SUPERVISOR' });
    const outcome = await auth.login('ama@samtec.example', 'demo-password');
    if (outcome.kind !== 'session') throw new Error('Expected a session');
    return { db, auth, tokens, refreshToken: outcome.refreshToken };
  }

  it('rotates the refresh token on every use', async () => {
    const { auth, refreshToken } = await signedInSupervisor();

    const first = await auth.refresh(refreshToken);
    expect(first.accessToken.length).toBeGreaterThan(20);
    expect(first.refreshToken).not.toBe(refreshToken);

    const second = await auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('revokes every session when a rotated token is used again', async () => {
    const { db, auth, refreshToken } = await signedInSupervisor();
    const rotated = await auth.refresh(refreshToken);

    // The old token arrives again: someone copied it.
    const reuse = await auth.refresh(refreshToken).catch((e: unknown) => e);
    expect(reuse).toBeInstanceOf(UnauthorizedException);

    // Now even the newest token is dead: everyone is signed out.
    const after = await auth.refresh(rotated.refreshToken).catch((e: unknown) => e);
    expect(after).toBeInstanceOf(UnauthorizedException);
    expect(db.auditEntries.map((entry) => entry.action)).toContain('auth.refresh_reuse_detected');
  });

  it('signs out by revoking the session, and signing out twice is fine', async () => {
    const { auth, refreshToken } = await signedInSupervisor();

    await auth.logout(refreshToken);
    await auth.logout(refreshToken);
    await auth.logout(undefined);

    const error = await auth.refresh(refreshToken).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
  });
});
