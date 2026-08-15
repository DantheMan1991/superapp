# Assets

> Anything the business owns that has a cost, a working life, a place it lives
> and a service schedule. A tractor, a dental chair, a service van, a chest
> freezer and a fence are one shape — the words for them come from `kind`, which
> the tenant and its installed profile supply. **The first capability pack
> (Layer 2a) to ship.**
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [packs-and-profiles.md](packs-and-profiles.md) first** if you are touching
the pack machinery rather than assets themselves, and
[extension-model.md](../extension-model.md) §2–§3 before adding anything that
names an industry. This pack is listed by `homestead-farm` today and is written
to be listed by a trades profile unchanged.

## Build log

### 2026-08-15 — Catch-up verified live, and posted-to-date now reads the ledger (`claude/assets-depreciation-ledger-truth`)
- **Catch-up confirmed against the real tenant.** The Garage's in-service date
  was set back to its true 2019-06-01 with the books closed through
  2026-06-30. Result: **three entries, not 87** — one catch-up for 6,552.60
  memo'd *"2019-06 to 2026-06, 85 months before close"* dated 2026-08-31, plus
  the two monthly entries already posted, which were correctly skipped.
- **Bug found and fixed in the same pass.** The panel showed 6,706.76 while the
  ledger held 6,706.78. `getDepreciationStatus` read *which periods* were posted
  from the ledger but recomputed *the amounts* from the schedule — a half
  application of this pack's own rule. **A schedule can change after posting**:
  moving the in-service date reshuffles which periods carry the remainder cent,
  so the two posted months moved from schedule positions 1–2 (which carry it)
  to 86–87 (which do not). Now summed from the journal lines, `posted` status
  only, so a voided entry stops counting the moment it is voided.

### 2026-08-15 — Catch-up entries and bulk posting (`claude/assets-depreciation-close-gap`)
- **Closes the gap found the same day.** Periods stranded behind a close are no
  longer refused — they are summed into a **single catch-up entry dated in the
  first open period**, which is what a bookkeeper does by hand. The founder
  chose this over the alternative (post from the first open period and let
  pre-close depreciation be absent).
- **The idempotency key now carries the covered range.** A catch-up entry's
  *date* names one month while it covers many, so `listPostedPeriods` reads the
  KEY instead: `depreciation:<id>:<period>` for one, and
  `depreciation:<id>:through:<period>` for a range. Without this the caught-up
  months would look unposted forever and re-post on every run. **No new table** —
  `idempotency_key` was already stored and uniquely indexed.
- **The panel says so before the button is pressed.** The first version offered
  "Post 3 months" with no idea the ledger would refuse; it now names how many
  months fall before the closing date and where the catch-up will land.
- **Bulk posting**, prompted by the founder asking what happens at 100 pieces of
  equipment rather than three. One button on the list, one transaction for the
  run, with the asset count and total shown *before* it is pressed — authorising
  a write to the books sight unseen is not a thing to ask for.
  The catch-up collapsing is what makes it viable: a first run over 100
  backdated assets would otherwise be thousands of entries.
- Land is skipped, disposed assets are skipped, and a run with nothing due is a
  no-op rather than a second helping.

### 2026-08-15 — Depreciation verified in production, and one gap found (`claude/assets-depreciation-close-gap`)
- Ran the whole chain against the live Test tenant. **The P&L split by `asset`
  renders a column headed "Garage"** — an asset created in this pack, synced as
  a dimension member, computed by the schedule engine, posted through
  `postEntry`, and discovered by the accounting report *with no change to
  accounting code*. That is the pack model's thesis, working.
- Schedule arithmetic confirmed against a real number: 18,500 over 240 months
  showed **231.27** for three months — 3 × 77.09, the remainder-to-earliest-
  periods rule visible rather than merely tested.
- Entries landed as designed: one per period, dated `2026-07-31` and
  `2026-08-31`, source `depreciation`, memo naming the asset and period.
