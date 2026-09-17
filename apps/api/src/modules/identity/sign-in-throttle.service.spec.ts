import { describe, expect, it } from 'vitest';
import { FakeIdentityDb } from '../../../test/fakes/identity-db.js';
import { RateLimitException } from '../../common/rate-limit.exception.js';
import { SignInThrottleService } from './sign-in-throttle.service.js';

function makeThrottle() {
  const db = new FakeIdentityDb();
  return { throttle: new SignInThrottleService(db.asPrisma()), db };
}

describe('SignInThrottleService', () => {
  it('lets the first four failures through and locks on the fifth', async () => {
    const { throttle } = makeThrottle();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await throttle.recordFailure('ama@samtec.example')).toBe(false);
      await throttle.assertNotLocked('ama@samtec.example');
    }
    expect(await throttle.recordFailure('ama@samtec.example')).toBe(true);

    await expect(throttle.assertNotLocked('ama@samtec.example')).rejects.toBeInstanceOf(
      RateLimitException,
    );
  });

  it('tells a locked caller how long to wait', async () => {
    const { throttle } = makeThrottle();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await throttle.recordFailure('ama@samtec.example');
    }

    const error = await throttle.assertNotLocked('ama@samtec.example').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitException);
    expect((error as RateLimitException).retryAfterSeconds).toBeGreaterThan(0);
    expect((error as RateLimitException).retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('forgets old failures once the 15-minute window has passed', async () => {
    const { throttle } = makeThrottle();
    const longAgo = new Date(Date.now() - 16 * 60_000);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await throttle.recordFailure('ama@samtec.example', longAgo);
    }

    // The 5th failure lands in a fresh window, so it counts as the 1st.
    expect(await throttle.recordFailure('ama@samtec.example')).toBe(false);
    await throttle.assertNotLocked('ama@samtec.example');
  });

  it('wipes the slate clean after a correct sign-in', async () => {
    const { throttle, db } = makeThrottle();
    await throttle.recordFailure('ama@samtec.example');

    await throttle.recordSuccess('ama@samtec.example');

    expect(db.throttles).toHaveLength(0);
    await throttle.recordSuccess('ama@samtec.example'); // Nothing recorded: still fine.
  });

  it('counts different emails separately, and never stores the email itself', async () => {
    const { throttle, db } = makeThrottle();
    await throttle.recordFailure('ama@samtec.example');
    await throttle.recordFailure('kofi@samtec.example');

    expect(db.throttles).toHaveLength(2);
    expect(JSON.stringify(db.throttles)).not.toContain('samtec.example');
  });
});
