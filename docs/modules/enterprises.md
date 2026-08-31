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
| **2** | **What belongs to what** — `enterprise_id` on items, lots, channels and runs; the inventory filter bar gains a row | **shipped 2026-08-26** |
| **3** | **The cost side** — `postMovement`, the cost corrections and the production accrual carry the member | **shipped 2026-08-30** |
| 4 | The revenue side — `retail` posts a sale, tagged per line | blocked, and bigger than it reads — see below |

**Slice 4 stays parked, and slice 3 stopped being parked for the reason that
never appears in a data argument.** The parking note of 2026-08-26 said the
production database held three inventory/production journal entries and zero
retail sales ever, so the report would be an empty page. Re-measured on
2026-08-30 that is **still exactly true** — three entries, zero sales, zero
enterprises, nothing tagged, and Hilltop Farm has no journal entries in
production at all. Nothing moved.

**What moved is the reading of it. There is no back-fill, so waiting does not
accumulate data for the report — it accumulates permanently untagged data.**
Every entry posted between the decision and slice 3 landing is dead to
profit-per-enterprise forever. Volume was treated as a reason to wait; no
back-fill makes volume a reason to hurry, and it is the only argument here that
gets stronger the longer it is left.

**Slice 4 is blocked and is also a bigger slice than one line suggests.**
`retail` posts **nothing** to the ledger — there is no `postEntry` anywhere in
the pack — so slice 4 is not "tag the revenue posting", it is *build* it: which
accounts, cash versus card receipt, whether a sale posts at all under the
cash-basis lens, what a void does. `retail` slice 5, the founder's own stated
blocker, is still unbuilt: `collectPayment` exists in `src/lib/payments/terminal.ts`
and is wired only to the settings test screen, never into `recordSale`.

**The cost side reaches further than its name**, which is the other thing that
changed the balance. `recordSale` → `issueStock` → `recordMovement` →
`postMovement`, so a market sale already writes `Dr COGS / Cr Inventory`. Slice 3
therefore tags the cost of goods sold at a stall as well as feed and processing —
half a margin, waiting on slice 4 for the other half.

## Build log

### 2026-08-31 — A split kept the animals and lost the money (`claude/the-cost-side`)

Folded into the slice 3 PR before it merged. Two defects inside slice 3's own
remit, found by reading what the slice leans on rather than by anything failing,
plus a crash found by typing a wrong URL at the page while driving it.

**`splitLot` DROPPED THE PARENT'S ENTERPRISE, and `livestock` splits through
it.** It copied `source`, `parentLotId`, `openedOn` and `notes` and left
`enterpriseId` out, so `createLot` read it as *"not said"* and inherited the
ITEM's. A pen tagged Broilers split into two produced a child carrying whatever
the item happened to say. `livestock`'s own comment — *"the biology travels with
the animals"* — was true of the species, the sex, the birth date and both
parents, and not of the money. **`splitIntoIndividuals` calls it once PER
ANIMAL**, so naming ten cows out of a pen minted ten mis-tagged lots in one
click.

**The live proof was already sitting on the dev tenant**: `Speckles`, split off
`PEN-1` on 2026-08-28. `PEN-1` is untagged, the item *Broiler chicks* is
Broilers, and Speckles came out **Broilers** — the item's tag, not its parent's.
A split had moved cost from Unassigned into Broilers.

**THE PARENT'S VALUE IS PASSED EVEN WHEN IT IS NULL**, which is the decision
rather than an edge case. An explicitly untagged parent must not have the item's
tag applied to its children behind its back — the same "wrong and quiet" the
no-fallback rule refuses everywhere else. **A split must not move cost between
lines of business in either direction.** Both directions have a test and the
first fails without the fix.

**A BATCH COULD NOT BE TOLD WHERE IT BELONGED.** `LotForm` had no picker, so
`inventory_lots.enterprise_id` — the column the costing reads hardest, since the
posting path deliberately will not fall back to the item — could only ever be set
by inheritance at creation.

**THE PICKER STARTS FROM THE ITEM'S TAG, AND THAT IS WHAT MAKES IT SAFE TO ADD.**
Defaulting to *None* would send an explicit `null` on every batch and turn off
slice 2's inheritance, putting a farm that tagged "Broiler chicks" once back to
saying so on every hatch. Starting from the item makes the default outcome
identical to inheriting and shows the person what it will be instead of leaving
it invisible.

