# Packs & profiles (Layer 2 machinery)

> The mechanism that lets an industry exist without an industry module: how a
> capability pack is registered and switched on, how an industry profile
> installs a set of them, and where vocabulary comes from. This is the plumbing
> under [extension-model.md](../extension-model.md) — read that first for *why*,
> read this for *how*.
> Status: partial — registry, dependency enforcement and profile install are built; seed application is not · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-08-16 — The vocabulary editor was showing the wrong words (`claude/vocabulary-truth`)

Both admin surfaces from the registry PR were driven for the first time. Both
work; both said something untrue.

**The editor showed the PACK's word, not the client's.** A homestead farm whose
every Land screen says *Paddock* had a field headed **Zone**, placeholder
**Zone**, under a heading reading *"The words this client sees."* Its help text
then promised that clearing the box would give you "Zone" — clearing it gives
you *Paddock*. Confirmed live by typing `Block`, watching the whole Land module
say "blocks", clearing it, and watching it go back to **Paddock** rather than
Zone.

- **Vocabulary has THREE layers** — the pack declares `zone`, the profile
  renames it to `Paddock`, the tenant may rename it again — and the editor knew
  only the first and the third. The middle one is the one an industry profile
  exists to supply.
- **`labelRows` in `resolve.ts`, beside `resolveLabels`.** The page was doing
  this arithmetic inline, which is how it drifted from the renderer.
  `resolveLabels` answers *"what word do I render?"*; `labelRows` answers *"and
  where did it come from?"* — the question an editor must answer and a renderer
  never does. Same file so they cannot disagree twice, including on the rule
  that an empty string is not a rename.
- The field now shows the effective word, and says *"Homestead Farm calls this
  Paddock; the built-in word is Zone"* when a profile is overriding.

**The installer claimed work it had not done.** Re-running an install on a
tenant with all seven packs already on reported *"Installed — 7 packs switched
on"*. Nothing was switched on. `enableRow` now returns whether it changed
anything, and the toast reports *"nothing to change, all 7 packs were already
on"* or *"3 of 7 packs switched on"*. The audit entry records `switchedOn`
alongside the full list, so the log distinguishes them too.

Neither is a data bug — both would have gone on quietly misinforming the only
person who reads these screens.

### 2026-08-15 — Is it a decision, or is it a chore? (`claude/pack-write-levels`)

Every pack shipped owner-only, as four private copies of `requireOwner`. That
was survivable while the packs were registers of things you buy. The next slice
is livestock's daily log, and **a daily-entry surface only the owner can use is
built for the wrong person** — at ten times the pilot's size there are two or
three people doing chores and none of them signs cheques.

- **The rule, in one question: is this a decision, or is it a chore?** Declaring
  that North Pasture is hay ground this year is a decision. Recording that four
  birds died is a chore, and the person doing it is standing in the pen. Every
  pack write now says which, and the four copies collapse into one
  `allowsWrite(role, level)` in `src/lib/packs/authorize.ts`.
- **The line is not taste — it is forced from below.** `upsertDimensionMember`
  in accounting core calls `requireOwnerRole`. Anything that CREATES a cost
  object must be owner-only, or the write succeeds while its cost object does
  not, leaving an entity no report can group by. That constraint lands exactly
  on the decision/chore line, which is why this was a small change rather than a
  negotiation with the ledger.
- **Where it fell.** Owner: parcels, zones, zone uses, items, lots, assets,
  maintenance schedules and raising due maintenance, creating/editing/splitting
  a livestock lot. Member: occupancy, inventory movements and merges, placing
  and losing head, moving a lot, tagging, meter readings and service records.
- **Splitting stayed with the owner deliberately**, against its feel. It is a
  chore in the yard and a decision in the books — it makes a lot, therefore a
  cost object. It also happens a handful of times a season, at batch placement,
  not thirty times a day, so nobody is blocked in the middle of a chore.
