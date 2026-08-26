# Enterprises

> The lines of business a tenant wants the money for on their own — Broilers,
> Beef, Pigs, Eggs, Produce. **A Layer 0 reporting dimension**, not a module and
> not a pack: four packs name an enterprise and none of them owns it.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [architecture.md](../architecture.md) on layers first** if you are
touching where this lives. The plan the slices come from asked one question —
*"profit per enterprise cannot be a report while the only way to group is a
substring"* — and this is the spine that answers it.

## Slice order

| # | Slice | State |
| --- | --- | --- |
| **1** | **The register** — the table, the writer, the `dimension_members` mirror, the screen | **shipped 2026-08-26** |
| 2 | **What belongs to what** — `enterprise_id` on items, lots, channels and runs; the inventory filter bar gains a row | |
| 3 | The cost side — `postMovement` and the production accrual pass the member | |
| 4 | The revenue side — `retail` posts a sale, tagged per line | |

**Slices 3 and 4 are deliberately parked**, and the reason is data rather than
design: on 2026-08-26 the production database held **three** inventory/production
journal entries and **zero** retail sales, ever. A profit-per-enterprise report
over that is a beautiful empty page. Slice 4 also jumps ahead of the founder's
own stated blocker — `retail` slice 5, the till taking a card, which its dossier
says is one wire. See the plan for the full argument.

## Build log

### 2026-08-26 — A core tool speaks no industry (`claude/a-core-tool-speaks-no-industry`)

**The founder caught this the day it shipped:** *"is this enterprise considered a
core tool? the reason i ask is all of the prompts are faming related. if it is a
core tool, it should be industry nutral and then switched to farming related when
the indutry is chosen."* He is right, and it is his own standing rule — no
trade-specific nouns in core copy; that is the add-on layers' job.

**WHAT WAS WRONG.** A Layer 0 table shipped with `["livestock", "crop", "other"]`
hard-coded, a form reading *"Livestock — animals you raise"*, an empty state
saying *"most farms have between three and six"*, and the word "Enterprises" on
the page, the rail and the report picker. That is core telling a law firm what
its lines of business are made of.

**THE RULE IT BROKE IS ALREADY WRITTEN DOWN**, in `production`'s comment about
its own missing list: *"the pack has no list of its own on purpose — one that
knew what 'butchering' was would know what industry it was in, which is the
boundary ADR 0004 draws."* `speciesFrom`, `runKindsFrom` and `channelKindsFrom`
are three instances of the same shape. `enterpriseKindsFrom` is the fourth, and
it should have been written that way first.

**THE NEUTRAL WORD IS "LINE OF BUSINESS", AND "ENTERPRISE" IS THE FARM WORD.**
Enterprise is farm-management vocabulary — the beef enterprise and the dairy
enterprise are the two halves of a herd — and to anybody outside agriculture it
reads as "a company". So it moves to the profile beside `zone: "Paddock"` and
`productionRun: "Batch"`, and core falls back to plain English that needs no
glossary.

- **The table keeps its name.** Renaming a shipped table earns nothing; every
  word a person SEES is resolved.
- **The article is computed.** "Add **an** enterprise" and "Add **a** line of
  business" come from the same code, because a renameable noun with a hard-coded
  article is a grammar bug waiting for a profile whose word starts with a vowel
  — the exact mistake the inventory filter bar shipped as *"Find a item by
  name"* the day before.
- **No profile means a free-text kind box**, not a list. That is the honest state
  for a business nobody has described, and is what the production form does.
- **The examples are gone entirely.** "Whatever you would want a separate profit
  figure for" is the definition and works for a farm, a law firm and a bakery
  alike; an example is an industry.

**Driven on both tenants, which is the only way to prove a seam like this.**
Hilltop Farm reads *Enterprises* / *Add an enterprise* / kinds *Livestock, Crop*.
The Test tenant, with no profile, reads *Lines of business* / *Add a line of
business* / a free-text kind box — and the rail says *Lines of business* too.
Same code, two vocabularies.