**`?enterprise=all` 500'd THE WHOLE INVENTORY HUB.** Slice 2's filter passed the
query value straight into a `uuid` column, and Postgres raises
`invalid input syntax for type uuid` rather than matching nothing. Guarded at
`listItems`, the pack's door, so every caller is covered. **No rows rather than
every row**: a valid uuid belonging to another tenant already returns nothing
there, so a malformed one behaving the same way is consistent — and showing
somebody the full list under a bar claiming to be filtered is the worse lie.

Driven on Hilltop Farm: the picker reads *None* on untagged *Grower crumble* and
prefills *Broilers* on *Broiler chicks*; splitting `HATCH-4A` produced
`HATCH-4A-SPLIT` carrying Broilers; and `?enterprise=all` renders *Nothing
matches* with a Clear filters button.

### 2026-08-30 — The cost side (`claude/the-cost-side`)

Slice 3, and the first entry in this repo where a journal line says which line
of business it belongs to. **No migration** — every column landed in slice 2 and
`journal_line_dimensions` has existed since long before slice 1.

**THE PARKING ARGUMENT WAS RE-MEASURED BEFORE IT WAS OVERRULED, and it was still
true on its own terms.** Production holds the same three inventory/production
entries it held on 2026-08-26, still zero retail sale lines ever, still zero
enterprises, still nothing tagged. What overruled it is above in the slice table:
**no back-fill means the waiting itself is the cost.**

**A MOVEMENT HAS TWO SIDES AND THEY ARE NOT ALWAYS THE SAME LINE OF BUSINESS.
This shipped wrong first and the database suite caught it.** The first version
tagged both journal lines with the cost bearer, on the precedent of `assets`
doing exactly that for depreciation — and that precedent does not transfer,
because an asset's expense and its accumulated depreciation are always the same
asset's, while a stock issue can cross enterprises. Untagged feed going down a
Broilers pen's throat posted:

```
Dr 5000  40.00  [Broilers]     the cost landed on Broilers  ✓
Cr 1300  40.00  [Broilers]     ...and Broilers' stock fell $40?  ✗
```

`1300` grouped by enterprise came out at **minus $40 for Broilers** against plus
$100 Unassigned. Broilers never held that feed. So the rule returns two values —
**the P&L line carries the cost bearer, the inventory and GRNI lines carry the
batch's own** — and they coincide on everything except the cross-enterprise
issue, which is precisely the movement the dimension exists to get right.

**WHAT CONSUMED IT WINS, WHICH IS THE RULE SLICE 2 SAID THIS WOULD REST ON.**
*"Grower crumble" belongs to no one part of a business while the pen it was fed
to belongs to exactly one.* `issued_to_lot_id`, the column that closes the
livestock costing loop, answers the money question by the same join.

**A BATCH DOES NOT FALL BACK TO ITS ITEM, and it is the one call here somebody
could reasonably make the other way.** A stored `null` on a lot cannot be told
apart from "the item was untagged when this batch was made", so falling back
would override somebody who explicitly said none. An untagged batch posting to
Unassigned is INCOMPLETE — visible on the P&L, askable with the filter bar's
*Not set* pill, fixable by tagging the batch. Wrong and quiet is the worse
failure, which is `resolveServicesAccruedAccount`'s own standing rule.

**RETIRING AN ENTERPRISE WOULD HAVE STOPPED STOCK BEING RECORDED.** `postEntry`
refuses an inactive dimension member outright and inventory posts from inside
`recordMovement`, so `enterpriseMemberIds` handing back an archived member would
not have mis-tagged an entry — it would have failed the whole movement write.
Retiring Pigs would have made every subsequent movement on a batch still tagged
Pigs impossible to record: a business stopping because of a report. The map is
active-only now, which is `archiveDimensionMember`'s own contract rather than a
special case — *"archived members stop being taggable; existing tags keep
reporting."* There is a test that retires a line of business and then receives
stock against it.