- **`expert` does not clear the owner level.** The platform's own bookkeeper
  reviews and reconciles; they do not decide the farm has bought a parcel.
  Accounting already gives them `requireReviewRole` for what is genuinely
  theirs.
- **This is not a security boundary and the doc says so.** RLS is member-wide by
  design — what the business owns and where its animals are is not private
  correspondence, and whoever is sent to fetch something has to be able to find
  it. The database decides whose rows these are; this decides who may change
  them. Weakening it cannot leak another tenant's data, only let a colleague
  record something.
- **The UI moved with it**, which is the half that would otherwise rot: the
  livestock detail page no longer hides place/lose/move/tag behind `isOwner`,
  and the zone page no longer hides the occupancy controls. `SplitHerdForm` and
  inventory's `LotForm` are still gated, and now say why in a comment.
- **Tests state the rule from both sides.** Three old "refuses staff writes"
  tests asserted the rule being replaced — a reminder from earlier this week
  that a test locks in a mistake as firmly as it prevents one. Each became a
  pair: what staff may now do, and what they still may not.

### 2026-08-15 — Vocabulary becomes declarable, and installing a profile becomes a button (`claude/vocabulary-registry`)

Founder: *"how do I control the terminology used in the homestead farm profile?
I should be able to customize it even further at the tenant level."* The honest
answer was that the mechanism existed and the controls did not, and that the
mechanism was barely used.

- **The state this replaced:** three label keys declared in one profile, **one**
  of them read by any code, every other noun in every pack hardcoded English,
  and no way to answer *"what words can I change?"* except grepping for
  `labelFor`. Setting up a profile meant invoking a server action directly.
- **`LabelDefinition` — features declare their own words**, with a fallback and
  a sentence describing what the word names. That one declaration serves three
  purposes at once: the admin screen has something to LIST, the test has
  something to CHECK, and the next pack has somewhere to put its vocabulary.
- **`tests/vocabulary.test.ts` scans the source**: every key rendered through
  `labelFor` must be declared. A declaration nothing verifies drifts back to
  decoration within a slice or two — this is the ratchet.
- **Two admin surfaces**, both on the tenant page: install a profile (naming the
  packs it will switch on *before* the button), and edit vocabulary (a field per
  declared word, with its description beside it).
- **LABELS MOVED TO `tenants.labels`, and that is a correction.** They were on
  each pack's `tenant_modules.config` row, on the reasoning that renaming a word
  for one pack should not silently rename it in another. Backwards: `zone` is
  `land`'s word that `livestock` also displays, so a per-pack override would
  have changed one screen and not the other. A paddock is a paddock everywhere.
  Moved while there was still no data in the wrong shape.
- **Written through `withSystem` after a superadmin check**, because `tenants`
  is SELECT-only for members and must stay so — RLS is row-level, and a member
  UPDATE policy permissive enough for `labels` would also expose `status`.

### 2026-08-15 — A pack declares a dependency on another pack for the first time (`claude/inventory-lot-spine`)
- **`inventory` slice 0** ships the lot spine — full dossier in
  [inventory.md](inventory.md).
- **`requires: ["assets"]` is the first pack-to-pack dependency that exists
  because of a FOREIGN KEY** rather than a conceptual ordering. A storage
  location IS an asset, so `inventory_movements` points at `assets` with a
  composite `(tenant_id, location_asset_id)` FK. That makes the dependency
  enforced by Postgres as well as by `toggleModule`, which is a stronger
  guarantee than the graph alone — and it is the shape every later pack should
  copy rather than inventing a soft reference.
- **Three dimension types now exist across three packs** (`asset`, `parcel`,
  `zone`, `lot`) and core has still never changed. That is the fourth
  independent test of ADR 0004's claim.
- **A pack read another pack's TABLE for the first time**, and deliberately: the
  location picker selects from `assets`. That is allowed precisely because the
  dependency is declared — `requires` is what makes the difference between a
  legitimate read and the leak extension-model.md §4 forbids. A pack must never
  read the tables of something it does not require.