**Two fixes from #283 that missed the merge window are folded in here**, having
been pushed after that PR was already merged: the duplicate-name message now
names the EXISTING row rather than echoing what was typed, and the report's
"Split by" picker capitalises its options instead of rendering raw slugs.


### 2026-08-26 — An enterprise is a dimension (`claude/an-enterprise-is-a-dimension`)

Slice 1. The founder's ask was a filter — *"just chicken inventory or just
animals or just feed"* — and the filter bar that shipped the day before answers
two thirds of it with a kind chip. **"Just chicken" is the third, and it is not a
kind**: chicken feed, live broilers and packaged chicken are three kinds and one
enterprise. The name search standing in for it works only while every item
happens to have "broiler" in its name.

**MOST OF THE MACHINERY ALREADY EXISTED, and finding that changed the whole
shape of the work.** Three things were already true:

1. **`dimension_members` is a real registry** and four things already sync into
   it — `lot`, `asset`, `parcel`, `zone`.
2. **The P&L already groups by any dimension type.** `getBalances` takes
   `groupByDimensionType` and the report page builds its picker from *whatever
   types exist in the table*. **"Profit and loss by enterprise" needed no report
   code at all** — it appears the moment the first member is created.
3. **`postEntry` already takes `dimensionMemberIds` per line**, validated and
   one-per-type-enforced.

So slice 1 is a table, a writer and a mirror, and the reporting comes free.

**LAYER 0, FOLLOWING THE PARTY SPINE EXACTLY.** `inventory` tags an item,
`livestock` a pen, `production` a run, `retail` a channel — four packs, no
owner. The party spine's reasoning transfers word for word: *a tenant can buy
Accounting without CRM, so accounting can never reference a `crm_*` table.* A
farm running only `livestock` would have no enterprises at all if this lived in
`inventory`. One table, one writer at `src/lib/enterprises/`, the arrangement
`parties` has.

**AN ENTERPRISE IS A DIMENSION AND NOT AN ENTITY, and the question was already
settled** — `core/balances.ts` states the test: *"a trial balance HAS to balance
within an entity — that is the test ADR 0010 uses to tell an entity from a
dimension in the first place."* Broilers do not keep their own books. No ADR was
needed for this slice because no credible alternative was closed off.

**THE SLUG IS DERIVED ONCE AND NEVER RE-DERIVED**, which is the only decision in
here somebody could reasonably get wrong later. The display name is a copy that
lives in `dimension_members` and every report reads; the slug is what a seed, an
import and any future URL hold onto. So a rename moves the copy and leaves the
handle alone, and `tests/enterprises.test.ts` pins the edge cases — a name
starting with a digit (`e_2026_broilers`, because the CHECK demands a letter
first), accents, a 63-character truncation that would otherwise end on an
underscore, and a name with no handle in it at all, which is **refused rather
than turned into `enterprise_1`**.

**RETIRING ARCHIVES THE MEMBER AND NEVER DELETES IT.**
`archiveDimensionMember`'s own comment says why: *archived members stop being
taggable; existing tags keep reporting.* A business that ran pigs for two years
and stopped still has two years of pig costs.

**THE SCREEN SAYS WHAT IT DOES NOT DO YET, and that panel is not padding.**
Nothing is tagged with an enterprise until slice 2 and no entry carries one
until slice 3, so a farm that built a list and went to the P&L would find every
figure under Unassigned. A page that implied otherwise would be the "setting that
does nothing" this codebase keeps guarding against — the same failure the tax
screen shipped and had to fix an hour later.

**Migration `0214` renumbered by hand from 0213**, because `retail` slice 8 was
open on another branch and had already taken it. Two migrations with one number
is a merge nobody enjoys; the journal entry was renumbered with it.

Driven on the dev branch: five enterprises created, renamed, retired and put
back, with the mirror checked at each step.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `enterprises` | **One line of business.** Broilers, Beef, Eggs | `tenant_id`, FORCE RLS, superadmin_all + member_all. UNIQUE on `(tenant_id, slug)` — per tenant, so two farms both running broilers is ordinary. UNIQUE on `(tenant_id, id)` is the target every pack's composite FK will point at. `kind` is an open taxonomy (P1); `status` is closed. **Name uniqueness is enforced in code, not in the database** — the index is on the machine's handle, and two rows a person named the same thing deserve a sentence rather than a constraint violation |

