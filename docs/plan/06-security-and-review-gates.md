# 06 · Security and review gates: the four lenses

The senior roles on this project (architect, senior developer, full-stack engineer, cybersecurity analyst) are **built into the process**, not left as advice. Every pull request and every phase exit is checked through all four lenses.

## Where the lenses live

| Place | What it does | When it runs |
|---|---|---|
| `.github/pull_request_template.md` | The four checklists appear in every pull request, for a person to tick | Every pull request |
| `.claude/agents/*-lens.md` | Four Claude Code reviewer agents, one per lens | On request |
| `.claude/skills/lens-review/` | The `/lens-review` command runs all four agents in parallel and combines their verdicts | Before opening or merging a pull request; `/lens-review phase` at a phase gate |
| `.github/workflows/ci.yml` | Automated checks that no one can forget: lint, contract, types, tests, build, migrations, audit | Every push to a pull request |

How to use them day to day: [Using Claude Code](../guides/07-using-claude-code.md).

## Lens 1: Architect. Does it still fit the design?

- [ ] The change lives in the right module. No module writes to another module's tables.
- [ ] The contract changed first. There are no undocumented endpoints.
- [ ] No new infrastructure or dependency without a note in [Stack decisions](02-stack-decisions.md).
- [ ] The rules in [System architecture](03-system-architecture.md) and [Data model](04-data-model.md) still hold, or were consciously changed and documented.

## Lens 2: Senior developer. Is it built well?

- [ ] Types are strict with no `any`. Inputs are validated with Zod at the boundary.
- [ ] Errors are handled and returned as Problem Details. No promise is left un-awaited.
- [ ] Payroll and detection logic have unit tests with edge cases. Endpoints have at least a success test and an access-denied test.
- [ ] Names state their units where confusion is possible: `pesewas`, `Utc`, `minutes`.
- [ ] Migrations were read before merging and do not lose data.

## Lens 3: Full-stack. Does the seam hold?

- [ ] The dashboard uses only the generated API client. No hand-written fetch calls.
- [ ] Mock handlers match the contract.
- [ ] Every new screen has loading, empty and error states.
- [ ] Pagination and time zones display correctly: stored in UTC, shown in Africa/Accra time.
- [ ] Kiosk screens work in the browser of a cheap Android tablet.

## Lens 4: Security analyst. What would I attack?

- [ ] Object-level authorization is tested: can guard A read guard B's payslip? A test must prove the answer is no.
- [ ] Maker–checker cannot be bypassed by calling the API directly, even if the dashboard hides the button.
- [ ] The device ingest endpoint verifies each device's HMAC signature, ignores repeated punches and rejects oversized batches.
- [ ] No secrets or personal data in logs. Biometric templates are never logged and never leave the server unencrypted.
- [ ] Sign-in and ingest are rate-limited. Repeated failed sign-ins slow down and lock.
- [ ] `pnpm audit` is clean, or every finding is explained in writing.
- [ ] Database access uses Prisma's query builder. Any raw SQL is reviewed by both developers.

## Security controls

| Control | Implementation | Status |
|---|---|---|
| Secure headers | Helmet on every response; `X-Powered-By` removed | **Phase 0** |
| Cross-origin requests | CORS limited to the dashboard's own address (`CORS_ORIGINS`) | **Phase 0** |
| Traceable errors | Request ID on every response; Problem Details errors with `traceId`; unexpected errors never reveal internals | **Phase 0** |
| Configuration | Environment variables validated at startup; the API refuses to start with bad values; secret values never printed | **Phase 0** |
| Input validation | Global `StandardSchemaValidationPipe` ready for Zod schemas on every route | **Phase 0** (used from Phase 1) |
| Supply chain | pnpm: package versions under 1 day old refused, versions with a publishing trust downgrade refused, install scripts need approval in `allowBuilds`, git and tarball sources blocked; CI actions pinned to commit SHAs; `pnpm audit` in CI | **Phase 0** |
| Secrets | `.env` git-ignored; `.env.example` placeholders only; Claude Code settings deny reading `.env` | **Phase 0** |
| Transport | HTTPS only, with HSTS, on the hosted demo | Phase 8 |
| Passwords | argon2id; TOTP two-factor required for ADMIN and HR_PAYROLL | Phase 1 |
| Sessions | 15-minute access tokens, rotating refresh tokens, revocation on logout | Phase 1 |
| Rate limiting | Sign-in and device ingest | Phases 1 and 2 |
| Audit | Append-only audit log; payroll approvals and exception resolutions always audited | Phase 1 |
| Biometric data | Templates only, AES-256-GCM at rest, key outside the database, deleted on termination according to the retention policy | Phase 3 |
| Backups | Supabase daily backups plus a database dump before every payroll lock | Phase 4 |

## Law: Ghana Data Protection Act, 2012 (Act 843)

Biometric data is sensitive personal data. SAMTEC therefore:

- records the employee's **consent** during enrollment (a step in the onboarding screen);
- uses biometric data **only for attendance** (purpose limitation);
- keeps a written **retention schedule** and deletes templates when it expires.

This section belongs in Samuel's report and in the client presentation.

## Threat model (update it every phase)

| Threat | Who | Mitigation |
|---|---|---|
| Buddy punching: a friend clocks in for an absent guard | Guard | Biometric-only clock-in; PIN fallback flagged and co-signed by a supervisor |
| Editing payroll after approval | HR user | Locked runs, maker–checker, audit log, database trigger |
| A fake device sending punches | Outsider or insider | Per-device HMAC secret, device registry, clock-drift and volume anomaly detection |
| Stealing biometric templates | Outsider | Encryption at rest; templates are useless without the vendor's matcher; no images stored |
| Replaying captured punches | Network attacker | Idempotency key and payload hash |
| Holding a photo up to the face kiosk | Guard | Anti-spoofing score threshold and a random blink challenge; documented as a version 1 limitation |
| A malicious package version | Supply chain | 1-day release age rule, install-script approval, lockfile, `pnpm audit` |

## Phase exit gate (for every roadmap phase)

A phase is **done** only when all of these are true:

1. Its exit demo runs end to end.
2. The four checklists pass on the phase's changes (`/lens-review phase`).
3. CI is green.
4. The documents in `docs/` still describe what was built.
5. Security findings are fixed, or accepted in writing with a reason.

Related: [Roadmap](07-roadmap.md) · [API contract](05-api-contract.md)