- **Found: a closed period blocks the whole catch-up, permanently.** Recorded in
  Open items — it is a design decision, not a bug fix, and the first thing to
  settle before anyone depreciates a real backdated asset.

### 2026-08-15 — Slice 1: depreciation, posted to the ledger (`claude/assets-depreciation`)
- **This is the slice that makes the pack an accounting tool** rather than a
  register of serial numbers. Straight-line, monthly, posted as real journal
  entries tagged with the asset.
- **Accumulated depreciation is NOT a column.** It is the sum of what has been
  posted, read back from the ledger — the same reasoning `balances.ts` uses for
  account balances and ADR 0007 uses for cash basis. A column would be a second
  source of truth that has to agree with the ledger forever.
- **One entry per period, dated to month end**, never one lump for a catch-up.
  A combined entry would put six months of expense in one month and misstate
  every P&L in between, which is the report people run depreciation for.
  Idempotent per period via the entry's idempotency key.
- **`none` is a real method, not an unset field** — land does not depreciate,
  and neither does anything held for resale.
- `in_service_on` is separate from `acquired_on`. A tractor bought in November
  and first used in March depreciates from March, and conflating the two moves
  expense into the wrong tax year.
- **`journal_entry_source` gained `depreciation`, alone in migration 0127** —
  an enum value cannot be used in the transaction that adds it. drizzle-kit then
  emitted the same `ALTER TYPE` into 0128, which would have failed; that had to
  be removed by hand.
- **`model` added** alongside `identifier`, at the founder's request. They answer
  different questions: a model says what a thing IS and is shared by every unit
  of it; a serial says which one.
- 28 pure schedule tests (exactness across awkward numbers) + 11 posting tests
  against a real chart of accounts, including that the expense attributes to the
  asset when the P&L is split by dimension.

### 2026-08-15 — Detail page: edit, dispose, re-parent (`claude/assets-detail-page`)
- `/dashboard/m/assets/[id]` — the first **pack sub-route**. It lives in
  `src/app/`, not `src/packs/`, because Next resolves routes from the app
  directory and nothing about a pack changes that. Same split core modules
  already have: renderer in the pack, route file in `src/app/`. The file is a
  thin guarded entry point and the pack still owns the work.
- `requireModuleEnabled` on the route, not just the module shell — a route file
  is reachable by URL whether or not the pack is switched on, so the guard is
  what makes "switched off" mean anything.
- Gives `updateAssetAction` and `disposeAssetAction` their first callers; both
  had existed, audited and unreachable, since slice 0.
- **The container picker cannot offer a cycle**: the server excludes the asset
  and its whole subtree, so `ops.ts`'s refusal is a backstop rather than the
  thing the user meets. That path runs through `descendantIds`, so it only
  works at all because of the `inArray` fix in the entry below — the two
  landed a day apart and this one was written against the broken version.
- Disposal takes a date defaulted to **the tenant's today**, never the browser's.

### 2026-08-15 — Ops tests, and the bug they found (`claude/assets-ops-tests`)
- **`descendantIds` was broken in shipped code.** It bound a JS array into
  `` sql`= any(${frontier})` ``, which Postgres rejects with *malformed array
  literal* — so **every caller passing a `movingId` threw, and the containment
  cycle guard had never once run.** Re-parenting an asset would always have
  failed. Fixed with drizzle's `inArray`.
- The bug was reachable only through `ops.ts`, and the isolation suite builds
  its fixtures under `withSystem` **on purpose** — so nothing covered it. That
  gap is the reason `tests/assets-ops.test.ts` exists: 16 tests over the ops,
  including the pack's central claim, which had no coverage at all.
- Now certified: creating an asset syncs a `dimension_member` **in the same
  transaction**; a failed asset write **rolls the member back**; a rename
  renames the member; disposal **archives rather than deletes** it; staff writes
  are refused; two-step and three-step containment cycles are refused.

### 2026-08-14 — Slice 0: the pack renders, under RLS, as a cost object (`claude/layer2-pack-machinery`)
- **The first pack-owned table** (`assets`), the first pack renderer, and the
  first caller of `upsertDimensionMember` — the seam core opened for exactly
  this and which had never been used.
