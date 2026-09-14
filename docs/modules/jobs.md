# Jobs (capability pack)

> Projects with a number and a cost code list, each one a **cost object** every
> bill and every hour can be charged to. The spine the whole construction family
> hangs off, the way `inventory`'s lot is the spine of the farm one — and, like
> every pack, industry-blind: the word "construction" appears nowhere in it.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

Listed by the `construction` profile ([construction.md](construction.md)), which
is the industry that forced it. Nothing here is construction-shaped: a project
has a number, a client, a company, a division and a kind of work, and a fit-out,
a software engagement and a house are the same row.

## Build log

### 2026-09-14 — Slice 3: what it was meant to cost (`claude/what-it-was-meant-to-cost`)

`job_budget_lines` — one amount per cost code per project — and the **job cost
report** that puts it beside what has been ordered. The fourth of the four
numbers, and the one that makes the other three mean something.

**THE SLICE ORDER WAS WRONG AND IS NOW CORRECTED.**
[construction.md](construction.md) had change orders as slice 3 and never
numbered the budget at all — it had been folded into slice 0, pulled out, then
deferred through slices 1 and 2 by this dossier's own build log. Change orders
lose that argument on the merits: **an approved change order revises both the
contract value AND the budget**, so building them first means building the
revenue half and retrofitting the cost half. Budget is 3; change orders are 4.

**PER CODE, NEVER PER JOB.** "The job is $40k over" is a fact; "the framing is
$40k over" is a decision, and only the second is worth a screen. The report is
one row per cost code: budget, ordered, left — with `left` negative and red when
a trade is over.

**EVERY CODE WITH EITHER A BUDGET OR AN ORDER APPEARS.** A code somebody ordered
against and never budgeted is the most interesting row on the page and the
easiest to leave out of the query; it shows with a `Not budgeted` badge.

**A BLANK BOX IS NOT ZERO**, and the form says so. Blank means "no plan for this
code yet"; zero means "carried at nil, so anything spent against it is a
variance". Writing one as the other would turn every untouched row into a fake
overrun, so blanks are dropped at the action rather than saved.

**A SAVE UPSERTS AND LEAVES OMITTED CODES ALONE** — the opposite of a
commitment's lines, which are replaced. The reason is the shape of the work: a
commitment's lines are one document somebody is editing in front of them, while a
budget is built up over weeks by different people. Replacing it would make "I
added the concrete number" quietly delete everything typed since the form was
opened. Removing a code is `removeBudgetLine`, said out loud.

**`original_cents` IS NAMED FOR SLICE 4.** A construction budget moves for one
legitimate reason, and the line every owner and surety knows is *original +
approved changes = revised*. Calling it `amount_cents` would have made the first
change order a migration plus an argument about which number the old column held.
There is no `revised_cents` yet because nothing would write it — the standard
this pack set by refusing `PackDefinition.dimensionTypes` and deleting
`projectValues.openCount` before it shipped.

### The column that is deliberately absent

**There is no per-code ACTUAL.** `getBalances` groups by ONE dimension type, so
it can answer *what has this project cost* or *what has this code cost across
every project* — not both. A per-code actual here would mean either reading
accounting's tables directly, which this pack must not do, or quietly reporting
another job's spend in this job's column. The project-level actual is on the page
as its own figure and the panel says why the code rows stop at "ordered".

Closing it needs `getBalances` to take a second group-by, which is accounting's
call and not this pack's to force.

**A hole found by driving it, the same shape as last slice's.** The budget editor
offered RETIRED cost codes. A retired code is one the business has stopped using
— `updateCostCode` already archives its cost object so it cannot be put on a
bill — and offering it for a new budget is the same mistake one layer up. It now
shows active codes plus any that already carry a budget, because retiring a code
must not strand a figure nobody can reach.

**Driven on the dev branch:** a $40,000 budget on `03 30 00`, then the existing
subcontract's first line coded to it. The report reads **Budget $40,000.00 ·
Ordered $62,000.00 · Left −$22,000.00** in red, while the job's Committed total
stays $100,500.00 — because the order's second line is still uncoded, which is
the honest difference between what a code has against it and what the job owes.

