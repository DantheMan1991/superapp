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
  thing the user meets. That path depends on `descendantIds`, fixed in the
  ops-tests PR — **re-parenting is unverified until that lands.**
- Disposal takes a date defaulted to **the tenant's today**, never the browser's.

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
- **RLS is tenancy, not role.** Assets have no owners-only subset, so this table
  does not reach `app_tenant_role()` the way `document_folders` must. Who may
  write is an application concern.

## Open items

- **Depreciation** (slice 1) — methods, Section 179 and bonus, posting to the
  ledger. The largest gap, and the thing that makes this pack an accounting tool
  rather than an inventory of serial numbers.
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
