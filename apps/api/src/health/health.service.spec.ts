import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/app-config.js';
import type { PrismaService } from '../database/prisma.service.js';
import { HealthService } from './health.service.js';

const config = new AppConfig(
  {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://samtec@localhost:5432/samtec_test',
    CORS_ORIGINS: ['http://localhost:5173'],
  },
  '0.1.0',
);

/**
 * A pretend database for unit tests. Because HealthService receives its
 * dependencies through the constructor, a test can hand it this fake instead
 * of a real database connection. The cast is safe: HealthService only calls
 * `isReachable`.
 */
function fakeDatabase(reachable: boolean): PrismaService {
  return { isReachable: async () => reachable } as unknown as PrismaService;
}

describe('HealthService', () => {
  it('reports ok when the database answers', async () => {
    const report = await new HealthService(fakeDatabase(true), config).check();

    expect(report).toMatchObject({
      status: 'ok',
      version: '0.1.0',
      environment: 'test',
      checks: { database: 'up' },
    });
  });

  it('reports degraded when the database is down', async () => {
    const report = await new HealthService(fakeDatabase(false), config).check();

    expect(report.status).toBe('degraded');
    expect(report.checks.database).toBe('down');
  });
});