Mirrored into **`dimension_members`** with `dimension_type = 'enterprise'`, in
the same transaction as every write.

**Not columns, deliberately:**

- **No `parent_id`.** A hierarchy is a tree, a tree needs a rolled-up report, and
  the founder's own list folds layers INTO eggs rather than nesting them.
- **No budget, target or overhead share.** Splitting a mixed stall's fee across
  the enterprises that sold there is an allocation, and allocations want their
  own decision. Unassigned is the honest answer and the P&L renders a column for
  it.

## Key files & seams

- `src/db/schema/enterprises.ts` · `drizzle/0214_enterprises.sql` ·
  `drizzle/0215_enterprises_rls.sql`
- `src/lib/enterprises/index.ts` — **the single door.** Takes the caller's `tx`,
  never opens one, never calls `withSystem`. `enterpriseMemberIds` is the
  enterprise-id → member-id translation every posting path in slice 3 will need,
  and it is here so a pack never reaches into core's tables
- `src/lib/enterprises/slug.ts` — pure. Read before changing anything about
  handles
- `src/app/dashboard/settings/enterprises/` — the screen, owner-only
- `tests/enterprises.test.ts` (pure) · `tests/enterprises-ops.test.ts` (the
  mirror) · `tests/isolation/enterprises.test.ts` (RLS)

## Decisions & gotchas

- **THE MIRROR IS WHAT MAKES THIS REPORTABLE, and it is unconditional.** Every
  write syncs `dimension_members` in the same transaction. Skipping it on a
  rename leaves every report labelling the business by its old name — the
  mistake `land` made once and documents in `updateParcel`.
- **OWNER-ONLY IS ENFORCED TWICE, AND NEITHER IS REDUNDANT.**
  `upsertDimensionMember` calls `requireOwnerRole`, so a staff write cannot
  complete however it arrives; `requireTenantOwner` at the action layer refuses
  first so a person gets a redirect rather than a stack trace from inside core.
  The RLS policy is member-wide on purpose — **staff must be able to READ**, or
  the filter bar the whole thing exists for is invisible to whoever is sent to
  the freezer.
- **THE SLUG NEVER MOVES.** See the build log. If a future slice wants
  human-readable enterprise URLs, they read the slug and accept that it may not
  match the current name.
- **`kind` IS DELIBERATELY WEAK.** It is a grouping for a picker, not a
  taxonomy, and nothing branches on it. Anything that starts branching on
  `kind === "livestock"` should be asked why it is not asking the pack instead.

## Open items

- **NOTHING IS TAGGED WITH AN ENTERPRISE YET.** Slice 2. Until then the P&L's
  new "Enterprise" grouping shows every figure under Unassigned, and the settings
  page says so in as many words.
- **A MIXED MARKET STALL'S COSTS HAVE NOWHERE TO GO, by design for now.** A
  stall selling beef and chicken cannot attribute its $35 fee to one enterprise,
  and doing it anyway would be a confident wrong number. Splitting pro rata by
  the day's sales is defensible and wants an ADR. Until then those costs are
  Unassigned.
- **No back-fill, and there cannot be one.** Entries posted before slice 3 carry
  no enterprise and cannot get one without rewriting history. A report over last
  year will read Unassigned and the screen has to keep saying why.
- ~~**The word "Enterprise" is not label-resolved.**~~ **Closed 2026-08-26**,
  the day after it was written and by the founder noticing rather than by this
  list being read. Both the word and the kind suggestions come from the profile
  now. **The remaining gap: the word is not OFFERED on the superadmin rename
  screen**, because `collectLabelDefinitions` assembles its registry from
  enabled features and this is not one. A stored tenant override is honoured; it
  just cannot be set from the UI.
- **An enterprise cannot be deleted, only retired.** Correct while anything
  might reference it, and there is no "nothing has ever used this one, remove
  it" path for a row created by mistake.
