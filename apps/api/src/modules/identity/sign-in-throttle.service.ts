import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RateLimitException } from '../../common/rate-limit.exception.js';
import { PrismaService } from '../../database/prisma.service.js';

/** Failures are counted within a rolling window this long. */
const WINDOW_MINUTES = 15;
/** This many failures in the window lock the email out… */
const MAX_FAILURES = 5;
/** …for this long. */
const LOCK_MINUTES = 15;

const MINUTE_MILLISECONDS = 60_000;

/**
 * Slows password guessing down. Five wrong passwords for one email inside 15
 * minutes lock that email for 15 minutes, and further tries answer 429 with a
 * `Retry-After` header.
 *
 * The count is per **email**, and it runs whether or not an account exists,
 * so the lockout itself never reveals which emails have accounts. Emails are
 * stored only as hashes: this table must not become a list of addresses
 * people have typed.
 */
@Injectable()
export class SignInThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 429 when this email is locked out. Call before checking a password. */
  async assertNotLocked(email: string): Promise<void> {
    const row = await this.prisma.loginThrottle.findUnique({
      where: { emailHash: hashEmail(email) },
    });
    if (!row?.lockedUntil) {
      return;
    }
    const waitSeconds = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000);
    if (waitSeconds > 0) {
      throw new RateLimitException(
        `Too many attempts. Try again in ${waitSeconds} seconds.`,
        waitSeconds,
      );
    }
  }

  /** Counts one wrong password. Returns true when this failure caused a lockout. */
  async recordFailure(email: string, now: Date = new Date()): Promise<boolean> {
    const emailHash = hashEmail(email);
    const existing = await this.prisma.loginThrottle.findUnique({ where: { emailHash } });

    const windowExpired =
      !existing ||
      now.getTime() - existing.windowStartsAt.getTime() > WINDOW_MINUTES * MINUTE_MILLISECONDS;
    const failedCount = windowExpired ? 1 : existing.failedCount + 1;
    const lockedUntil =
      failedCount >= MAX_FAILURES
        ? new Date(now.getTime() + LOCK_MINUTES * MINUTE_MILLISECONDS)
        : null;

    await this.prisma.loginThrottle.upsert({
      where: { emailHash },
      create: { emailHash, failedCount, windowStartsAt: now, lockedUntil },
      update: windowExpired
        ? { failedCount, windowStartsAt: now, lockedUntil }
        : { failedCount, lockedUntil },
    });
    return lockedUntil !== null;
  }

  /** A correct sign-in wipes the email's slate clean. */
  async recordSuccess(email: string): Promise<void> {
    await this.prisma.loginThrottle
      .delete({ where: { emailHash: hashEmail(email) } })
      .catch(() => undefined); // Nothing recorded for this email; fine.
  }
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
