import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@samtec/contracts';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Checks the API's dependencies. The return type comes from the API contract,
   * so TypeScript fails the build if this ever drifts from `openapi.yaml`.
   */
  async check(): Promise<HealthResponse> {
    const databaseUp = await this.prisma.isReachable();
    return {
      status: databaseUp ? 'ok' : 'degraded',
      version: this.config.version,
      environment: this.config.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      time: new Date().toISOString(),
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
