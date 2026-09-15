# SAMTEC Security System

**Biometric attendance and payroll that stops ghost workers in security companies.**

[![CI](https://github.com/ALPHA-TEAM-dev/samtec-security-system/actions/workflows/ci.yml/badge.svg)](https://github.com/ALPHA-TEAM-dev/samtec-security-system/actions/workflows/ci.yml)

Security companies lose money when salaries are paid for shifts nobody worked. SAMTEC links **identity → presence → pay** into one verified chain:

1. Guards are registered with their Ghana Card and their fingerprint or face.
2. They clock in and out biometrically at the client site.
3. Pay is calculated only from those verified clock-ins, and a second person approves every payroll.

A detection engine flags whatever slips through, such as one fingerprint under two names, pay without attendance, or a guard clocked in at two sites at once.

> **Status: Phase 0, Foundation.** Repository, tooling, API contract, and API and dashboard skeletons. See the [roadmap](docs/plan/07-roadmap.md).

## Quick start

You need Git, Node.js 24 and pnpm 12. Step-by-step instructions for Windows: [Set up your computer](docs/guides/02-setup-on-windows.md).

```bash
git clone https://github.com/ALPHA-TEAM-dev/samtec-security-system.git
cd samtec-security-system
pnpm install
pnpm dev:web
```

Open http://localhost:5173. The dashboard runs with mock data, so no backend is needed.

To run the full system with the API and a local database (no Docker needed):

```bash
# Terminal 1: start the database and leave it running
pnpm db:start

# Terminal 2: first time only
cp apps/api/.env.example apps/api/.env
pnpm db:migrate
pnpm db:seed

# Terminal 2: API and dashboard together
pnpm dev
```

## What is inside

| Folder | What it is | Built with |
|---|---|---|
| [`apps/web`](apps/web) | The dashboard | React 19, Vite 8, Tailwind CSS 4, shadcn/ui, TanStack Query, MSW |
| [`apps/api`](apps/api) | The API | NestJS 12, Prisma 7, PostgreSQL 17, Zod 4 |
| [`packages/contracts`](packages/contracts) | The API contract shared by both apps | OpenAPI 3.1, openapi-typescript |
| [`docs`](docs) | The plan and beginner guides | Markdown, readable in Obsidian |

## Documentation

Start at [docs/README.md](docs/README.md). New to the project? Read [How the system works](docs/guides/01-how-the-system-works.md) first.

## Working on the project

- [CONTRIBUTING.md](CONTRIBUTING.md): branches, commits, pull requests and the four-lens review
- [SECURITY.md](SECURITY.md): the rules for personal data, secrets and dependencies
- `pnpm check` runs everything CI runs: lint, contract check, type check, tests and build

## Team

- **Samuel**: dashboard (frontend). SAMTEC is his final year project.
- **Francis**: API (backend).
