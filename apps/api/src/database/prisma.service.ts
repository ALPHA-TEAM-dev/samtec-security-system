import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/app-config.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The one database client for the whole API.
 *
 * Inject it into a service and query with Prisma:
 *
 *   constructor(private readonly prisma: PrismaService) {}
 *   ...
 *   await this.prisma.employee.findMany({ where: { status: 'ACTIVE' } });
 *
 * Only the module that owns a table may write to it (docs/plan/03-system-architecture.md).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        // Give up quickly when the database is down, instead of hanging requests.
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  /** Runs a trivial query to find out whether the database answers. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database is not reachable: ${reason}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