### 2026-09-14 — A module nobody could switch on (`claude/a-module-nobody-can-switch-on`)

**THE PACK WAS INVISIBLE ON PRODUCTION, AND HAD BEEN ALL WEEK.** The founder
asked why he could not see any of it. All six `job_*` tables were there, RLS
enabled and forced, `db:verify-rls` reporting 198 tables clean, four merged PRs —
and **no row in `modules`**, so the pack did not exist as far as the catalogue,
the superadmin registry or any tenant's nav was concerned.

**The cause is structural, not careless, which is why the fix is a check and not
a note.** [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)
makes applying a migration a conscious pre-merge ritual with its own verification
step. The SEED has neither. So a new pack's schema reaches production reliably
and its catalogue row does not — `db:seed -- --dev` had been run, because the dev
branch is where the feature was driven, and the production equivalent never was.

Three things now close it:

- **`npm run db:verify-modules`** — `verify-rls`'s sibling. Same invocation, same
  `--dev` flag, same exit code so it can gate a deploy. It reports what the code
  defines that the database lacks, and names the command that fixes it. **Proved
  to go red before it was trusted**: a fake module added to the catalogue and not
  to either database produced `✗ 1 module(s) MISSING from the database — nobody
  can switch these on` and exit 1.
- **`scripts/seed-catalogue.ts`** — the `MODULES` array extracted out of
  `scripts/seed.ts`, which calls `main()` at module load and so could never be
  imported by a test. `packs-and-profiles.md` had named this exact fix as the
  open item's remedy since Layer 2 shipped.
