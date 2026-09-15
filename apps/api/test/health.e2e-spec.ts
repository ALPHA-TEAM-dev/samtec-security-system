import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AppConfig } from '../src/config/app-config.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * End-to-end test: starts the real Nest application, with the same security
 * settings as production, and sends real HTTP requests to it. The database is
 * replaced by a fake, so this test runs anywhere, including CI.
 */
describe('Health endpoint (e2e)', () => {
  let app: NestExpressApplication;
  let databaseUp = true;

  beforeAll(async () => {
    const config = new AppConfig(
      {
        NODE_ENV: 'test',
        PORT: 3000,
        DATABASE_URL: 'postgresql://samtec@localhost:5432/samtec_test',
        CORS_ORIGINS: ['http://localhost:5173'],
      },
      '0.1.0',
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue(config)
      .overrideProvider(PrismaService)
      .useValue({ isReachable: async () => databaseUp, $disconnect: async () => undefined })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 and the contract shape when everything is up', async () => {
    databaseUp = true;

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      version: '0.1.0',
      environment: 'test',
      checks: { database: 'up' },
    });
  });

  it('returns 503 when the database is down', async () => {
    databaseUp = false;

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.database).toBe('down');
  });

  it('sends security headers and a request ID', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers unknown routes with a Problem Details 404', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/api/v1/does-not-exist',
    });
    expect(response.body.traceId).toBe(response.headers['x-request-id']);
  });
});