**THE PRODUCTION ACCRUAL DERIVES; THE RUN'S COLUMN IS ONLY THE OVERRIDE.** Slice
2 wrote that down and nothing had read it yet: *"Set it when a run mixes inputs
from more than one, which is the case nothing else can work out; otherwise the
input lots already know and this stays null."* So `enterpriseForRun` folds the
input batches and the column settles a mixed run — which means a farm that
tagged its pen months ago gets its kill-day fee under Broilers without ever
opening the run form. **A genuinely mixed run derives null and its fee is
Unassigned**, which is the mixed market stall's answer wearing different clothes;
inventing a split is the allocation this dossier says wants its own decision.

**THE OVERRIDE HAD NO UI AT ALL**, which is why zero runs are tagged anywhere.
Slice 2 added `production_runs.enterprise_id` and left it unreachable, so a mixed
run had no way to be told. `StartRunForm` gets the shared `EnterprisePicker`,
with a hint saying it is normally left alone — a field most people should skip
needs to say so, or it becomes a question everybody answers wrongly.

Four posting paths carry it: `postMovement`, `postCostAdjustment`,
`postCapitalisation` and `postServiceAccrual`. The cost correction is not
optional tidiness — a $60 correction landing in Unassigned while the delivery it
corrects sits under Broilers is the report disagreeing with itself.

### 2026-08-26 — What belongs to what (`claude/what-belongs-to-what`)

Slice 2, and the one the founder actually asked for back at the start: *"a
filter tool to filter just chicken inventory or just animals or just feed."* The
kind chips answered two thirds of that the day before. **This answers the third,
and it is one click now instead of a substring that happens to work.**

**FOUR COLUMNS, ONE MIGRATION, ALL NULLABLE.** `enterprise_id` on
`inventory_items`, `inventory_lots`, `retail_channels` and `production_runs`.
Every one a composite FK to `(tenant_id, id)`, so naming another tenant's line of
business is UNREPRESENTABLE rather than merely refused by application code — it
fails under `withSystem` too, and there is a test that proves it. No `onDelete`:
an enterprise is archived and never deleted, so a delete reaching one of these is
a mistake worth stopping.

**A BATCH INHERITS ITS ITEM'S, AND THAT IS THE RULE SLICE 3 RESTS ON.** A farm
that has tagged "Broiler chicks" must not have to say so again on every hatch —
and the batch is where the costing will read it from, because *"Grower crumble"
belongs to no one part of a business while the pen it was fed to belongs to
exactly one*. `undefined` means "not said" and inherits; `null` means "said
none" and does not. Same distinction the pack keeps everywhere.

**"NOT SET" IS A PILL, AND IT IS THE ONE SOMEBODY WILL USE MOST.** The question
after tagging anything is *what have I not tagged yet*, and it is unaskable if an
absent filter and an explicit untagged filter mean the same thing. It hides
itself when nothing is untagged, because then it answers nothing.

**THE ENTERPRISE ROW HIDES UNTIL SOMETHING CARRIES A TAG.** A business with no
list, or a list nobody has used, gets no row. A pill group where every count is
zero is furniture, and furniture is what teaches people to ignore a filter bar.

**THE COUNTS ARE OVER THE UNFILTERED LIST, and getting that wrong would have
been invisible.** Counting the filtered rows makes every pill read the number
currently showing — so picking Broilers would leave every other pill at zero and
the bar would look like the data had gone.

**`FilterPills` EXISTED AND THE FILTER BAR SHOULD HAVE USED IT.** Yesterday's
slice hand-rolled a `FilterChip` beside a component that already rendered links
with counts and an active key, and already carried the house decision that a
filter is a fill and navigation is an underline. Both rows go through
`FilterPills` now and the duplicate is gone.

**One picker for four packs**, at `src/components/app/`, for the reason the table
is at Layer 0. It takes the word as a prop — a core control that said
"Enterprise" would be the mistake the settings screen shipped and had to fix a
day earlier — and renders nothing at all when there is nothing to pick.

Driven on the dev branch's Hilltop Farm: *Whole broilers* (Meat) and *Broiler
chicks* (Livestock) both tagged Broilers, and the Broilers pill returns **both**
— two kinds, one line of business, which is exactly what a kind filter
structurally cannot do. *Not set* returns the other six.


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
  enterprise-id → member-id translation every posting path uses, and it is here
  so a pack never reaches into core's tables. **Active members only** — see
  Decisions
- `src/lib/enterprises/slug.ts` — pure. Read before changing anything about
  handles