- **`tests/module-catalogue.test.ts`** — every registered pack and core module
  has a row; no pack is miscategorised (which would silently refuse an
  accountant's writes); no pack is `available` without a `Component`.

**The two halves are different failures and both were real.** The test proves the
code agrees with itself. The script proves a database agrees with the code. Only
the second would have caught this one.

AGENTS.md now carries the seed in the same before-the-merge list as the
migration, and "Adding a module" step 1 says **both** databases out loud.

**Still a human decision, deliberately:** which TENANT has a pack switched on.
The catalogue row makes it possible; `tenant_modules` makes it real, and that is
a sale, not a deploy step. `verify-modules` checks the first and says nothing
about the second, or it would nag forever about every pack nobody has sold.

### 2026-09-14 — Slice 2: committed cost, and a cost code becomes a cost object (`claude/committed-cost`)

`job_commitments` + `job_commitment_lines` — what the business has ordered — and
the change that makes a cost code worth having: **every code is now a
`dimension_members` row.**

**COMMITTED COST IS THE NUMBER A BUDGET IS USELESS WITHOUT.** A job that has
spent $400k of a $1.8m contract looks healthy right up until you notice it has
also issued $1.5m of subcontracts. Actual answers "what has been billed";
committed answers "what is already owed whether or not the invoice has arrived",
and only the second tells a builder whether the job is in trouble. It is the
thing a spreadsheet gets wrong most often, because the PO lives in one place and
the ledger in another.

**A COST CODE IS NOW A COST OBJECT, and accounting needed no change at all.** The
bill builder derives the dimension types it offers from whatever members exist
(`dimensionTypesFrom`), so codes simply appear on a bill line the moment they
sync. A project says WHICH JOB, a code says WHICH TRADE, and a line may carry one
of each because `loadDimensionMembers` refuses only two members of the *same*
type. That is the P5 seam paying for itself: one sync function in the pack, zero
lines in the module it reports through.

`0330` backfills the codes that already existed. A chart where some lines are
taggable and others silently are not is worse than one where none are, and the
difference would only surface as a bill somebody could not code. **It carries
`is_active` through**, so a code retired in the previous slice arrives archived
rather than quietly being offered again.

**ACTUAL COST COMES FROM A CORE EXPORT, NOT A QUERY OF ACCOUNTING'S TABLES.**
`actualByProject` asks `getBalances` for expense balances grouped by the
`project` dimension — which already applies the basis lens and the entity scope,
so a job cost figure that disagreed with the P&L is not reachable. The direction
stays core → lib → pack; accounting still knows nothing about this pack.

**Header and lines, not a flat table.** A framing subcontract covers labour and
materials under one agreement with one vendor and one number. Value and cost code
on the header would have been half the work today and a migration tomorrow. The
form offers one line and an "Add line" button, because one line is the common
case.

**Two asymmetries with `job_contracts`, both deliberate:**

- **`party_id` is NOT NULL here.** A contract may be proposed before the other
  side is a record in the books; a commitment with nobody to pay is not a
  commitment, it is a budget line.
- **`kind` is a CHECK list of two, not an open taxonomy.** A subcontract and a
  purchase order diverge in BEHAVIOUR later — retainage, lien waivers and
  certified payroll attach to bought labour and not to bought material — so the
  pack has to tell them apart. What each is *called* is a label; what each *is*,
  is this.

**Only `issued` and `closed` count as committed.** A draft is written but not
sent, so nobody is owed anything — the same shape of rule, and the same reason,
as a proposed contract not being revenue. One exported constant, read by the SQL
roll-up and by anything that sums.

**An edit REPLACES lines rather than merging them.** A line-by-line patch needs
stable ids round-tripping through a form and a rule for what a missing id means;
replacing is one delete and one insert inside the transaction the caller already
holds, and cannot leave a line nobody meant to keep. Omitting `lines` entirely
leaves them alone, so a status change does not disturb the money.

**A HOLE FOUND BY DRIVING IT.** The cost-code picker on a project was hidden
whenever the tenant had one list — the same "only at two" rule that stops a
single-company business being asked which company. But a project created *before*
the chart of cost existed has no list, and could therefore never be given one:
the control that would do it was hidden by the rule. The picker now also shows
when the row has no list and one exists. No test would have caught this; opening
the form did.

**The FK ordering bit again, exactly as predicted.** `job_commitment_lines`
references `job_commitments`, both new in `0329`, so drizzle-kit emitted the
constraint before the unique index it needs. Hand-reordered with the reason in
the file, as `0325` was — and `0327` needed nothing, which is the control case:
it only bites when two *new* tables reference each other.

**Driven on the dev branch:** a two-line subcontract (`SC-2041`, framing labour
$62,000 and materials $38,500) against Tractor Supply Co, issued. The project's
Ordered panel reads **Contract value $1,949,500.00 · Committed $100,500.00 ·
Actual cost $0.00** — actual is genuinely zero because no bill has been coded to
the job yet, which is the honest answer rather than a missing figure.

### 2026-09-14 — Everything you can create, you can change (`claude/everything-you-can-create-you-can-change`)

Edit surfaces for all three things the pack owns — a project, a contract, a cost
code and its list — plus **the ops test file the first two slices did not have**.
No new tables and no migration.

**ONE DIALOG THAT EDITS WHEN GIVEN A ROW**, rather than a parallel set of edit
components. `vendor-dialogs.tsx` set that pattern (`vendor?: VendorData` →
"Edit vendor" : "New vendor"), and following it means the create and edit paths
cannot drift apart in what they validate or which fields they offer.

**THE VERSION GOES WITH THE EDIT.** `updateProject` and `updateContract` have
taken an optional `version` and thrown `STALE_VERSION` since they were written;
until now nothing passed one, so the check existed and never ran. Two people on
one job is now a refusal with a sentence rather than the last save silently
winning. `tests/jobs-ops.test.ts` pins it for projects, contracts and cost code
lists.

**RETIRED, NEVER DELETED.** A cost code gets `is_active = false`, which takes it
off the list people pick from and leaves every cost already charged to it exactly
where it is. There is no delete verb on the row at all, and the dialog says why
rather than offering one. Same rule `archiveDimensionMember` applies to a cost
object, for the same reason: a code that vanished would take a year of job
history with it. A code may still be RENUMBERED in place, which is what a
business moving from its own scheme to CSI actually does.

**A COST CODE LIST CANNOT BE RE-POINTED**, only renamed. Which list a project is
budgeted against is resolved once at creation precisely so a later change cannot
silently re-chart a job already underway; letting a list be swapped wholesale
would do that to every project at once.

### The three behaviours that had never been tested, and now are

`tests/isolation/jobs.test.ts` builds its fixtures under `withSystem` and never
calls `ops.ts` — deliberately, because it certifies what the DATABASE enforces.
That left the pack's own rules uncovered, and the three that matter are all
**silent** when they break rather than throwing:

- **the cost object follows a rename** — otherwise the job list says one thing,
  every report says another, and nothing errors;
- **cancelling archives it and completing does not** — because bills arrive for
  months after a job finishes (retainage, the last subcontractor invoice) while a
  job that never happened should not be offered on a bill line at all;
- **a stale version is refused.**

All three passed first time, which means the code was right and the tests are now
the guard rather than the discovery.

**A trap the classifier caught.** `tests/jobs-ops.test.ts` first imported its
`d`/`RUN` gate from `./isolation/_shared`. That type-checks and runs — and
`tests/db-backed-files.test.ts` classifies a suite as database-backed by looking
for `process.env.DATABASE_URL` or a `d`/`RUN` import from a **sibling**
`_shared`, so the suite would have landed in the PARALLEL project and raced the
other database suites. That is the once-a-fortnight failure on a machine nobody
is watching, and the enumeration test exists exactly to stop it. The gate is now
declared inline, as `land-ops` and its neighbours do.

**Driven on the dev branch:** a proposed change order edited to signed, and the
project total moved from $1,854,500.00 to **$1,949,500.00 across 3 signed
agreements** with the "still proposed" clause gone; the project renamed to
"Oak Row residence — phase 2" and the cost object followed it in
`dimension_members`, confirmed in the database as well as on the page; a cost
code retired and shown greyed with a `Retired` badge.

### 2026-09-14 — Slice 1: a contract is a table (`claude/contracts-many-per-project`)

`job_contracts`, many per project, plus the value roll-up and the form that
writes them. **No pay applications, no retainage, no schedule of values** —
those are the billing slice, and a column nothing reads is worse than an honest
absence.

**A CORRECTION TO `construction.md`: there is no `direction` column.** The
dossier's data model listed one — *"`direction` says whether the pilot bills it
or is billed on it"* — while its prose two hundred lines earlier already said the
true thing: *"`commitments` stays what the company issues outward; `contracts` is
what it bills against."* Both cannot hold. Once commitments are their own table
on the cost side, every row here is billed BY the business and direction has
nothing left to distinguish.

What genuinely varies is **`role`**: `prime` (the business holds the contract
with the owner) or `subcontract` (it holds a subcontract under somebody else's
GC — the pilot's cabinet shop and excavation division on other people's jobs).
Both are billed by the business; what changes is who the counterparty is and,
later, whether retainage is held FROM it. `tests/jobs.test.ts` asserts the column
is absent, so a future slice that adds one has to argue with a test first.

**`sequence`, not dates, keeps the ladder in order.** Concept Design →
Construction Drawings → New Home is the order the agreements were made, and a
drawings contract signed late is still the second step. A new contract lands at
the end.

**ONLY SIGNED AND COMPLETE CONTRACTS COUNT toward what a job is worth**, and this
is the one rule in the slice with a money consequence. A concept the client has
not signed is not revenue; a total that quietly included it would report the
business as bigger than it is, which is the number an owner takes to a bank. The
rule is one exported constant, `VALUED_CONTRACT_STATUSES`, read by both the SQL
roll-up in `projectValues` and the project page's own sum — two places that must
never disagree about what a job is worth.

**`billing_method` is a CLOSED list, unlike `kind`.** A kind is a word, and a
pack shipping that list would know its industry; a billing method is a *sum*, so
the pack has to implement one before it can honestly offer it and adding one is a
migration. Seven are declared, the pilot uses three (`progress_draw`,
`schedule_of_values`, `draw_schedule`). **Slice 1 only records which applies.**

**A BUG FOUND BY DRIVING IT, with a money consequence.** Adding two contracts in
a row: the second silently inherited `Complete` from the first, because the
dialog is one component and `submit()` cleared the text fields but not the
selects. An unsigned proposal would have been recorded as money owed. Status,
role and billing method now reset — all three, because a form that remembers some
fields and forgets others is worse than one that forgets all of them. No test
would have caught this; two clicks did.

**Driven on the dev branch**: three agreements on `24-108 Oak Row residence` —
Concept Design $12,500 complete, New Home $1,842,000 complete, Change Order 1
$95,000 proposed. The panel reads *"Worth $1,854,500.00 across 2 signed
agreements, with 1 still proposed"*, and the job list's SQL roll-up agrees with
the page's own sum to the cent. `$1,842,000` and `12,500` both parsed from what a
person actually types.

### 2026-09-14 — Slice 0: the project spine (`claude/jobs-the-project-spine`)

Three tables, the dimension sync, and the two screens that make them usable.
**No contracts, no budget, no commitments** — those are slices 1 and 2 in
[construction.md](construction.md), and a project with actual cost against it is
already the thing a spreadsheet does worst.

**THE DIMENSION SYNC IS THE POINT, not the screen.** `createProject` writes
`dimension_members` in the SAME transaction, so from the first project every bill
line and every timecard can be charged to a job and every accounting report that
already exists groups by it — with no change to accounting, which must never
learn this pack exists. A project that existed without its cost object would be
an entity no report can group by, which is the failure
[packs-and-profiles.md](packs-and-profiles.md) names when it says a pack that
tracks activity without syncing a dimension member "has built a to-do list".

**The three coordinates are deliberately not the delivery method:** `entity_id`
(whose books — required, ADR 0010), the enterprise (which division — optional,
and a different question), and the cost code set (which chart it is budgeted
against). The pilot's Construction, Excavation and Cabinet Shop are three
enterprises inside ONE entity.

**`delivery_method` is nullable, and that is the feature.** A project may begin
before anyone knows what gets built — the pilot's first contract on a custom home
is a Concept Design agreement, and the client may look at the number and walk.
Most software in this market requires a build to exist before a job can, which is
exactly why pre-construction revenue ends up in a spreadsheet. ADR 0056.

**DRIVEN ON THE DEV BRANCH, by hand.** A project was created through the form,
its cost object confirmed in `dimension_members` (`24-108 · Oak Row residence`,
active), a cost code list added and the first-list-becomes-the-default rule
watched working, and a code (`03 30 00 Cast-in-place concrete`) added to it. The
conditional pickers behaved as designed: Hilltop Farm has one company and no
divisions, so neither picker appeared, and with no profile installed the kind of
work was a free-text box rather than an empty dropdown.

**Those rows are still on the dev branch, deliberately.** A farm tenant with a
custom home on it reads oddly; it is the only way to exercise this pack before
the `construction` profile exists, and slice 1 will want a project to hang a
contract off.

**A BUILD ERROR THAT `tsc` AND `eslint` BOTH MISSED**, found only by opening the
page: `export const PACK = "jobs"` in a `"use server"` file. Such a file may
export nothing but async functions, and neither the typechecker nor the linter
says so — `npm run build` had passed too, because the pages that import it did
not exist yet when it ran. `PACK` now lives in `vocabulary.ts`, which is where
the other packs keep theirs. **A green `tsc`, a green lint and a green build are
not a rendered page**, and this pack cost one browser load to learn it again.

**Three more things found while building it, worth more than the code:**

- **`PackDefinition` has no `dimensionTypes` field.** The "shapes" section of
  [packs-and-profiles.md](packs-and-profiles.md) shows one, and every pack that
  syncs a dimension does so without declaring it. Not added here: nothing reads
  it, and a field nothing reads is worse than an honest absence. Recorded in that
  file's open items instead.
- **The icon registry catches nobody.** `getIcon` falls back to a generic box
  rather than throwing, and its own header records that five packs once shipped
  showing that box because their key was never added. `hard-hat` was added in the
  same commit as the pack, which is what the header asks for — there is still no
  test.
- **A composite FK needs its unique index to exist FIRST**, and drizzle-kit emits
  every `ADD CONSTRAINT` before every `CREATE INDEX`. That is fine when the
  referenced table is older and fatal when both are new in one file, which is the
  case here: `0325_jobs.sql` is hand-reordered, with the reason written into the
  file, because regenerating it would silently undo the move.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `job_cost_code_sets` | A named list of cost codes. One or several per tenant. | FORCE RLS, member-wide. `job_cost_code_sets_one_default_idx` is a PARTIAL unique index, so **two defaults fail at the database** rather than depending on the action having cleared the first. |
| `job_cost_codes` | One line of the chart of cost. | Composite FK to `(tenant_id, set_id)`, **cascade** — deleting a list deletes its codes. `code` is free text, never a number: CSI writes `03 30 00`, NAHB writes `1000`, a builder writes `CONC-SLAB`. `sort_order` is what orders the list, so a code never has to be sortable to be right. |
| `job_contracts` | **Many per project.** Kind, value, billing method, counterparty, role, status, and a `sequence` that keeps the ladder in agreed order. | Composite FK to the project, **cascade** — a project's agreements are part of it, proved in the isolation suite rather than assumed, because a dangling contract would still be summed by `projectValues`. `kind` is an open taxonomy (format check only); `role`, `status` and `billing_method` are CHECK lists. **No `direction` column** — see the build log. |
| `job_budget_lines` | What each cost code was PLANNED to cost. | One line per code per project, enforced by a unique index rather than by the action remembering — two would make every variance ambiguous. `cost_code_id` is NOT NULL, unlike a commitment line's: a budget without a code is a single number for the whole job, which is what this table exists to stop being the answer. `original_cents` is named for the revision slice 4 will add beside it. RESTRICT to the code, so a budgeted code is retired and never deleted. |
| `job_commitments` | What the business has ORDERED: a purchase order or a subcontract. | `party_id` is NOT NULL — a commitment with nobody to pay is a budget line, not a commitment. `kind` is a CHECK list of two because the two diverge in behaviour later. Number unique per tenant: a vendor quotes it back on the invoice. Cascade from the project. |
| `job_commitment_lines` | The money, one cost code at a time. | Cascade from the commitment; **RESTRICT to the cost code**, which is the backstop for "codes are retired, never deleted". Amount non-negative — a credit is a change order. |
| `job_projects` | The spine. | FOUR composite FKs, each certified in `tests/isolation/jobs.test.ts`: company, division, client, cost code list. `delivery_method` is an open taxonomy (P1) with a **format check and no value check**, and is nullable. `metadata` is the P2 extension bag. |

Migrations `0325_jobs.sql` / `0326_jobs_rls.sql` (slice 0) and
`0327_job_contracts.sql` / `0328_job_contracts_rls.sql` (slice 1), each applied
to dev and prod before its merge, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
`0329_job_commitments.sql` / `0330_job_commitments_rls.sql` (slice 2) and
`0331_job_budget.sql` / `0332_job_budget_rls.sql` (slice 3) follow the same rule —
and from slice 3 the pair is `db:verify-rls` **and `db:verify-modules`**, after
the pack shipped invisible for want of a catalogue row. `db:verify-rls` reports **198 tables**, all enabled, forced and with
policies, on both.

**0327 needed no hand-reordering, which confirms the diagnosis in 0325.** Both
tables it references — `job_projects` and `parties` — are from earlier
migrations, so their unique indexes already existed when the FKs were added. The
ordering only bites when two new tables reference each other in one file.

## Key files & seams

- `src/packs/jobs/ops.ts` — the write surface. Owner-only, and forced from below:
  `upsertDimensionMember` calls `requireOwnerRole`, so a staff-created project
  could not sync its cost object.
- `src/packs/jobs/actions.ts` — `requireTenant()` + `requireModuleEnabled()` +
  `withTenant(..., { role })`, the three things AGENTS.md asks of a pack.
- `src/packs/jobs/vocabulary.ts` — **ships no list of delivery methods and no
  list of cost codes**, on purpose. Both would make the pack know its industry.
  `deliveryMethodsFrom(config)` reads the profile's suggestions, total by
  construction like `speciesFrom` and `runKindsFrom`.
- `src/packs/jobs/JobsModule.tsx` — the job list. One statement with four left
  joins, not a lookup per row.
- `src/app/dashboard/m/jobs/[id]/page.tsx` — one project. **Says on the face of
  the page whether the cost object exists**, because nothing else in the product
  would, and the alternative is discovering it from a report quietly missing a
  column.
- `src/app/dashboard/m/jobs/cost-codes/page.tsx` — the chart of cost.

## Decisions & gotchas

- **[ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)** —
  the flavour of construction is a property of the PROJECT. A pack must never
  branch on `delivery_method`; it is data a project TEMPLATE reads, and a pack
  that said `if (deliveryMethod === "commercial")` would have re-created the
  industry branch with a new spelling.
- **The first cost code set becomes the default**, whether or not anybody asked.
  A business with one list must never be asked which list a project uses, and a
  first set that was not the default would make every project carry an explicit
  choice forever.
- **A project's cost code set is resolved ONCE at creation**, not read through.
  A tenant that later changes its default must not silently re-chart a job
  already underway — the same reasoning as a profile seed being copied rather
  than resolved live (ADR 0009).
- **Cancelling a project archives its cost object; completing one does not.**
  Closing a job does not stop bills arriving against it — retainage and the last
  subcontractor invoice turn up months later — whereas a job that never happened
  should not be offered on a bill line at all. Archiving keeps every tag already
  made reporting.
- **The whole project is visible to every member**, including its client and its
  dates. On a construction job those are the numbers people are most often told
  not to discuss. A business wanting them hidden from its own field staff needs a
  per-project visibility model, which is a bigger question than this pack and one
  nobody has asked; Documents' owners-only folder is where a contract with a
  price in it belongs today. Said out loud in `0326_jobs_rls.sql` too.

## Open items

- ~~**No budget.**~~ — **closed 2026-09-14.** All four numbers exist: worth,
  planned, ordered, spent.
- **Nothing revises a budget or a contract value.** An approved change order is
  the one legitimate reason either moves, and it is slice 4. Today both are edited
  in place, which loses the *original + approved changes = revised* line every
  owner and surety reads.
- **ACTUAL COST IS PER PROJECT, NOT PER CODE, and the blocker is now named.**
  `getBalances` groups by ONE dimension type, so it can answer *what has this
  project cost* or *what has this code cost across every project* — never both.
  The job cost report therefore stops at "ordered" per code and says so on the
  page. Closing it needs a second group-by in `getBalances`, which is
  **accounting's call**: this pack must not read its tables, and faking it would
  report another job's spend in this job's column.
- **Nothing bills.** `billing_method` is recorded on every contract and read by
  no code. Pay applications, retainage and the schedule of values are slice 4.
- ~~**A contract cannot be edited from the screen.**~~ — **closed 2026-09-14.**
- **Nothing can be DELETED, and that is deliberate rather than missing.** A
  contract that should not exist is `cancelled` or `declined`; a cost code is
  retired; a project has no delete verb at all. The one real gap is a project
  created entirely by mistake, which today can only be `cancelled` — acceptable
  while a project is cheap to ignore, and worth revisiting if a business starts
  accumulating typos.
- **A contract's project cannot be changed.** Moving an agreement between jobs is
  a different and riskier act than editing it, and nobody has asked.
- ~~**Nothing edits a project yet.**~~ · ~~**A cost code cannot be renamed,
  reordered or retired from the UI.**~~ — **both closed 2026-09-14.** Every
  thing the pack creates can now be changed, and the version check that had
  existed unused since slice 0 is finally passed by the forms.
- **Nobody has clicked any of it.** Written, typechecked, built and certified
  against a real database — but the screens have not been driven by a person.
  The construction profile does not exist yet either, so `deliveryMethodsFrom`
  has never returned a non-empty list outside a test.
- **`job_projects.number` is not generated.** Every business numbers its jobs its
  own way and the pilot's scheme is unknown, so the field is free text and the
  form suggests nothing. A generator is worth building only once a real scheme is
  in front of us.
