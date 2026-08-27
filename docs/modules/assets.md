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

### 2026-08-26 — The pack puts on the design system (`claude/the-last-three-packs`)

No behaviour changed. PR 4 of the five that bring the packs onto the primitive
layer, and the last of them — see [design-system.md](design-system.md) for the
sweep as a whole.

**THIS PACK GETS NO `CategoryStrip`, AND THAT IS THE FINDING RATHER THAN AN
OMISSION.** The first three packs each had a header stuffed with four or five
outline buttons that were really destinations. Assets has NONE: `[id]` is a record, and it is the only route
besides the hub. The strip exists to
show a module's SECTIONS, and a strip with one tab is chrome that teaches
people the control is useless. So the hand-rolled back-links on the record
pages **stay**: with no sections there is nothing to replace them with, and a
record-to-list link is the only navigation those pages have.

Accent chip on every `PageHeader`, `Card` to `Panel`, tables into `DataTable`,
section headings to the house 20px, and dashed-border paragraphs to real
`EmptyState`s.

`depreciation-panel.tsx` and `maintenance-panel.tsx` were the two `Card`s that
lived in components rather than pages. Both are `Panel` now, keeping their
header row with the action on the right; `CardDescription` became the
supporting line it always was.

### 2026-08-19 — A place things are kept is a property of the asset (`claude/assets-hold-stock`)

The fix for the location picker the inventory drive found. Migration `0155`,
applied to both databases.

- **`assets.is_storage_location`**, and it lives on the ASSET rather than in
  `inventory` even though inventory is its only reader today. A freezer is a
  place things live whatever pack is asking — the same division `land` makes by
  owning occupancy while `livestock` calls into it.
- **WHY NOT A KIND FILTER, which is what `land` used for structures.** The kinds
  do not separate these: on the live tenant a **chest freezer and a tractor are
  both `equipment`**, and a **garage and a gate are both `building`**. Any rule
  keyed on kind either admits the tractor or excludes the freezer, and the
  freezer is the canonical inventory location. The test asserts exactly that by
  putting a tractor and a freezer of the SAME kind on either side of the filter.
- **The backfill has two halves**, because `false` everywhere would empty a
  picker in use and give nobody a way to refill it. **Evidence** first — anything
  already used as a location in the movement ledger IS one — then the same
  default `land` chose for structures, `building` + `infrastructure`. On
  production that marked the freezer (by evidence, against its kind), the garage
  and a gate, and left the tractor off. The gate can now be unticked, which is
  the point of a flag.
- **A switch on the asset, in both the create form and the edit dialog** —
  *"Things are kept here"*. Declared in the action's zod schema, which is
  `.strict()` since 2026-08-18: an undeclared field would now be REFUSED rather
  than silently dropped, which is how `assetAccountId` was lost for days.
- `tests/assets-ops.test.ts` round-trips the flag through create and update, for
  the reason that file already round-trips `assetAccountId`.

### 2026-08-18 — The asset list says whose (branch `claude/asset-list-names-the-company`)

A Company column on the asset list, at two or more companies. The invoice and
bill lists have had one since slice 1b; this list did not, so a two-company
tenant saw four assets with no way to tell whose.

- **Fourth screen of this shape**, after the Journal header that named the
  tenant, the close detail page that named no company, and the payment rows that
  named an account but not its owner. The rule, now written in
  accounting.md: **a screen showing a document's OWN data is safe; one showing
  several companies' side by side has to say which is which.**
- An em dash rather than a guess when `entity_id` is null — that is a real state
  for a tenant with no accounting (see `0154`), and inventing a company would be
  a claim the row cannot support.
- Only at two or more, so the single-company tenant's list is byte-identical.

**Also verified on the live tenant this afternoon, both from the previous two
PRs:** "Cost sits in" now saves (`1600 Equipment` on an Oak Row asset, which the
stripped zod field had made impossible), and the disposal's **Money went into**
picker offers `1030 Oak Row Checking` while excluding `1040 Test Operating` —
the fifth instance of a control offering something the posting engine refuses,
now closed and seen working.