- `kind` is an **open taxonomy**: the CHECK constrains format and never values,
  so `chicken_tractor` works without a migration. The picker offers suggestions
  plus a free-text escape, because a closed dropdown would turn an open column
  into an enum in the UI instead of the schema.
- **Writes are owner-only, reads are member-wide.** Forced from below as well as
  chosen: `upsertDimensionMember` calls `requireOwnerRole`, so a staff-created
  asset could not sync its cost object and would be invisible to every report.
- Containment via a **composite self-FK** so a parent is always same-tenant.
  Cycle prevention is split: the CHECK catches self-parenting, and `ops.ts`
  catches longer loops, because a CHECK cannot see other rows.
- Migration `0125` was **hand-reordered from the generated output** — drizzle
  emitted the self-referential FK before the unique index it references, which
  Postgres rejects. Every other composite FK here targets a different table, so
  the ordering had only ever worked by accident. Written up in the migration.
- 15 isolation tests. One of them corrected an assumption: moving a row to
  another tenant **throws** (`WITH CHECK`, 42501) rather than returning zero
  rows. Not seeing a row and not being allowed to export one are different
  outcomes, and only the second raises.
- Seed row flipped `coming_soon` → `available`.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `assets` | One row per thing owned | `tenant_id`, FORCE RLS (`assets_superadmin_all`, `assets_member_all`). Composite self-FK `assets_parent_fk` on `(tenant_id, parent_id)` → `(tenant_id, id)`, so cross-tenant nesting is unrepresentable. CHECKs: `status` in `active|disposed`; `kind` matches `^[a-z][a-z0-9_]{0,62}$` (**format only**); name non-blank; cost null or ≥ 0; parent ≠ self |

Mirrored into **`dimension_members`** with `dimension_type = 'asset'`, in the
same transaction as the write. That is what makes an asset a cost object the
existing P&L can group by, and it is the whole reason this pack is worth more
than a spreadsheet of serial numbers.

**Not columns, deliberately** — each would be a column with no reader today:
depreciation (method, life, salvage, in-service date) is slice 1 and posts to
the ledger; maintenance schedules and meter readings are slice 2; **occupancy**
— where a *mobile* asset is over time — is a table, not a column, and shares its
shape with livestock lot occupancy, so it waits for the pack that needs it.

## Key files & seams

- `src/packs/assets/ops.ts` — all reads and writes. Takes a `Tx` so the caller
  owns the transaction; that is what keeps a write and its dimension sync atomic
- `src/packs/assets/actions.ts` — `requireTenant` + `requireModuleEnabled` +
  `withTenant({ role })` on every action
- `src/packs/assets/vocabulary.ts` — no imports, no directive, so client
  components can read it without dragging drizzle into the bundle
- `src/packs/assets/AssetsModule.tsx` — the renderer
- `src/app/dashboard/m/assets/[id]/page.tsx` — the detail route. **A pack's
  sub-routes live under `src/app/`**, guarded with `requireModuleEnabled`
- `src/db/schema/assets.ts` · `drizzle/0125_*.sql` · `drizzle/0126_assets_rls.sql`
- `tests/isolation/assets.test.ts`

## Decisions & gotchas

- **`kind` is open, and the UI must not close it.** The suggestion list is
  short on purpose: a longer guess reads as the allowed set.
- **Cost is nullable and renders as `—`, never `0`.** "Cost unknown" and "cost
  nothing" are different facts, and depreciation needs to tell them apart.
- **Disposal is a status, never a delete**, and it *archives* the dimension
  member rather than removing it — archived members stop being taggable while
  existing tags keep reporting, which is exactly what a disposal wants. An asset
  that cost money for six years does not stop having done so when it is sold.
- **A composite FK cannot use `ON DELETE SET NULL`**, because that would null
  `tenant_id` too. So removing a container requires re-parenting its contents
  first, which is the honest order of operations anyway.
- **Self-referential FKs need the unique index created first.** The generated
  migration will get this wrong; check the statement order.