- `src/packs/inventory/core/enterprise.ts` — **pure, and the whole of slice 3's
  thinking.** `enterpriseForMovement` (two sides, one call) and
  `enterpriseForRun`. Read this before touching any posting path
- `src/packs/inventory/ledger-ops.ts` — `enterpriseLineTag` and
  `enterpriseOfLot`, and the four postings that carry a member
- `src/app/dashboard/settings/enterprises/` — the screen, owner-only
- `src/components/app/enterprise-picker.tsx` — one picker, used by the inventory
  item form and the production run form
- `tests/enterprises.test.ts` (pure) · `tests/enterprise-costing.test.ts` (pure,
  the rule) · `tests/enterprises-ops.test.ts` (the mirror) ·
  `tests/enterprise-posting.test.ts` (the ledger, grouped through `getBalances`)
  · `tests/isolation/enterprises.test.ts` (RLS)

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
- **A MOVEMENT'S TWO SIDES CAN BELONG TO DIFFERENT LINES OF BUSINESS.** The P&L
  line carries what BORE the cost; the inventory and GRNI lines carry whose
  STOCK moved. Identical on everything except a cross-enterprise issue — feeding
  one enterprise's stock to another — where collapsing them to one value put a
  **negative** balance in `1300` for an enterprise that had never held the goods.
  Anything adding a fifth posting path should decide which side each line is.
- **`enterpriseMemberIds` IS ACTIVE-ONLY, AND THAT IS CORRECTNESS RATHER THAN
  TIDINESS.** `postEntry` refuses an inactive member and inventory posts from
  inside `recordMovement`, so offering an archived member fails the stock write
  rather than mis-tagging an entry. Retiring an enterprise would have stopped
  movements on every batch still tagged with it.
- **THE RUN'S `enterprise_id` IS AN OVERRIDE AND NOT THE SOURCE.** The accrual
  derives from the batches that went in; the column only settles a run that
  mixed two. Code that starts reading it as the primary answer will silently
  un-tag every run nobody filled the field in on, which is nearly all of them.

## Open items

- ~~**Nothing is tagged with an enterprise yet.**~~ Closed by slice 2, and the
  ledger end by slice 3. **What remains: only the COST side is tagged.** Until
  slice 4 the P&L by enterprise is expenditure with no income beside it, so it
  answers *what has Broilers cost me* and not *what has Broilers made me*.
- **A MIXED MARKET STALL'S COSTS HAVE NOWHERE TO GO, by design for now.** A
  stall selling beef and chicken cannot attribute its $35 fee to one enterprise,
  and doing it anyway would be a confident wrong number. Splitting pro rata by
  the day's sales is defensible and wants an ADR. Until then those costs are
  Unassigned. **A mixed production run takes the same answer** — see
  `enterpriseForRun`.
- **No back-fill, and there cannot be one.** Entries posted before 2026-08-30
  carry no enterprise and cannot get one without rewriting history. **The day
  slice 3 shipped is the day the report starts being true**, and every figure
  before it is Unassigned permanently. The screen has to keep saying why.
- **RETAIL CHANNELS CAN BE TAGGED AND NOTHING CAN TAG THEM.** Slice 2 added
  `retail_channels.enterprise_id`; the run form got its picker in slice 3 and
  the channel form did not, because nothing reads the column until slice 4.
  Whoever builds the revenue side owns this.
- **An item's tag does nothing for a batch created before it was set.** The
  inheritance runs at `createLot` and the posting path deliberately does not
  fall back — so tagging an item today does not reach yesterday's batches.
  Discoverable through the filter bar's *Not set* pill; not signposted anywhere
  else.
- **AN EXISTING BATCH CANNOT BE RETAGGED, and that is the sharpest gap left.**
  The picker is on batch CREATION only, because `inventory` has no lot edit
  surface at all — `ops.ts` goes `createLot` straight to `closeLot`, and
  inventing one carries an unstated decision about what else becomes editable.
  So `Speckles` on the dev tenant is mis-tagged by the old split and there is no
  way to correct it from the app. Whoever adds `updateLot` closes this.
- **`splitLot` was the only lot-creating path copying a parent.** If another
  appears — a merge, a reclassification — it has to make the same choice
  deliberately, because omitting `enterpriseId` silently means "inherit the
  item's" rather than "copy the parent's".
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