### 2026-08-18 — "Cost sits in" could never be saved (branch `claude/cost-sits-in-was-stripped`)

Found by driving the company work on the live Test tenant: set **Cost sits in →
1600 Equipment**, press Save, get "Saved" — and the column is still null. The
cost saved; the account did not.

- **`assetAccountId` was missing from the action's zod schema**, and **zod
  strips what it does not declare**. So the Edit dialog sent the value, the
  boundary dropped it silently, and `updateAsset` — which has always handled it
  correctly — never saw it. The field could not be set from the UI at all, on
  create or on edit.
- **THIS IS THE EXPLANATION FOR THE ANOMALY THIS FILE RECORDED ON 2026-08-15**:
  an asset with 6,706.78 of accumulated depreciation against a cost sitting on
  no account. That was written up as a nullable column nobody had filled in. It
  was a column nobody COULD fill in, and the Garage on the live tenant is still
  in exactly that state.
- **The schema is `.strict()` now**, so the next dropped field is a refusal
  rather than a silence. Zod's default made the form right, the ops layer right,
  and the value evaporate in between with nothing to grep for. A rejected
  payload is unhelpful but it fails on the FIRST click rather than on a balance
  sheet months later.
- Both callers were checked against the declared fields before turning strictness
  on — the edit dialog and the depreciation panel send only what is listed.
- `tests/assets-ops.test.ts` gains the round-trip: created with an account,
  cleared to null, set again.

**The shape worth remembering:** `tsc` cannot see through a zod schema. Every
type in the chain agreed — `AssetInput` declares the field, the form sends it,
the ops layer writes it — and the one link with no type at all dropped it. The
same blind spot as the dead column write in slice 1b, reached from the other
end.

### 2026-08-17 — A fixed asset carries its own company (branch `claude/assets-carry-a-company`)

The last thing [ADR 0010](../decisions/0010-entities-inside-a-tenant.md) listed
as unbuilt. Migration `0154`, and **nothing is owed after it** — see the last
bullet, which is the interesting one.

- **`assets.entity_id`, fixed at creation.** An asset is a thing with a balance:
  its cost sits on one balance sheet and its depreciation lands in one P&L, so it
  belongs to one set of books like an invoice, a bill and a register before it.
  It cannot be moved afterwards, for the reason the other three cannot — every
  entry already posted belongs to whoever owned it then. The correction is a
  disposal in one company and an acquisition in the other, which is also what
  actually happened.
- **WHAT IT REPLACES IS THE INTERESTING PART.** Until now depreciation went
  wherever the asset's FIRST entry landed (`entityForDocument`), which is the
  tenant's DEFAULT at the moment somebody first pressed Post — a company chosen
  by timing rather than by anybody. Move the default between two months of one
  schedule and that asset's depreciation splits across two balance sheets, with
  every entry balancing and nothing complaining. The test moves the default
  mid-run, because that is the only way to tell a stored company from an
  inferred one.
- **`entityForDocument` AND `entityOfDocument` ARE GONE**, and that is the end of
  ADR 0010's list. Nothing infers a company from history any more; every
  document states one.
- **The proceeds picker on a disposal now excludes other companies' registers.**
  A disposal posts in the asset's company and `postEntry` refuses a line
  touching a foreign register, so the unfiltered list was offering a choice that
  always fails — the FIFTH time that shape has appeared (the recurring invoice
  coded to Checking, the invoice's Deposit-to, the bill's Paid-from, the transfer
  dialog). Selling one company's asset into another's account is real, and it is
  intercompany like the invoice and the bill; it is not built, and offering the
  account without building it would be the one option that cannot work.