- **Never interpolate a JS array into a raw `sql` fragment.**
  `` sql`x = any(${arr})` `` binds the whole array as ONE parameter and
  Postgres rejects it. Use `inArray`. This shipped, and it silently disabled the
  containment cycle guard — the code path threw before ever reaching the check.
- **An isolation test cannot cover a pack's ops**, by design: that suite builds
  fixtures under `withSystem` so a bug in the ops cannot make it agree with
  them. A pack therefore needs BOTH files, and the ops one is where the
  dimension-sync guarantees live.
- **RLS is tenancy, not role.** Assets have no owners-only subset, so this table
  does not reach `app_tenant_role()` the way `document_folders` must. Who may
  write is an application concern.
- **A schedule must sum to the depreciable base EXACTLY.** Not within a cent —
  a schedule one cent short leaves a permanent orphan on the balance sheet that
  no entry will clear. `core/depreciation.ts` is the second place in this
  codebase allowed to divide money, and it follows the first
  (`cash-basis-allocate.ts`) rather than inventing its own rounding. The
  remainder goes to the EARLIEST periods so the final row is the plain
  per-month figure, which is what makes a printed schedule look right.
- **Never do month arithmetic through `Date`.** `new Date("2026-01-31")` plus a
  month is the classic "March 3rd" bug. Periods are month buckets and the day
  is parsed out and never allowed back in.
- **An enum value needs its own migration, and the generator will not know it.**
  drizzle-kit emitted `ALTER TYPE … ADD VALUE` into the *next* migration as well
  as the custom one carrying it, which would have failed on "label already
  exists". Check for the duplicate whenever an enum grows.

## Open items

- **Tax methods: MACRS, Section 179, bonus depreciation.** What shipped is
  **book** depreciation — straight-line, no convention. That is deliberately a
  line rather than an omission: half-year, mid-quarter and mid-month
  conventions, declining balance with the straight-line switch, and the §179
  election are *tax* rules, and modelling them halfway would put confidently
  wrong numbers in someone's books. **The decision to make first is whether this
  keeps one basis or two** — most small farms file on tax basis, so book-only
  straight-line will not match their return, and a tenant-level book/tax split
  is a design conversation before it is code.
- **Depreciation accounts are resolved by convention** (subtype
  `accumulated_depreciation`, code `6900`), overridable via
  `tenant_modules.config.depreciation` — but **nothing writes that config yet**.
  A tenant whose chart differs gets a clear refusal and no way to fix it in the
  UI. The settings surface is the missing half.
- **Nothing posts depreciation automatically.** It is a button, on purpose:
  depreciation lands in a period a close can lock, and posting into someone's
  books on a schedule they did not trigger is a bad surprise for an accountant.
  Revisit only with an explicit opt-in.
- **Disposal does not settle the books.** Marking an asset disposed stops it
  being taggable but posts nothing — no removal of cost and accumulated
  depreciation, no gain or loss on sale. That is the next accounting slice and
  it is a real gap: the balance sheet still carries a tractor that has been sold.
- **Images / a profile picture per asset** (founder's request, 2026-08-15).
  Storage is free — Documents already holds files with metadata and the open
  entity-link pattern attaches them. What needs designing is the *primary*
  image, since a list thumbnail wants one canonical photo rather than the newest.
- **Maintenance** (slice 2) — calendar and meter-based schedules, emitting work
  items into the existing Work module rather than owning a task engine. Hold
  that line; it is the biggest reuse available.
- **Occupancy for mobile assets** (slice 3) — shared shape with livestock lots.
- **Anything active is offered as a container**, so a freezer can be put inside
  a tractor. Arguably correct — a toolbox does live in a truck — but if only
  some kinds should contain things, decide before there is data to migrate.
- **No list-side edit.** Editing and disposal are on the detail page only, which
  means changing ten assets is ten navigations.
- **Kind suggestions are hardcoded** in `vocabulary.ts`. They should come from
  profile `packConfig` once P5 exists — which is what will force P5.
