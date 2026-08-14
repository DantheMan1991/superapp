# Packs & profiles (Layer 2 machinery)

> The mechanism that lets an industry exist without an industry module: how a
> capability pack is registered and switched on, how an industry profile
> installs a set of them, and where vocabulary comes from. This is the plumbing
> under [extension-model.md](../extension-model.md) — read that first for *why*,
> read this for *how*.
> Status: `coming_soon` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-08-13 — Design settled, no code yet (`claude/packs-and-profiles-design`)
- Answered the two mechanism questions ADR 0004 left open, as
  [ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md): a
  pack is a `modules` row with `category = 'pack'`, and a profile is a one-time
  installer rather than a live binding.
- Audited what already exists. The result is the headline of this document:
  **most of the machinery is built.** `modules.category`, `tenant_modules.config`,
  `tenants.industry`, `requireModuleEnabled()` and `dimension_members` were all
  put in place for this and have been waiting.
- Scoped what is genuinely missing: the manifest layer, dependency enforcement,
  install-time seeding, and the P5 extension points ADR 0004 predicted would be
  forced first.
- Driven by the first real profile,
  [homestead-farm.md](homestead-farm.md), which has a pilot tenant.

## What already exists

Nothing in this table needs building. It is listed because the natural instinct
when starting Layer 2 is to build a parallel set of all of it.

| Piece | Where | What it already does |
| --- | --- | --- |
| `modules.category` | [platform.ts:268](../../src/db/schema/platform.ts:268) | Defaults to `'core'`. `'pack'` is the second value. |
| `tenant_modules.enabled` | [platform.ts:281](../../src/db/schema/platform.ts:281) | Per-tenant on/off. Works for packs unchanged. |
| `tenant_modules.config` | [platform.ts:281](../../src/db/schema/platform.ts:281) | jsonb. Layer 3 tailoring **and** per-tenant label overrides. |
| `tenants.industry` | [platform.ts:78](../../src/db/schema/platform.ts:78) | text, `default 'general'`. The installed profile slug. |
| `requireModuleEnabled()` | [modules.ts:52](../../src/lib/modules.ts:52) | 404s when off. Works for packs unchanged. |
| `getActiveModules()` | [modules.ts:13](../../src/lib/modules.ts:13) | Builds the nav, ordered by `sortOrder`. |
| `moduleRegistry` | [modules/index.ts:16](../../src/modules/index.ts:16) | slug → renderer. Packs merge into this at runtime. |
| `dimension_members` | [ledger.ts:189](../../src/db/schema/ledger.ts:189) | **The costing seam.** Packs sync entities here in their own transaction; core never imports pack tables. See [dimensions.ts:9](../../src/modules/accounting/core/dimensions.ts:9). |
| `work_item_links` | [work.ts:301](../../src/db/schema/work.ts:301) | Open `entity_type` + `extension_slug` (P3). A pack entity becomes linkable with no core migration. |
| `documents.doc_kind` / `.metadata` | [documents.ts:101](../../src/db/schema/documents.ts:101) | P1 open taxonomy and P2 extension bag. |

**Consequence worth stating loudly: Layer 2 v1 needs zero new tables.** Manifests
and dependency declarations are code-side. Enablement, config, seed data and
cost dimensions all land in tables that already exist and already have RLS.

## What has to be built

| # | Thing | Why it's needed |
| --- | --- | --- |
| 1 | `src/packs/` + merged runtime registry | Separate tree so packs don't drift into core; one registry so nav/routing/guards never fork. |
| 2 | `src/industries/<slug>.ts` manifests | Turns N toggles and a chart of accounts into one decision. |
| 3 | Dependency declaration + enforcement | `production` without `inventory` is a runtime failure today; it should be a refusal at enable time. |
| 4 | The install action | Enable packs, seed accounts/folders/doc kinds, stamp `tenants.industry` — one transaction, audited. |
| 5 | Label resolution | Reads the manifest live, overridden by `tenant_modules.config`, degrading to the default. |
| 6 | Nav grouping by `category` | Seven packs beside six core modules is a 13-item flat list. |
| 7 | **P5 extension points** | ADR 0004 predicted nav contribution and entity-type registration would force this first. They do. |

## The shapes

Planned, not yet written. Recorded so the first pack doesn't improvise.

```
src/modules/      Layer 1 — core tools. Industry-blind.
src/packs/        Layer 2a — capability packs. Also industry-blind.
  land/  assets/  inventory/  livestock/  crops/  production/  retail/
src/industries/   Layer 2b — profiles. Manifests only, no components.
  homestead-farm.ts
```

A pack declares what it needs; it never declares who uses it:

```ts
export interface PackDefinition extends ModuleDefinition {
  /** Packs that must be enabled first. Enforced at enable time, not runtime. */
  requires: string[];
  /** Dimension types this pack syncs into dimension_members. */
  dimensionTypes?: string[];
  /** Entity types this pack registers for work/mail/schedule links (P3). */
  entityTypes?: string[];
}
```