- **The asset form grows a Company picker at two or more companies**, defaulting
  to the tenant default, and the detail page names the owner beside the kind —
  that page is where Post depreciation and Dispose live, and both write to
  exactly one set of books.
- **`0154` is hand-edited three ways** and the header says so: drizzle-kit
  emitted a stray `period_closes` NOT NULL (a `--custom` migration does not teach
  the snapshot what its SQL did, so `0153`'s work reappeared), emitted no
  backfill at all, and put the foreign key before it. The backfill freezes
  exactly what `entityForDocument` answered at runtime — first depreciation
  entry, else the tenant default — so no existing schedule changes company.
- Verified on both databases: production's three assets all resolved to `Test`,
  the one with three depreciation entries included, and zero nulls.
- **`entity_id` STAYS NULLABLE, and CI is what settled it.** Every other
  `entity_id` in this schema gets a `SET NOT NULL` a release later; this one
  must not. The first cut resolved the tenant default in `createAsset` and threw
  `ENTITY_MISSING` when there was none — and the test suite failed on a fixture
  that creates a bare tenant, which is not an artificial case: **this pack
  declares `requires: []`**, so a tenant can run the asset register with no
  accounting at all. A farm listing its equipment and never keeping books is a
  supported customer, and "add a tractor" must not depend on a chart of
  accounts. `provisionAccounting` now ADOPTS any company-less asset when the
  books are opened, so depreciation works on the first press. **The pack
  boundary was the thing that was wrong, and only a test with no accounting in
  it could have said so.**

### 2026-08-15 — Whoever changed the oil can log the oil change (`claude/pack-write-levels`)

Platform-wide change; the reasoning is in
[packs-and-profiles.md](packs-and-profiles.md). What it means here:

- **`recordMeterReading` and `recordService` are open to any member.** The
  person holding the dipstick is the person who knows the hours on the meter.
- **The asset, its schedules, and raising due maintenance stay owner-only.**
  Creating an asset is capital and syncs a cost object; raising the due work
  moves the schedule's clock, which is the same act as writing the schedule.
- The pack's private `requireOwner` is gone, replaced by `allowsWrite()` from
  `src/lib/packs/authorize.ts` — the same helper all four packs now share.

### 2026-08-15 — Slice 2: maintenance, raised as work (`claude/assets-maintenance`)
- **The pack has no task engine, and that was the point of the slice.** A due
  service becomes an ordinary work item through the Layer 0 seam and is worked
  with the shared `WorkItemRow` — the same component and verbs a CRM follow-up
  gets ([extension-model.md §4b](../extension-model.md)). Nothing about work was
  re-implemented here.
- **Two link types per raised item.** The `asset` link puts it on the asset's
  page; the `maintenance_schedule` link is what makes raising it **idempotent**.
  Without the second, "has this service already been raised" could only be asked
  by matching on the title — a string comparison pretending to be an identity.
- **Never-done is `no_baseline`, not overdue.** Adding a schedule to a tractor
  owned for years must not declare six services overdue and raise six work items.
  The exception is a *calendar* schedule, which can honestly count from the
  asset's in-service or acquisition date; a *meter* one cannot, because "how many
  hours had it done when we bought it" is not something the asset knows.
- Next-due is computed FROM events, never stored — so a backdated service
  corrects the whole sequence instead of leaving a stale `next_due_on`. Same
  reasoning as accumulated depreciation being read from the ledger.
- **No cost on a maintenance event.** The repair bill is already in the books
  tagged with the asset's dimension, so "what has this tractor cost in repairs"
  is a P&L question. Recording money here too would be a second version of it —
  the same reason the pack does not capitalise a purchase.
- A meter service gets **no due date** on its work item. It falls due at a
  reading, and inventing a date would put a fictional deadline on somebody's list.
- Migration `0130` **hand-reordered again**, and the rule now generalises — see
  Decisions.
- 19 pure tests, 7 on the work-emission path, and 3 more isolation tests.

### 2026-08-15 — Disposal settles the books (`claude/assets-disposal-settles`)
- **Found first: the pack was never capitalising anything.** On the live tenant
  `1700 Accumulated Depreciation` stood at −6,706.78 against `1600 Equipment` of
  **zero** — a contra-asset with no asset behind it. Depreciation had been
  posting half an entry all along.
- **The pack still does not capitalise, and should not.** Buying a tractor
  already hits the books once, through a bill or a bank transaction coded to a
  fixed-asset account; posting the cost again from here would double it. So
  `assets.asset_account_id` **links** to where the cost already lives.
- Disposal now posts: Dr accumulated, Dr proceeds, Cr cost, and the difference
  to `4950 Gain (Loss) on Asset Disposal` — one account for both directions,
  since the ledger's signed amounts carry a gain as a credit and a loss as a
  debit.
- **It posts nothing, and says why, when it cannot know what to remove.** No
  cost, or a cost linked to no account, means there is no balance to clear —
  and guessing an account would put a real number in the wrong place. The dialog
  explains this *before* the button, not after.
- The status change and the journal entry are **one transaction**: a disposed
  asset still on the balance sheet, or a settled balance sheet with an active
  asset, are both states nobody can reason about.
- Idempotent on `disposal:<assetId>`, so disposing twice posts once.
- 6 pure tests on the gain/loss maths (including that the four legs balance by
  construction) and 9 db-backed on the posting.

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
- **The asset itself is the owner's; what happens to it is not.** Creating,
  editing and disposing all touch capital, and `upsertDimensionMember` calls
  `requireOwnerRole`, so a staff-created asset could not sync its cost object
  and would be invisible to every report. Reading the hour meter and logging an
  oil change are chores, open to any member since 2026-08-15 — decided by
  `allowsWrite()` in `src/lib/packs/authorize.ts`. Raising due maintenance
  stays with the owner: it moves the schedule's clock, which is the same act as
  writing the schedule.
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
- **drizzle-kit emits every FK before every index**, so a composite FK whose
  target unique index is created in the SAME migration always fails with *"there
  is no unique constraint matching given keys"*. Hit twice: `0125`
  self-referentially, `0130` across two new tables. Cross-table FKs to a
  PRE-EXISTING table are fine, which is why it only bites when the target is new
  too. Reorder to: tables, unique indexes, foreign keys, everything else.
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
- **Existing assets have no `asset_account_id`.** The column is new and
  nullable, so every asset created before 2026-08-15 has an unlinked cost and
  will refuse to settle on disposal until someone sets *Cost sits in*. There is
  no backfill, because only the tenant knows which account a given purchase was
  coded to. A prompt on assets that depreciate but are unlinked would be worth
  building.
- **Images / a profile picture per asset** (founder's request, 2026-08-15).
  Storage is free — Documents already holds files with metadata and the open
  entity-link pattern attaches them. What needs designing is the *primary*
  image, since a list thumbnail wants one canonical photo rather than the newest.
- **Maintenance has no history view.** `listEvents` exists and nothing renders
  it, so the service log is written and never read back. The panel shows what is
  due, not what was done.
- **Completing the work item does not record the service.** They are two acts
  today: tick the work, then press "Mark done today". Closing the loop needs a
  hook on work completion, which nothing in Work emits yet.
- **Schedules cannot be edited or deactivated from the UI.**
  `setScheduleActive` exists with no caller.
- **Occupancy for mobile assets** (slice 3) — shared shape with livestock lots.
- **Anything active is offered as a container**, so a freezer can be put inside
  a tractor. Arguably correct — a toolbox does live in a truck — but if only
  some kinds should contain things, decide before there is data to migrate.
- **No list-side edit.** Editing and disposal are on the detail page only, which
  means changing ten assets is ten navigations.
- **Kind suggestions are hardcoded** in `vocabulary.ts`. They should come from
  profile `packConfig` once P5 exists — which is what will force P5.
