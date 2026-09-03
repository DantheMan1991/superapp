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
  Optional third argument `{ role }` sets `app.tenant_role` so a policy can
  tell owners from staff (the Documents module's owners-only folders depend on
  it). It defaults to `'staff'`, the least privileged value — pass
  `{ role: ctx.role }` when reading anything visibility-bearing, and never a
  role that did not come from `requireTenant()`/`resolveTenantContext()`.
- **Authorization is server-side on every request**: `requireSuperAdmin()`,
  `requireTenant()`, `requireTenantOwner()` in `src/lib/auth.ts`. The
  middleware only checks "signed in".
- **Zod-validate every boundary** (server actions, webhooks).
- **Billing state is written only from trusted Stripe data**: the
  signature-verified webhook, or a server→Stripe API reconcile
  (`src/lib/billing-sync.ts`, run on billing page load for local dev /
  missed events). Never from client input. Card data never touches this
  server.
- **Audit sensitive actions** via `logAudit()` — identifiers only, never
  secrets/PII.
- **Claude API calls** go through `getClaude()` (`src/lib/claude.ts`, lazy,
  model `claude-opus-4-8`, adaptive thinking, streamed). The Discovery
  copilot (`/admin/audits`, prompts in `src/lib/discovery.ts`) is
  superadmin-only; `audits` is platform-level data with a superadmin-only
  RLS policy.

## Adding a module (the Phase 2 workflow)

1. Row in `scripts/seed.ts` (status `available`) + re-seed.
2. Renderer in `src/modules/<slug>/` + entry in `src/modules/index.ts`.
3. Tables: declare them in the right `src/db/schema/<domain>.ts` (the barrel
   `index.ts` re-exports every domain, so `@/db/schema` is unchanged). Include
   `tenant_id`, add RLS policies in a new migration
   (`npm run db:generate`, then a `--custom` one for policies).
4. Server actions: `requireTenant()` + `requireModuleEnabled()` + `withTenant()`.
5. Extend the certification suite — `tests/isolation/<area>.test.ts`, one file
   per area — to cover the new tables.
6. Dossier: create `docs/modules/<slug>.md` from `_TEMPLATE.md`.
7. Guide: create `docs/help/<slug>/overview.md` from `docs/help/_TEMPLATE.md`
   with `**Route:** /dashboard/m/<slug>/**`, so every screen in the module has
   a help panel from its first day.

Modules stay "coming_soon" empty slots until a paying client pulls them in —
that discipline is the whole point of the build brief.

## Build docs (source of truth for humans AND agents)

Everything under `docs/` is the build record, rendered read-only in the
superadmin UI at `/admin/docs` (`src/lib/build-docs.ts` walks the whole
tree — a new file appears on the page with no code change) — **except
`docs/help/`, which is written for the client**: the tenant guides, rendered
inside the product at `/dashboard/guides` and in every page's help panel,
and skipped by the build-docs walker:

| Where | What | When it changes |
| --- | --- | --- |
| `docs/modules/<slug>.md` | Dossier per module *and* per platform-level area (retainer-hours, public-site, health-check, mail-infrastructure): purpose, build log, data model, decisions & gotchas, open items | Every PR that touches that area |
| `docs/*.md` | `architecture`, `security`, `conventions`, `extension-model` — the invariants every module inherits | When a boundary moves or a statement stops being true |
| `docs/decisions/` | ADRs. Immutable once accepted — reverse one by writing a new ADR that supersedes it | When a decision closes off a credible alternative |
| `docs/runbooks/` | Operational procedures | When a step turns out to be wrong |
| `docs/help/<feature>/<topic>.md` | Tenant-facing how-to guides, in the client's voice (`docs/help/_TEMPLATE.md` explains the header, the `**Route:**` grammar and `{{vocabulary}}`), rendered at `/dashboard/guides` and in the page help panel | Every PR that changes a screen the guide describes |

- **Every PR MUST update the doc for what it changed** — a build-log entry
  (date, short title, what/why) in the dossier, plus the other sections if
  the data model or a decision changed. This is not optional documentation
  polish; these files are the context agents read before making changes.
  Work that has no dossier yet gets one, from `docs/modules/_TEMPLATE.md`.
- **Write the doc in the same PR.** The four platform docs above sat
  uncommitted for a week while the module dossiers stayed current — a doc
  that is not committed does not exist, and one the page cannot read may as
  well not be.
- **A PR that changes a screen updates its guide.** The guide is what the
  client reads with the screen open beside it; a button it names that is no
  longer there is worse than no guide. A new screen in a module that has a
  guide gets a section; a new module gets an `overview.md` (step 7 above).
- **Keep a dossier readable.** It is read at the START of every session that
  touches the area, so its length is a tax on every future change to it. When a
  build log outgrows a few screens, sweep the older entries into
  `docs/modules/<slug>-build-log.md` — build-docs walks the whole tree, so the
  archive renders with no code change. `email.md` reached 3,894 lines, 78% of it
  build log, before this rule was written down.
- **At the start of a session that modifies an area, read its dossier
  first** — it's cheaper and more reliable than re-deriving state from git
  history.
- Per-client differences live in config/data, never forked code — the
  dossier describes THE module, not per-tenant variants.

## Commands

- `npm run db:migrate` / `db:seed` / `db:generate` / `db:verify-rls` — run as
  the owner URL (`DATABASE_URL_OWNER`).
- **NOTHING IN THE DEPLOY APPLIES MIGRATIONS, and `main` auto-deploys.** A merged
  PR is live within minutes; its migration is not. Apply it yourself, in this
  order, **before** merging: `npm run db:migrate -- --dev`, then
  `npm run db:migrate`, then `npm run db:verify-rls -- --dev` and
  `npm run db:verify-rls` to prove in `pg_class`/`pg_policies` that the table is
  there with RLS enabled AND forced and its policies present. CI cannot check
  this — it builds its own database from zero, so every migration always applies
  there — and the `migrations` job only refuses a migration PR that is missing
  the `full-tests` label. Skipping the step is what took `/dashboard/m/production`
  down for five hours on 2026-08-23; see
  [ADR 0014](docs/decisions/0014-migrations-are-applied-before-the-merge.md).
- `npm run db:create-role` — creates/rotates the `app_user` role the app
  connects as. Required: Neon's owner role has BYPASSRLS, so the app must
  never run as it (`DATABASE_URL` = app_user).
- `npm run test:isolation` — the two-tenant RLS certification; must pass
  before any deploy. Needs **`TEST_DATABASE_URL`** (plus
  `TEST_DATABASE_URL_OWNER`) pointing at a database that is NOT production —
  a Neon branch takes a minute to make. `tests/setup/database-guard.ts`
  enforces this: without it, every DB-backed suite skips and says so loudly,
  because these tests create and delete tenants under `withSystem` where RLS
  is not watching. A skipped isolation run is not a passing one.
- `npm run build` — must stay green; keys are not required for the build
  (all provider clients are lazy).
- **CI runs lint, `tsc`, the build and the whole suite on every push and PR**
  (`.github/workflows/ci.yml`), against a dedicated Neon `ci` branch. You do not
  need a full local run to open a PR — push and let it report. Run
  `test:isolation` locally when you have touched RLS or a tenant table, because
  waiting on CI to learn that is the slow way round.
- `npm test` runs two projects: `pure` in parallel, `db` sequentially. If
  `tests/db-backed-files.test.ts` fails, a suite changed which side it belongs
  on — update the list in `tests/db-backed-files.ts`. See
  [docs/modules/ci-and-tests.md](docs/modules/ci-and-tests.md).
