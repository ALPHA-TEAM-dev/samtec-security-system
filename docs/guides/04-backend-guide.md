# Backend guide

For Francis, who builds the API. Samuel should read "How the API is organised" and "The life of a request" too, because examiners will ask about the whole system.

## How the API is organised

```
apps/api/
├── prisma/
│   ├── schema.prisma          every database table
│   ├── migrations/            SQL files that build the database, in order
│   └── seed.ts                fictional demo data (pnpm db:seed)
├── scripts/
│   └── dev-database.ts        the local PostgreSQL server (pnpm db:start)
├── src/
│   ├── main.ts                starts the API
│   ├── app.module.ts          wires all modules together
│   ├── app.setup.ts           security settings shared by main.ts and tests
│   ├── config/                environment variables, checked at startup
│   ├── database/              PrismaService, the database client
│   ├── common/                request IDs and the error format (Problem Details)
│   ├── health/                GET /api/v1/health, the reference example
│   ├── modules/               business features, one folder per module
│   └── generated/prisma/      the generated Prisma client (never edit, never committed)
├── test/                      end-to-end tests
└── .env.example               copy to .env
```

## NestJS in five ideas

1. **Module:** a box that groups related code. `HealthModule` holds the health controller and service.
2. **Controller:** handles HTTP. It defines routes (`@Get()`), reads inputs, sets status codes, and calls a service. Keep controllers thin.
3. **Service:** holds the business rules and the database access. Most of your code lives here, and most of your tests test it.
4. **Dependency injection:** a class lists what it needs in its constructor, and Nest supplies it. `HealthService` asks for `PrismaService` and `AppConfig`. Tests can supply fakes instead.
5. **Pipes, filters and middleware:** code that runs around every request. Our validation pipe checks input, our filter formats errors, our middleware adds request IDs and security headers.

## The life of a request

What happens when someone calls `GET /api/v1/health`:

1. `requestIdMiddleware` gives the request an ID and adds the `X-Request-ID` header.
2. Helmet adds secure headers; CORS checks the calling website.
3. Nest finds the route `HealthController.getHealth()`.
4. The validation pipe checks any Zod schemas on the route (none here).
5. The controller calls `HealthService.check()`.
6. The service asks `PrismaService.isReachable()`, which runs `SELECT 1`.
7. The controller returns the report with status 200, or 503 if the database is down.
8. If anything throws, `ProblemDetailsFilter` sends a Problem Details error with the request ID as `traceId`.

Read those files in that order: `common/request-id.middleware.ts`, `app.setup.ts`, `health/health.controller.ts`, `health/health.service.ts`, `database/prisma.service.ts`, `common/problem-details.filter.ts`.

## Running the API on your computer

You need two terminals. Full setup steps are in [Set up your computer](02-setup-on-windows.md).

**Terminal 1**, the database. Leave it open:

```bash
pnpm db:start
```

**Terminal 2**, the first time only:

```bash
cp apps/api/.env.example apps/api/.env
pnpm db:migrate
pnpm db:seed
```

Then start the API. It restarts automatically when you save a file:

```bash
pnpm dev:api
```

Check it in a browser: http://localhost:3000/api/v1/health should show `"database": "up"`.

## Two rules about imports

1. **Relative imports end in `.js`**, even though the file is `.ts`:

   ```ts
   import { HealthService } from './health.service.js';
   ```

   The API uses modern ES modules, where an import names the file that will exist after compiling.

2. **Never use `import type` for a class that Nest injects.**

   ```ts
   import { PrismaService } from '../database/prisma.service.js';      // correct
   import type { PrismaService } from '../database/prisma.service.js'; // breaks dependency injection
   ```

   Nest reads constructor types while the program runs, and `import type` deletes them. Contract types are different: always import those with `import type`.

## Adding an endpoint, step by step

Example: `GET /api/v1/sites/{siteId}` in the `workforce` module (Phase 1). The contract already describes it (`getSite` in `openapi.yaml`). If an endpoint is not in the contract yet, add it first: [Changing the API contract](05-api-contract-workflow.md).

### 1. A Zod schema for the input

```ts
// apps/api/src/modules/workforce/sites.schemas.ts
import { z } from 'zod';

/** The {siteId} part of the address must be a UUID. */
export const siteIdSchema = z.uuid();
```

### 2. The service: business rules and database access

```ts
// apps/api/src/modules/workforce/sites.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Site } from '@samtec/contracts';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  async getSite(siteId: string): Promise<Site> {
    // Phase 1: also filter by the signed-in user's company and, for supervisors, their sites.
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      throw new NotFoundException('No site exists with this ID.');
    }

    const activeGuardCount = await this.prisma.siteAssignment.count({
      where: { siteId, endsOn: null, employee: { status: 'ACTIVE' } },
    });

    // Turn the database row into exactly the shape the contract promises.
    return {
      id: site.id,
      code: site.code,
      name: site.name,
      clientName: site.clientName,
      region: site.region,
      city: site.city,
      status: site.status,
      activeGuardCount,
      createdAt: site.createdAt.toISOString(),
      updatedAt: site.updatedAt.toISOString(),
    };
  }
}
```