### 2026-08-15 — Second pack ships, and vocabulary finally has a reader (`claude/land-places`)
- **`land` slice 0** — parcels, zones and dated zone use, full dossier in
  [land.md](land.md). The substrate `livestock` and `crops` declare in
  `requires` now exists.
- **`resolveLabels` has a caller**, three weeks after it was built and tested.
  It stayed unread because `assets` had no word worth overriding; `land` does, so
  the seam was wired the moment a pack had a surface that needed it. Verified
  live: the same page renders "Paddocks" for a tenant with the override and
  "Zones" for one with no profile at all.
- **`packConfig` has its first real reader too** — `land.areaUnit` flips the
  whole surface to hectares. That is half of what P5 is for, arriving through
  configuration rather than a new primitive.
- **New Layer 0 file: `src/lib/packs/tenant-context.ts`.** `packContext(tx,
  tenantId, industry, slug)` returns `{ labels, config }`, merging profile
  defaults with `tenant_modules.config`. It lives in Layer 0 rather than in the
  pack because every later pack needs exactly this and none of them should
  re-derive it. **Per-tenant labels live under a `labels` key on the pack's own
  row**, so renaming a word for one pack does not silently rename it in another.
- **`config` is typed `unknown` on the way out**, deliberately. A pack parses its
  own key with its own tolerance for nonsense; typing it here would mean this
  file knowing what every pack's settings look like, which is the coupling packs
  exist to avoid.
- **Two dimension types from one pack** for the first time (`parcel`, `zone`).
  Nothing in core needed to change, which is the claim ADR 0004 makes and this is
  the second independent test of it.

### 2026-08-14 — First pack ships: `assets` (`claude/layer2-pack-machinery`)
- **The machinery is now proved by something using it.** `assets` renders, owns
  a table under FORCE RLS, and syncs cost objects — full dossier in
  [assets.md](assets.md).
- **`upsertDimensionMember` has its first caller**, three weeks after the seam
  was opened. The pattern the next pack copies: the entity write and its
  dimension sync share one transaction, so a cost object can never point at a
  rolled-back row.
- `Component` on a `PackDefinition` went from "all seven absent" to "one
  present", exercising the empty-slot path and the renderable path at once.
- **P5 is now genuinely blocked on something real:** the asset kind suggestions
  are hardcoded in the pack, and they should come from profile `packConfig`.
  That is the extension point ADR 0004 predicted, and it now has a caller
  waiting for it rather than a hypothetical one.

### 2026-08-14 — Layer 2 exists: registry, dependencies, profile install (`claude/layer2-pack-machinery`)
- **`src/packs/` and `src/industries/` now exist.** Seven capability packs are
  declared with a real dependency graph, and `homestead-farm` is the first
  profile manifest. **Zero new tables**, as ADR 0009 predicted.
- **A declared pack is not a placeholder.** `PackDefinition.Component` is
  optional, so a pack participates fully in dependency resolution and profile
  installs while having no renderer — the same arrangement `scheduling` and
  `work` used before they shipped. All seven are in that state today.
- **One registry at runtime, two source trees.** `src/lib/features.ts` merges
  core and packs at Layer 0; neither `src/modules/index.ts` nor
  `src/packs/index.ts` imports the other. A slug registered in both throws at
  module load rather than silently shadowing.
- **Dependency enforcement lives in `toggleModule`**, before provisioning, so a
  refused toggle leaves no trace. Enabling checks requirements; disabling checks
  dependents. Never checked at runtime — a request that has reached a pack's
  page is too late.
- **`installProfile` is additive and re-runnable.** It enables packs in
  topological order inside one transaction and stamps `tenants.industry`. It
  never switches anything off: a pack the tenant disabled is a decision, not
  drift.
- **Nav groups by `category`**, with the pack group taking the installed
  profile's name. Nothing changes for a tenant with no profile.
- **Extracted `enableRow`** from `toggleModule` so the action and the installer
  share one upsert. Its `enabledAt` restamping behaviour is deliberately
  unchanged — the admin matrix renders that value.
