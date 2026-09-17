import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service.js';
import type {
  AuthChallenge,
  LoginThrottle,
  User,
  UserSession,
} from '../../src/generated/prisma/client.js';

/**
 * A pretend database for the identity unit tests: plain objects in arrays,
 * with just the Prisma methods the identity services call. Because services
 * receive the database through their constructors, tests can hand them this
 * instead of a real PostgreSQL connection, and stay fast.
 *
 * The e2e tests in `test/db.e2e-spec.ts` run the same flows against a real
 * database, so this fake cannot drift silently.
 */
export class FakeIdentityDb {
  users: User[] = [];
  sessions: UserSession[] = [];
  challenges: AuthChallenge[] = [];
  throttles: LoginThrottle[] = [];
  auditEntries: Array<{ action: string; entityId: string | null }> = [];

  /** Adds a user with sensible defaults; override what a test cares about. */
  addUser(overrides: Partial<User> & Pick<User, 'email' | 'passwordHash' | 'role'>): User {
    const user: User = {
      id: randomUUID(),
      companyId: '01927c3e-0000-7000-8000-000000000001',
      fullName: 'Test Person',
      isActive: true,
      employeeId: null,
      twoFactorSecretEncrypted: null,
      twoFactorEnabledAt: null,
      twoFactorLastUsedStep: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    this.users.push(user);
    return user;
  }

  /** The object the services see. Only the methods they actually call exist. */
  asPrisma(): PrismaService {
    return {
      user: {
        findFirst: async ({ where }: { where: { email: string } }) =>
          this.users.find((user) => user.email === where.email) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) =>
          this.users.find((user) => user.id === where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
          const user = this.users.find((candidate) => candidate.id === where.id);
          if (!user) throw new Error('No such user');
          Object.assign(user, data, { updatedAt: new Date() });
          return user;
        },
      },
      userSession: {
        create: async ({
          data,
        }: {
          data: Omit<UserSession, 'id' | 'createdAt' | 'revokedAt' | 'replacedById'>;
        }) => {
          const session: UserSession = {
            id: randomUUID(),
            createdAt: new Date(),
            revokedAt: null,
            replacedById: null,
            ...data,
          };
          this.sessions.push(session);
          return session;
        },
        findUnique: async ({ where }: { where: { tokenHash: string } }) => {
          const session = this.sessions.find(
            (candidate) => candidate.tokenHash === where.tokenHash,
          );
          if (!session) return null;
          const user = this.users.find((candidate) => candidate.id === session.userId);
          return { ...session, user };
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<UserSession> }) => {
          const session = this.sessions.find((candidate) => candidate.id === where.id);
          if (!session) throw new Error('No such session');
          Object.assign(session, data);
          return session;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { userId: string; revokedAt: null };
          data: Partial<UserSession>;
        }) => {
          for (const session of this.sessions) {
            if (session.userId === where.userId && session.revokedAt === null) {
              Object.assign(session, data);
            }
          }
        },
      },
      authChallenge: {
        create: async ({
          data,
        }: {
          data: Omit<
            AuthChallenge,
            'id' | 'createdAt' | 'failedAttempts' | 'pendingSecretEncrypted'
          >;
        }) => {
          const challenge: AuthChallenge = {
            id: randomUUID(),
            createdAt: new Date(),
            failedAttempts: 0,
            pendingSecretEncrypted: null,
            ...data,
          };
          this.challenges.push(challenge);
          return challenge;
        },
        findUnique: async ({ where }: { where: { tokenHash: string } }) => {
          const challenge = this.challenges.find(
            (candidate) => candidate.tokenHash === where.tokenHash,
          );
          if (!challenge) return null;
          const user = this.users.find((candidate) => candidate.id === challenge.userId);
          return { ...challenge, user };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<AuthChallenge>;
        }) => {
          const challenge = this.challenges.find((candidate) => candidate.id === where.id);
          if (!challenge) throw new Error('No such challenge');
          Object.assign(challenge, data);
          return challenge;
        },
        delete: async ({ where }: { where: { id: string } }) => {
          this.challenges = this.challenges.filter((candidate) => candidate.id !== where.id);
        },
        deleteMany: async ({ where }: { where: { userId: string; purpose: string } }) => {
          this.challenges = this.challenges.filter(
            (candidate) =>
              !(candidate.userId === where.userId && candidate.purpose === where.purpose),
          );
        },
      },
      loginThrottle: {
        findUnique: async ({ where }: { where: { emailHash: string } }) =>
          this.throttles.find((row) => row.emailHash === where.emailHash) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { emailHash: string };
          create: Omit<LoginThrottle, 'updatedAt'>;
          update: Partial<LoginThrottle>;
        }) => {
          const existing = this.throttles.find((row) => row.emailHash === where.emailHash);
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return existing;
          }
          const row: LoginThrottle = { updatedAt: new Date(), ...create };
          this.throttles.push(row);
          return row;
        },
        delete: async ({ where }: { where: { emailHash: string } }) => {
          const exists = this.throttles.some((row) => row.emailHash === where.emailHash);
          if (!exists) throw new Error('No such row');
          this.throttles = this.throttles.filter((row) => row.emailHash !== where.emailHash);
        },
      },
      auditLog: {
        create: async ({ data }: { data: { action: string; entityId?: string } }) => {
          this.auditEntries.push({ action: data.action, entityId: data.entityId ?? null });
        },
      },
    } as unknown as PrismaService;
  }
}
