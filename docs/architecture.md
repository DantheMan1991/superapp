# Architecture

> Layer 0 of the platform: the tenancy model, the module seam, and the
> boundaries every other doc hangs off.
> **Read before:** your first substantial change to this codebase, adding a
> module or pack, or changing anything about tenancy, routing or the module
> seam.
> **Update when:** a layer boundary moves, a new seam is introduced, or a
> statement here stops being true. Same PR.

Companion documents: [security.md](security.md) for the security model and
its checklists, [extension-model.md](extension-model.md) for how industry
functionality is layered on without polluting core,
[conventions.md](conventions.md) for code-level patterns.

---

## 1. What this is

A multi-tenant B2B SaaS platform — "the outsourced business office" — sold to
small businesses that run real operations: field crews, shop floors, jobs. One
Next.js App Router codebase, one Postgres database, one deployment.

Each client is a tenant. Each tenant switches on the tools they pay for.

**It is a monolith, deliberately.** Modules are internal seams, never services.
The tenant isolation guarantee is enforced in one database by RLS; distributing
that across services would multiply the number of places a tenant boundary can
be broken, for a scale problem we do not have.

---

## 2. Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js App Router (see `node_modules/next/dist/docs/` — this version has breaking changes from what you likely know) |
| Database | Neon Postgres, Drizzle ORM, RLS FORCE |
| Identity | Clerk. Organizations are tenants |
| Billing | Stripe. Webhook + server-side reconcile. **The PLATFORM charging the TENANT** |
| Taking payments | Stripe Connect, one connected account per legal entity. **The TENANT charging THEIR customer** — opposite direction, same SDK ([ADR 0015](decisions/0015-a-connected-account-belongs-to-a-company.md)) |
| Files | Vercel Blob |
| Mail | Self-hosted Stalwart over JMAP |
| AI | Claude via `getClaude()` (`src/lib/claude.ts`) |
| Tests | Vitest |

---

## 3. The layers

```
Layer 0   Platform shell        tenancy · auth · billing · RLS · module registry
Layer 1   Core tools            accounting · documents · email
Layer 2a  Capability packs      jobs · dispatch · estimating   (not yet built)
Layer 2b  Industry profiles     plumbing · electrical          (not yet built)
Layer 3   Tenant configuration  one company's tailoring — data only
```

Layers 0 and 1 exist today. Layer 2 is designed and not yet built; its rules —
including why Layer 2 splits into packs and profiles, and how two industries
share a capability without duplicating it — are in
[extension-model.md](extension-model.md). Read that before writing anything
industry-shaped.

**The single most important architectural rule:** Layer 1 is industry-blind.
A core tool that knows what a subcontractor is has already failed.

---

## 4. Tenancy

**Tenant = Clerk Organization**, mirrored into the `tenants` table two ways:

1. By Clerk webhook (the normal path).
2. Idempotently by `/onboarding` (`src/lib/tenant-sync.ts`) — covers webhook lag
   and local development where no webhook is configured.

Both paths must stay idempotent. A user landing on `/onboarding` before the
webhook fires is a routine event, not an error.

Roles within a tenant are `owner` | `staff` | `expert`:

- Clerk `org:admin` → always `owner`.
- Otherwise the local `memberships` row decides `expert` vs `staff`.
- A missing membership row degrades to `staff` — never upward.

`expert` is the platform's own bookkeeper working inside a client's workspace.
`owner` is the business owner. The distinction is enforced in RLS via
`app.tenant_role`, not just in the UI.

### A tenant is the client, not the legal entity

One tenant currently means one set of books, and that stops being true the first
time a client arrives with a property LLC per door. **The tenant is the client
relationship; a legal entity lives inside it and owns the books** — see ADR
[0010](decisions/0010-entities-inside-a-tenant.md), which also explains why
entity is not a `dimension_members` type.

**Built 2026-08-16 (slice 1).** `entities` is a tenant-scoped table with FORCE
RLS; `journal_entries.entity_id` says which set of books an entry belongs to,
composite-FK'd as `(tenant_id, entity_id)`. Every tenant has exactly one today
and never sees the word — the picker appears at two.

Three things follow for anything written from here on:

- **Every report engine takes a required `EntityScope`** (`core/entities.ts`),
  never an optional one. A report that forgot its scope would be silently wrong
  across companies and perfectly correct on the single-company tenant you are
  testing on, so forgetting is made a compile error. Declining a scope is
  allowed where mixing sources would be dishonest — the tax summary does, and
  says why in its own comment.
- **RLS is NOT the wall between two companies of one client**, deliberately, and
  that is the ADR's own stated cost. It remains absolute between CLIENTS. Do not
  add an `app.current_entity`; the separation is application code.
- **A table with a balance on it carries an entity.** `invoices`, `bills` and
  `bank_accounts` do (`0145`), and every entry they post reads it from the
  document. A new table with a balance is expected to do the same. `period_closes`
  is the outstanding one — a close still locks every company at once.