The return type `Site` comes from the contract. If you forget a field or use the wrong type, TypeScript stops you.

### 3. The controller: HTTP only

```ts
// apps/api/src/modules/workforce/sites.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import type { Site } from '@samtec/contracts';
import { siteIdSchema } from './sites.schemas.js';
import { SitesService } from './sites.service.js';

@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get(':siteId')
  getSite(@Param('siteId', { schema: siteIdSchema }) siteId: string): Promise<Site> {
    return this.sites.getSite(siteId);
  }
}
```

If `siteId` is not a UUID, the validation pipe answers `400` with a Problem Details body before your code runs.

### 4. The module, registered in AppModule

```ts
// apps/api/src/modules/workforce/workforce.module.ts
import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller.js';
import { SitesService } from './sites.service.js';

@Module({
  controllers: [SitesController],
  providers: [SitesService],
})
export class WorkforceModule {}
```

Then add `WorkforceModule` to the `imports` list in `src/app.module.ts`.

### 5. Tests

A unit test for the service, with a fake database:

```ts
// apps/api/src/modules/workforce/sites.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { SitesService } from './sites.service.js';

describe('SitesService', () => {
  it('reports an unknown site as not found', async () => {
    const prisma = { site: { findUnique: async () => null } } as unknown as PrismaService;

    await expect(
      new SitesService(prisma).getSite('01927c3e-1111-7aaa-8bbb-0c0c0c0c0c99'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

Add an end-to-end test in `test/` for the route itself, following `test/health.e2e-spec.ts`.

### 6. Check and open a pull request

```bash
pnpm check
```

Then follow [Git and pull requests](06-git-and-pull-requests.md).

## Changing the database

1. Edit `apps/api/prisma/schema.prisma`.
2. Create and apply a migration, giving it a short name when asked:

   ```bash
   pnpm db:migrate
   ```

3. **Read the generated `migration.sql`.** Make sure it does not delete data you need.
4. Commit `schema.prisma` and the new migration folder together.

Rules:

- Never edit a migration that is already on `main`. Create a new one instead.
- `pnpm db:reset` deletes everything in your **local** database, reapplies all migrations and reseeds. It is handy when your local data is a mess. Never point it at a shared database.
- Money columns are integers (pesewas). Timestamps use `@db.Timestamptz(3)`. People and money records are never deleted; add a status instead.

## Adding a configuration setting

1. Add the variable and its rule to `envSchema` in `src/config/env.ts`.
2. Expose it on `AppConfig` in `src/config/app-config.ts`.
3. Add it with a safe example value and a comment to `apps/api/.env.example`.
4. Add it to the `env:` section of the `database` job in `.github/workflows/ci.yml` if CI needs it.

## Errors

- Throw Nest's HTTP exceptions for expected problems: `NotFoundException`, `ConflictException`, `ForbiddenException`, `BadRequestException`.
- Never catch an error just to hide it. Let unexpected errors reach the filter, which logs them and sends a safe, generic 500 response.
- Records a user may not see return **404**, not 403, so nobody can discover which IDs exist.

## Security checklist for every endpoint

- [ ] It is in the contract.
- [ ] Every input has a strict Zod schema; unknown fields are rejected.
- [ ] From Phase 1: the route requires sign-in, and the role is checked.
- [ ] The service checks that this user may access this specific record.
- [ ] Lists are paginated with a maximum page size.
- [ ] Responses include only the fields the role needs.
- [ ] Nothing sensitive is logged: passwords, tokens, Ghana Card numbers, biometric data.

## Testing

| Command | What runs |
|---|---|
| `pnpm --filter @samtec/api test` | All API unit and end-to-end tests |
| `pnpm --filter @samtec/api test:watch` | Re-runs tests as you save |
| `pnpm test` | Tests for every package |

- **Unit tests** (`src/**/*.spec.ts`) test one class with fake dependencies. They are fast and need no database.
- **End-to-end tests** (`test/*.e2e-spec.ts`) start the real app with the real security settings and send HTTP requests to it.
- Payroll logic, when it arrives, is tested with hand-calculated examples, correct to the pesewa.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| `Invalid environment configuration` | `apps/api/.env` is missing or has a wrong value. Compare it with `.env.example`. |
| `Can't reach database server` or `Database is not reachable` | The database is not running. Start it with `pnpm db:start` in another terminal. |
| `Nest can't resolve dependencies of ...` | A provider is missing from a module's `providers`, the module is not imported, or a class was imported with `import type`. |
| `Module '"../generated/prisma/client.js"' has no exported member` | The Prisma client is out of date. Run `pnpm --filter @samtec/api db:generate`. |
| `EADDRINUSE: address already in use :::3000` | Another API is already running. Close that terminal, or change `PORT` in `.env`. |

Related: [System architecture](../plan/03-system-architecture.md) · [Data model](../plan/04-data-model.md) · [Changing the API contract](05-api-contract-workflow.md)