- 39 pure tests in `tests/packs.test.ts` covering the resolver, plus invariants
  over the real registries (no cycles, no unregistered requirements, no profile
  missing a transitive dependency, no industry noun in a pack name).
- **Not done: seed application.** `IndustryProfile.seed` is declared and unused;
  it needs a farm chart of accounts written first. Shipped in two steps rather
  than half-seeding.

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
| `tenant_modules.config` | [platform.ts:281](../../src/db/schema/platform.ts:281) | jsonb. Layer 3 tailoring, per pack. **Not** labels — those are tenant-wide. |
| `tenants.labels` | [platform.ts](../../src/db/schema/platform.ts) | jsonb, tenant-wide vocabulary overrides. Keys come from the registry. |
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

| # | Thing | Status |
| --- | --- | --- |
| 1 | `src/packs/` + merged runtime registry | **built** — `src/packs/index.ts`, merged in `src/lib/features.ts` |
| 2 | `src/industries/<slug>.ts` manifests | **built** — `homestead-farm` is the first |
| 3 | Dependency declaration + enforcement | **built** — declared in `PackDefinition.requires`, enforced in `toggleModule` |
| 4 | The install action | **partly** — `installProfile` enables packs and stamps `tenants.industry`. **Seed application is not built** |
| 5 | Label resolution | **built, in use, and now DECLARED** — see the vocabulary registry below. Was: **built and in use** — `resolveLabels` / `labelFor` in `src/lib/packs/resolve.ts`, reached through `packContext` in `src/lib/packs/tenant-context.ts`. First caller: `land`, 2026-08-15 |
| 6 | Nav grouping by `category` | **built** — the pack group takes the installed profile's name |
| 7 | **P5 extension points** | **not built.** Two packs now hardcode a suggestion list that should come from profile `packConfig` (`assets.kind`, `land`'s zone uses). Config-shaped tailoring already works via `packContext`; what is still missing is a pack CONTRIBUTING nav or registering an entity type |

## The shapes

Built as described below. The original planning note read *"not yet written,
recorded so the first pack doesn't improvise"* — it is kept in this shape
because it is still the contract a new pack is written against.

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

- **Seed application is not built.** `IndustryProfile.seed` is declared and
  unread, so `installProfile` enables packs and stamps the profile but ships no
  chart of accounts, folders or doc kinds. Needs a farm chart of accounts
  written first. **This is the largest gap in the installer.**
- **P5 extension points** (#7 above) — the primitive ADR 0004 named and nobody
  has built. Nothing has forced it yet because no pack renders; the first pack
  that ships will.
- **Nothing asserts a pack in code has a seed row in `scripts/seed.ts`.** That
  file calls `main()` at module load, so a test cannot import its catalogue
  without opening a database connection. The backstop is the
  `tenant_modules.module_id` foreign key, which fails loudly at install rather
  than silently — acceptable, but it fails at the worst moment. The fix, when it
  is worth doing, is extracting the `MODULES` array into an importable module.
- ~~`resolveLabels` has no caller~~ · ~~no UI for a per-tenant override~~ ·
  ~~no UI for `installProfile`~~ — **all closed 2026-08-15.** Both surfaces are
  on the admin tenant page, and the words they offer come from the registry.
  ~~Neither has been driven~~ — **driven 2026-08-16**, and both were wrong in
  the way only clicking shows. See the build log.
- **Only four features declare vocabulary**, and the sweep is partial. Each pack
  declares the words on its list pages; plenty of nouns further in are still
  hardcoded English ("Species", "Tag", "Batch code"). Adding one is a
  `LabelDefinition` plus a `labelFor` call, and `tests/vocabulary.test.ts` fails
  if a key is rendered without being declared — so the ratchet only turns one
  way. **Core modules declare none at all**, which is the bigger gap: "customer"
  and "invoice" are exactly the words an industry renames.
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
