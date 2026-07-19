<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SuperApp — Platform Shell (Layer 0)

Multi-tenant B2B SaaS shell for "The Outsourced Business Office". Strategy
and phase scope live in the two briefs the project was built from; the rules
that matter for code:

## Architecture rules (non-negotiable)

- **Monolith.** One Next.js App Router codebase. Modules are internal seams,
  never services.
- **Tenant = Clerk Organization**, mirrored to `tenants` by webhook AND
  idempotently by `/onboarding` (`src/lib/tenant-sync.ts`).
- **Every tenant-scoped query goes through `withTenant(tenantId, fn)`**
  (`src/db/index.ts`). It opens a transaction and sets the RLS context.
  `withSystem(fn)` is the god view — only after `requireSuperAdmin()` or in
  trusted sync code (webhooks, audit, seeds). Postgres RLS (FORCE) is the
  backstop: no context → no rows.
- **Authorization is server-side on every request**: `requireSuperAdmin()`,
  `requireTenant()`, `requireTenantOwner()` in `src/lib/auth.ts`. The
  middleware only checks "signed in".
- **Zod-validate every boundary** (server actions, webhooks).
- **Billing state is written only by the Stripe webhook** (signature-verified).
  Card data never touches this server.
- **Audit sensitive actions** via `logAudit()` — identifiers only, never
  secrets/PII.

## Adding a module (the Phase 2 workflow)

1. Row in `scripts/seed.ts` (status `available`) + re-seed.
2. Renderer in `src/modules/<slug>/` + entry in `src/modules/index.ts`.
3. Tables: include `tenant_id`, add RLS policies in a new migration
   (`npm run db:generate`, then a `--custom` one for policies).
4. Server actions: `requireTenant()` + `requireModuleEnabled()` + `withTenant()`.
5. Extend `tests/tenant-isolation.test.ts` to cover the new tables.

Modules stay "coming_soon" empty slots until a paying client pulls them in —
that discipline is the whole point of the build brief.

## Commands

- `npm run db:migrate` / `db:seed` / `db:generate` — run as the owner URL
  (`DATABASE_URL_OWNER`).
- `npm run db:create-role` — creates/rotates the `app_user` role the app
  connects as. Required: Neon's owner role has BYPASSRLS, so the app must
  never run as it (`DATABASE_URL` = app_user).
- `npm run test:isolation` — the two-tenant RLS certification; must pass
  before any deploy. Needs `DATABASE_URL` (dev/staging DB, never prod).
- `npm run build` — must stay green; keys are not required for the build
  (all provider clients are lazy).