A profile is data, per [extension-model.md §5](../extension-model.md):

```ts
export interface IndustryProfile {
  slug: string;                    // "homestead-farm"
  name: string;                    // "Homestead Farm"
  packs: string[];                 // installed, then owned by the tenant
  labels: Record<string, string>;  // resolved LIVE, overridable per tenant
  seed: {
    accounts?: CoaSeedRow[];
    folders?: DefaultFolder[];
    docKinds?: string[];
  };
  packConfig: Record<string, unknown>;  // packs read their own key, never the slug
}
```

Sharing between profiles is by **spreading a constant**, never inheritance.

## Data model

No new tables. Existing columns take on new values:

| Table | Column | Change |
| --- | --- | --- |
| `modules` | `category` | Gains the value `'pack'`. Was already text with no constraint. |
| `tenant_modules` | `config` | Gains an optional `labels` key for per-tenant vocabulary overrides. |
| `tenants` | `industry` | Becomes meaningful — it is the installed profile slug, not a descriptive tag. |

Pack-owned tables follow the ordinary rules: `tenant_id`, FORCE RLS, a
`--custom` policy migration, and isolation-test coverage
([security.md §4](../security.md)).

## Decisions & gotchas

- **[ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md)** —
  a pack is a module row; a profile installs rather than binds. Read the
  consequences section before assuming a profile edit reaches live tenants. It
  does not.
- **[ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md)** —
  packs are industry-blind. No `if (industry === …)`, ever, in a pack or in core.
- **Naming is load-bearing.** "The farm module" grants permission to build farm
  things inside it. Say "the `livestock` pack, listed by the homestead-farm
  profile" in code, commits and conversation.
- **`tenants.industry` currently defaults to `'general'`**, so the
  no-profile-installed path is the common one. Label resolution must degrade
  silently rather than throw — it will run on every request for every tenant
  that has never installed a profile.
- **The costing seam is the point.** A pack that tracks activity without syncing
  a dimension member and posting to the ledger has built a to-do list. The
  reason this platform's version of an industry is worth anything is that every
  activity lands on a cost object and rolls into the books.
- **Allocation belongs to the pack, and follows the house rounding rule.** Any
  pack at scale hits the same problem: one cost serves many cost objects (feed
  from a shared bin across pens; overhead across jobs), so it must be allocated
  by a rule rather than assigned. The pack computes the split and posts ordinary
  dimension-tagged journal lines — **core needs no allocation concept and must
  not grow one**, or it stops being neutral. The arithmetic is not free-form:
  [cash-basis-allocate.ts](../../src/modules/accounting/core/cash-basis-allocate.ts)
  is the house precedent — "THE ONE PLACE IN REPORT MATH THAT DIVIDES",
  quarantined, with an exact remainder rule so no cent is invented or lost. A
  pack allocator does not get its own rounding.
- **The SKU is the profile, never the pack** (decided 2026-08-13). A tenant buys
  "Homestead Farm", not seven line items. The rejected alternative was per-pack
  pricing, which fails on two counts: packs have hard dependencies, so a cart of
  parts can be assembled into a broken product; and a pack listed by two
  profiles (`assets` is in both homestead-farm and any trades profile) would
  either be double-sold or need cross-profile entitlement logic. Pricing the
  profile makes `assets` reach the trades market with no pricing change at all.
  **Therefore packs must never appear in a client-facing catalogue.** Today that
  is free — no such catalogue exists, and the tenant nav is built only from
  enabled modules ([layout.tsx:31](../../src/app/dashboard/layout.tsx:31)). If a
  store page is ever built, it filters on `category = 'core'`.

## Open items

- **P5 extension points** (#7 above) — the primitive ADR 0004 named and nobody
  has built. Nav contribution and entity-type registration force it.
- **Dependency enforcement** — declared in `PackDefinition.requires`, not yet
  checked anywhere.
- **Re-apply and drift** — a profile edit does not reach installed tenants. No
  action to re-run an installer, and no report of how a tenant differs from its
  manifest. Accepted cost in ADR 0009; revisit when it bites.
- ~~Billing granularity~~ — **settled 2026-08-13: the SKU is the profile.** See
  Decisions above. What remains is the mechanism: `subscriptions` is per-tenant,
  so nothing needs to change until a second profile is priced differently.
- **Two profiles on one tenant** is mechanically fine (run both installers) but
  `tenants.industry` can only record one, so label resolution would pick a
  winner. First thing to revisit per ADR 0009.
- **Units of measure.** Farms, and any pack touching `inventory`, need
  conversions (head, lb, bushel, dozen, bale, ton, gallon, acre). Only
  `invoicing` has any quantity notion today. This is a day-one decision for the
  `inventory` pack and a rewrite if deferred.
- **Cleanup of the known core leaks** in
  [extension-model.md §8](../extension-model.md) — the trades vocabulary sitting
  in core folders, the general chart of accounts and the client-creation form's
  `"construction"` default. The first profile install makes these visible.