- **A journal line may not touch a register owned by another company**, enforced
  in `postEntry`. Money moving between two of a client's companies is an
  intercompany transaction needing a linked pair of entries, and until that
  exists it is refused rather than recorded as one wrong entry.

---

## 5. Request lifecycle

Tracing a tenant page request end to end — this is the spine of the system.

```
  Browser
    │
    ├─ proxy.ts ────────────── "is there a Clerk session?"  ← NOT authorization
    │     (Next 16's name for middleware.ts) and one routing decision: a
    │     request to <slug>.<SITE_DOMAIN> is a tenant's public website and is
    │     rewritten to /hosted/<slug>/… (ADR 0019). Everything else passes.
    │
    ├─ layout / page (server component)
    │     requireTenant()  ──── Clerk session → active org → tenants row → role
    │                           redirects to /sign-in or /onboarding
    │
    ├─ getActiveModules(tenantId) ─── which tools this tenant has switched on
    │
    ├─ module renders
    │     • /dashboard/m/[slug]   → moduleRegistry[slug].Component({ ctx })
    │     • /dashboard/m/<slug>/… → the module's own route tree
    │
    └─ data access
          withTenant(ctx.tenant.id, fn, { role: ctx.role })
             └─ BEGIN
                set_config('app.role',        'member')
                set_config('app.tenant_id',   <uuid>)
                set_config('app.tenant_role', <role>)
                … queries run under RLS …
                COMMIT
```

A server action submitted from that page repeats **all** of it. It re-runs
`requireTenant()`, re-checks module entitlement, and opens its own
`withTenant()`. The page having authorized proves nothing about the action.

Route handlers under `src/app/api/**` follow the same shape but use
`resolveTenantContext()`, which returns `null` instead of redirecting — a route
handler must answer JSON, not a 307.

---

## 6. Data access seam

Two functions, in [src/db/index.ts](../src/db/index.ts):

- **`withTenant(tenantId, fn, { role })`** — every tenant-scoped query. Opens a
  transaction, sets RLS context. `role` defaults to `staff` (least privileged),
  so forgetting it denies a read and can never grant one.
- **`withSystem(fn)`** — the god view. Only after `requireSuperAdmin()`, or in
  trusted sync code: webhooks, `tenant-sync.ts`, `logAudit`, seeds, migrations.

**All four context settings are written in ONE statement**, and that is a
performance decision worth not undoing. They used to be four separate
`set_config` round trips, so establishing context cost four before the caller's
own query ran — six with the `BEGIN` and `COMMIT`. Collapsing them to one
measured **30% off the whole database suite** (145s → 102s over a fixed subset,
three runs each, under 1% variance) and takes the same three round trips off
every production request that touches a tenant table. The semantics are
identical: `set_config`'s third argument is `is_local`, so each is still
transaction-scoped. `tests/isolation/core.test.ts` asserts all four actually
land, because a silent failure would hide owners-only rows and whole mailboxes
without looking like an error.

RLS is the backstop, not the primary control — but it is the one that catches
the mistakes the primary controls miss. A query that forgets its `WHERE` clause
returns nothing instead of another client's data. Details and the full rule set:
[security.md](security.md).

Two database roles, and the distinction matters:

- `DATABASE_URL` → `app_user`, **no** `BYPASSRLS`. Runtime.
- `DATABASE_URL_OWNER` → Neon owner, **has** `BYPASSRLS`. Migrations and seeds
  only. Never runtime.

---

## 7. The module seam

A module is a togglable feature rendered inside the client dashboard shell.
Three pieces have to agree:

| Piece | Where | Owns |
| --- | --- | --- |
| Registry row | `modules` table, seeded by `scripts/seed.ts` | What exists and is sellable — name, category, `available` vs `coming_soon` |
| Per-tenant switch | `tenant_modules` | Whether this client has it on, plus `config` jsonb (Layer 3) |
| Renderer | `src/modules/<slug>/` + `src/modules/index.ts` | How it draws |

`ModuleDefinition` ([src/modules/types.ts](../src/modules/types.ts)) carries the
slug, display name, lucide icon name, an optional `layout` hint, and the server
component. `layout: "full"` exists so a module can declare it wants the whole
viewport (mail's list-beside-detail) without the shell having to recognise
module names to lay them out — the shell stays ignorant of what modules are.

Modules render two ways, and both are legitimate:

- **Registry-rendered** — one component at `/dashboard/m/[slug]`. Right for
  simple modules.
- **Own route tree** — `src/app/dashboard/m/<slug>/…`, as accounting and
  documents do. Right once a module has real internal navigation.

Gating is `requireModuleEnabled()` (`src/lib/modules.ts`). It is an
**entitlement** check — it stops a tenant using something unpaid. It is not a
security boundary; RLS is.

### Empty slots are a feature

Modules stay `coming_soon` until a paying client pulls them in. Resisting the
urge to pre-build is the discipline the whole platform is built on — an empty
slot costs nothing, a speculative module costs forever.

---

## 8. Platform data vs tenant data

Not everything is tenant-scoped, and mixing them up is a security bug.

- **Tenant-scoped** — has `tenant_id`, RLS-policied, reached via `withTenant`.
  Nearly everything.
- **Platform-level** — `modules` (the catalogue), `audits` (Discovery copilot
  data, superadmin-only policy), `audit_log`. Reached via `withSystem` after
  `requireSuperAdmin()`.

When adding a table, decide which it is *before* writing the migration. A
platform-level table that should have been tenant-scoped is a cross-tenant leak.

---

## 9. Directory map

```
src/
  app/
    (auth)/            sign-in, sign-up
    admin/             superadmin: clients, modules, retainers, audits, docs
    api/               route handlers — webhooks, blob, inbound mail
    dashboard/         the tenant product
      m/[slug]/        registry-rendered modules
      m/<slug>/        modules with their own route trees
    onboarding/        idempotent tenant sync
    health-check/      public AI interview funnel (prospects)
    s/[token]/         public document share links
  components/          shared UI + app shell
  db/
    index.ts           withTenant / withSystem — the data access seam
    schema/            all tables, one file per domain; index.ts is the barrel
  lib/                 platform machinery: auth, audit, crypto, billing,
                       claude, email, blob, modules, tenant-sync
  modules/             Layer 1 — core tools
docs/
  architecture.md      this file
  security.md          the security model and its checklists
  extension-model.md   layering, packs, industry profiles
  conventions.md       code-level patterns
  decisions/           ADRs — why, dated
  modules/<slug>.md    per-module dossiers (source of truth)
drizzle/               migrations, including hand-written RLS policies
tests/                 vitest; tests/isolation/ is the certification suite
scripts/               migrate, seed, create-app-role, probes
```

---

## 10. Cross-cutting machinery

- **Audit** — `logAudit()` for general sensitive actions; `logAuditInTx()` for
  financial mutations, so the mutation and its audit row commit together.
  **Reading it back: `src/lib/audit-detail.ts`** turns `meta` into readable
  pairs for `/admin/audit`, and diffs a `{ was, now }` correction down to the
  fields that MOVED — `meat withdrawal days: 21 → 28`. It is deliberately
  generic and defensive, because `meta` is jsonb written by 200+ call sites and
  a malformed blob must not take down the page a superadmin uses to find out
  what happened.
  **There is a SECOND describer and it is not a duplicate.**
  `modules/accounting/history/format.ts` → `describeAuditMeta` is a curated
  whitelist producing prose for the CLIENT-facing record-history panel on an
  invoice or a bill ("INV-1042 · 3 lines · 5 days before due"). Different
  audience, different job: completeness wins on the superadmin page, polish wins
  on the client one. Do not unify them into a key-value dump.
- **Encryption** — `encryptSecret()` / `decryptSecret()`, AES-256-GCM, one key.
- **Billing** — Stripe webhook plus a server→Stripe reconcile on billing page
  load, which covers missed events and local development. This is the platform
  charging the tenant.
- **Taking payments** — the OTHER direction, and the two must not get tangled.
  Stripe Connect, a connected account per legal entity, hosted KYC, payouts to
  the client's own bank. Same shape as billing on purpose — a Connect webhook
  plus a server→Stripe reconcile on page load — but its own route, its own
  signing secret and its own table, because `subscriptions` and
  `payment_accounts` point in opposite directions. Platform-level machinery
  with its own dossier.
- **AI** — all Claude calls through `getClaude()`. Lazy client, adaptive
  thinking, streamed. Model output is untrusted input: validate it.
- **Retainer hours** — platform-level machinery with its own dossier.

Every provider client is **lazy**. `npm run build` must stay green with no keys
set; that property is what keeps CI and fresh clones working, so do not read env
vars at module scope.

---

## 11. Commands

```bash
npm run db:migrate      # run as DATABASE_URL_OWNER
npm run db:seed
npm run db:generate     # then a --custom migration for RLS policies
npm run db:create-role  # create/rotate app_user
npm run test:isolation  # the two-tenant RLS certification — required pre-deploy
npm run build
```

Migrations run against **both** the dev branch and production. A migration
applied to only one of them is a broken environment waiting to surface.

---

## 12. Architectural invariants

Security invariants are numbered `S1–S12` in [security.md](security.md).
These are the structural ones:

**A1 — One codebase, one database.** Modules are seams, never services.

**A2 — Layer 1 is industry-blind.** No core tool knows what industry a tenant
is in. [extension-model.md](extension-model.md).

**A3 — Per-client differences live in config and data, never forked code.**

**A4 — The shell never knows a module's name to make a decision.** Modules
declare what they need (`layout`, icon, nav); the shell reads declarations. Any
`if (slug === "email")` in shell code is a defect.

**A5 — Provider clients are lazy.** The build stays green without keys.

**A6 — Modules stay `coming_soon` until a paying client pulls them in.**

**A7 — Every module PR updates its dossier's build log.** The dossiers are what
agents read before making changes; a stale dossier misleads every future
session.
