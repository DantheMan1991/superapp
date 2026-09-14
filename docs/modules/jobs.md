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

### 2026-09-14 — The column that was deliberately absent (`claude/spent-per-code`)

**Actual cost per code, on this job only.** The job cost report's `Spent`
column, missing since slice 3 and named as an open item through slice 6
because `getBalances` grouped by one dimension type — a job's cost, or a
code's cost across every job, never both — and faking it would have put
another job's spend in this job's column. Accounting's `getBalances` now takes
`withinMemberId` (accounting.md, same day): the ledger sliced to the lines
tagged with THIS job's cost object, then grouped by cost code. Another job's
spend on the same code cannot reach the column by construction, which the ops
test proves with a 999,000 line on the other job.

**LEFT IS MEASURED AGAINST THE GREATER OF ORDERED AND SPENT.** Ordered but not
yet billed is still owed; billed beyond what was ordered has already
happened. Neither alone is the number to hold a budget against, and their
sum would count the same dollar twice — a subcontract's bill IS its
commitment arriving. `JobCostRow.projectedCents` is that maximum; `variance`
is budget minus it. Every existing variance is unchanged where nothing has
been spent, which is why the slice-3 test still passes untouched.

**THE UNCODED REMAINDER IS SAID, NOT HIDDEN.** A line tagged with the job
and no code is real cost that no row can carry; `jobCostReport` returns it
as `uncodedActualCents` and the page says how much, where it is (the job's
total), and where to fix it (the bill in Accounting). A code spent against
but never budgeted or ordered joins the report as a `Not budgeted` row, the
same treatment the ordered-but-unbudgeted row has had since slice 3.
`jobCostRows` stays as the rows alone.

Accrual figures. A job's cost is what was incurred; the cash lens is for
statements, not for holding a trade to its budget.

Tests: one more ops (three codes, one spent beyond its order, one spent
against with no budget, an uncoded line, and the other job's spend on the
same code; the whole-job figure agreeing), and the accounting suites above.
The guide's *What the report does not show yet* is gone.

**DRIVEN ON THE DEV BRANCH, on 24-108.** Before: *Budget $45,000.00 against
$62,000.00 ordered and $0.00 spent*, the one row reading **$62,000.00 ·
$0.00 · −$17,000.00**, and the note under the table: *$325,000.00 has been
spent on this job with no cost code on the line; it is in the job's total
below and in no row here* — the slice-6 drive's cost, which was tagged with
the job alone. Then a journal entry through Accounting: *Dr 5100
Subcontractor Expense $70,000.00* tagged **03 30 00 · Cast-in-place concrete,
24-108 · Oak Row residence — phase 2** (both tags on one line, from the same
popover) / *Cr 2000*, dated 2026-09-22 → the panel read *Budget $45,000.00
against $62,000.00 ordered and $70,000.00 spent*, the row **$62,000.00 ·
$70,000.00 · −$25,000.00** in red — Left now measured against the spend,
because it passed the order — the uncoded note unchanged at $325,000.00, and
the job's *Actual cost* tile **$395,000.00**, which is the row plus the
uncoded remainder. Not driven: a cash-basis tenant (the farm is accrual), and
a bill through the Purchases screen rather than the journal — the tags are
the same rows either way.

### 2026-09-14 — The first letter of every panel (`claude/jobs-panels-padding`)

**Found by the founder on production, on the Test tenant's first job.** Every
panel on every page of this pack — the project, its daily log, a contract,
the cost code lists — was a bare `<Panel>` with its content flush against the
edge, and `Panel` is `overflow-hidden rounded-2xl` with no padding of its own
(it is the surface a `DataTable` sits on edge to edge). So the first glyph of
any line inside the rounded corners was clipped: *etails*, *ontracts*, *ob
cost*, *unch list*, *othing ordered yet*. Seven slices were driven by reading
the page's TEXT, which does not know what a corner hid — the one thing a
screenshot would have shown on day one. Every jobs panel now carries `p-5`,
the convention the livestock and asset pages already had; the WIP page's
inner `p-4` wrappers moved onto the panel to match. No behaviour changed.

**The lesson, recorded so the next pack does not repeat it:** a pack's first
page should be looked at, not only read, and a `Panel` needs padding unless
what it holds is a full-bleed table.

### 2026-09-14 — Slice 6: what the work is worth, not what was billed for it (`claude/work-in-progress`, ADR 0059)

`job_wip_periods` and `job_wip_lines`, one page (`/dashboard/m/jobs/wip`),
and the pack's first journal entry of its own: **the work-in-progress
schedule** — percent complete, earned revenue, under- and over-billing per
job as of a period end — and **the adjustment that trues revenue up to the
work**, posted through Accounting's `postEntry` and reversed the next day.
Built after slice 7, because the founder chose the field first; numbered 6
because that is where the design put it.

**EVERY INPUT ALREADY EXISTED, WHICH IS WHY THE SLICE IS SMALL.** Contract
value is slice 1 plus slice 4's approved changes (`projectValues`); the
estimated cost is slice 3's revised budget summed per job (`budgetByProject`,
new); cost to date is `actualByProject`, which gained an `asOf`; billings are
`billedByProject`, new and the same query on income accounts, negated. All
four read as of the period end, through the project's cost object, and the
pack reads no Accounting table. The one thing a person types is the
**re-estimated total cost** per job per period — the input a monthly WIP
meeting exists to produce — and null means the budget stands, so a business
that never re-estimates types nothing.

**COST-TO-COST, CAPPED, AND A FINISHED JOB IS DONE.** `wip-math.ts` is pure
and `tests/jobs.test.ts` pins it: percent complete is cost over estimate in
parts per million, truncated, capped at 100%; earned is the contract at that
percent, rounded half up, through BigInt because a nine-figure contract times
a million passes 2^53; a job marked `complete` is 100% whatever its cost
says; under and over are two columns and never netted. A job with nothing to
divide by has a null percent and a badge, not a zero.

**WHICH JOBS ARE ON IT.** Every job of the company with a contract value, a
cost or a billing as of the date; never a cancelled one; a completed one
until its billings catch its value, then it drops off, because a schedule of
every job ever finished stops being readable within a year. A job with no
budget and no estimate BLOCKS the period by name (`ESTIMATE_REQUIRED`) — a
schedule missing a job is exactly what a bank would not accept, and posting
the rest quietly would be worse than refusing. A job with billings and no
fixed value blocks likewise (`BILLED_NO_VALUE`); one with no value and no
billings — a spec home accumulating cost — is shown and left out
(`reason = no_value`).

**THE ENTRY, AND WHY IT REVERSES ITSELF** (ADR 0059). One pair of lines per
job, tagged with the job: `Dr 1240 / Cr revenue` for a job billed behind its
work, `Dr revenue / Cr 2420` for one billed ahead, both accounts the
construction profile seeded for exactly this and both refused by name when a
chart lacks them. Dated the period end, source `wip_adjustment` (a new value
of `journal_entry_source`, drizzle/0339, in `MANAGED_SOURCES` so the journal
refuses to void it), and a second entry with the same source, negated,
`reverses_entry_id` set, dated the next day. Because every period's entry is
the whole figure and reverses, the books between period ends carry billings,
the month-end statements carry earned revenue, and — the reason that matters
to this pack — `billedByProject` read as of any later period end sees each
earlier adjustment and its reversal together and nets them to nothing, with
no filter on the source and no knowledge of its own earlier entries. The
idempotency key carries the period's version, so a period unposted and posted
again is a new pair rather than the voided one answering. Periods post
FORWARD ONLY (`NOT_FORWARD`) and only the latest unposts
(`NOT_LATEST_PERIOD`), the way a close is reopened latest-first.

**FROZEN AT POSTING, LIVE WHILE A DRAFT.** Six figures per line are written
down when the period posts — contract, estimate, cost, billed, percent,
earned — and the page reads those, not the ledger, for a posted period; a
bill dated inside the period that lands late changes the next period's
opening and never the schedule a bank was shown. Unposting voids both
entries through `voidEntry` (Accounting's refusals — a closed period, a
reconciled line — arrive in its own words), zeroes the frozen figures and
keeps the estimates. The same rule an issued pay application's totals follow.

**A WIP ADJUSTMENT IS NOT CASH.** `src/packs/jobs/basis-lens.ts` is the
pack's provider in `basis-lens/registry.ts`: under the cash basis every
`wip_adjustment` entry is dropped whole. The construction dossier's finding
that "percent complete is not a basis lens" stands — a lens may not INVENT the
adjustment, which is why the pack posts a real entry; it may say the entry
does not belong in a basis, which is what this does. One indexed read,
nothing on a tenant that never posted one.

**PER COMPANY, LIKE A CLOSE.** The period carries `entity_id` and is unique
per `(entity, period_end)`; a tenant with one company never sees the picker.
The ops tests give every test its own company for the same reason a
schedule is per company: every job the earlier tests made on the default one
would land on it, most with no budget, and block every post with a refusal
about somebody else's job.

Migrations `0339_job_wip.sql` (the enum value first, then the two tables,
hand-reordered like the five before it) and `0340_job_wip_rls.sql`, applied
to dev and prod before the merge; `db:verify-rls` reports **208 tables** on
both, `db:verify-modules` 19/19. Tests: eleven more pure (the indexes and
CHECKs mirrored, the enum value first in the file and used nowhere in it,
the two accounts seeded as an asset and a liability, and the arithmetic case
by case including the ten-figure contract), six more ops (the schedule with a
measured and an unmeasured job and an as-of date before the cost; posting
with both entries read back line by line and by dimension, the ledger's
revenue-by-job reading earned at the period end and billings the day after,
the frozen period against a live next one; the estimate replacing the budget
for one period and turning an under-billing into an over-billing; the five
refusals; unpost latest-only with the estimate kept and a re-post as a new
pair; the cash lens dropping the adjustment), four more isolation (read and
write across tenants, the company and project FKs, one period per company
per date and the posted↔entry CHECK, cascade from the period and from the
project). `ledger` and `discovery-prompt` re-run for the enum and the source
set.

**DRIVEN ON THE DEV BRANCH, on Hilltop Farm's 24-108.** The schedule as of
`2026-08-31` read the job at **$1,962,000.00** contract, **$45,000.00**
estimated cost, nothing spent and **nothing billed** — the September pay
application correctly outside an August period end — and *Billings equal
earned revenue on every measured job, so there is nothing to post*. As of
`2026-09-30`: billed **$370,900.00**, over-billed the same, and the red
line *The chart of accounts has no 2420 account. Add it in Accounting
first*, with the button disabled. `1240` and `2420` were added through
Accounting's own *Add account*. A cost was posted through Accounting's
journal — *Dr 5100 Subcontractor Expense $325,000.00* tagged `24-108 · Oak
Row residence — phase 2` / *Cr 2000 Accounts Payable*, dated 2026-09-20 —
and the schedule read **$325,000.00 · 100% · earned $1,962,000.00 ·
under-billed $1,591,100.00**: the whole job earned against a $45,000
budget, which is exactly what the re-estimate exists for. `1300000` typed in
the box → **budget $45,000.00** underneath, **25% · earned $490,500.00 ·
under-billed $119,600.00 · profit to date $165,500.00**, the period listed
as *Draft*. *Post the adjustment* → **Posted on 2026-09-14 · figures frozen
· the adjustment · its reversal on 2026-10-01**, the estimate box now a
plain *$1,300,000.00 re-estimated*. The adjustment in Accounting's journal:
*2026-09-30 · wip adjustment · Work in progress through 2026-09-30 —
Hilltop Farm · posted · Reversed by this entry*, two lines — **1240 Costs
in Excess of Billings 119,600.00** and **4000 Sales 119,600.00** (the farm
chart has no 4030, so the fallback posted), each tagged *24-108 · Oak Row
residence — phase 2* — and no *Void* button, because the source is managed.
*Unpost* → *Draft* again with the $1,300,000 estimate kept and the entry
panel back; *Post the adjustment* again → *Posted*, a new pair. Two things
driving showed: the estimate box saves on blur (Enter blurs it), and the
pane's `type` action never reached React's state, so the first attempt saved
nothing — `form_input` plus a click elsewhere did. Not driven: a
two-company tenant's picker (the farm has one company) and a closed period's
refusal.

### 2026-09-14 — Slice 7: the first slice somebody on a site touches (`claude/the-first-slice-on-a-site`)

`job_daily_logs` and `job_daily_log_crews`, a daily-log page per project
(`/dashboard/m/jobs/[id]/log`), two panels on the project page — **On site**
and **Punch list** — and the pack's first tell source. Everything the design
calls "field" and is not those two tables is a seam this pack already had:

- **A daily log is one row per project per day.** A superintendent keeps ONE
  report per job, and "poured the slab" said at nine and "framers started"
  said at two are two lines of the same day, not two days — so the unique
  index is `(project, date)` and `saveDailyLog` UPSERTS. `appendNotes` adds a
  line; `notes` replaces; `crews` replaces the lines the way a document's do;
  anything omitted is left alone. Removing a day takes its crews by cascade
  and DETACHES its photos, because the pictures may be the evidence.
- **Manpower is a headcount, not payroll.** A crew line is a trade or a
  subcontractor on file, how many, and hours each in tenths. It is who was on
  the site — the framer's crew as much as the company's own — and it is what
  an owner's representative reads and a delay claim is argued from. It is NOT
  a time entry: the `time` module records the company's own people to the
  minute for wages, and a subcontractor's crew never appears there. The two
  answer different questions and the guide says so.
- **Photos are Documents' rows**, hung on the DAY through
  `document_attachments` (`extension_slug = 'jobs'`, `entity_type =
  'job_daily_log'`) — the livestock pack's slice 4b pattern, exactly: the
  pack owns the actions (`attachLogPhotoAction` and its two siblings) and core
  owns the table; both gates (`jobs` and `documents`) and both write rules
  (`allowsWrite(member)` and the DMS's `roleMayWrite`), because the accountant
  clears the first and not the second; and `assertLog` is the compensating
  control for a polymorphic reference no foreign key polices. The gallery is
  the shared `RecordPhotos`.
- **The punch list is Work's rows**, linked to the PROJECT through
  `work_item_links` (`entity_type = 'project'`) via `createWorkForEntity` —
  never a second task engine (extension-model.md §4b). The panel adds and
  ticks; assigning, dating and chasing are the Work module's. `addPunchItem`
  and `setPunchDone` name the entity type, which is the one thing only the
  owning pack may do.
- **Everything here is a chore — `member`, not `owner`.** The person with the
  phone on the site is rarely the owner, and a daily log only an owner could
  write would be written by nobody. Same split livestock drew for a photo.

**THE TELL SOURCE.** `src/packs/jobs/tell/source.ts`, registered third in
`tell-sources/registry.ts` (a day on a site is said by everyone on it, every
day; a farm has `jobs` off and never sees it). Two actions, and they are not
the same kind of safe:

- `jobs.log` — *"poured the garage slab at Oak Row, four guys, six hours"* —
  appends a line to the day and, when the sentence carries a headcount or
  hours, a crew line (`"Crew"` when no trade is said: four guys with no other
  word is the company's own). READ BACK AND CONFIRMED (ADR 0050's default): a
  line on the wrong job is visible only to somebody who opens that other job,
  which fails the first of the three tests.
- `jobs.punch` — *"punch item at 24-108: garage door doesn't close"* — raises a
  work item linked to the project and RECORDS ITSELF, the way `work.add` does:
  on a list, one press to remove, moves nothing.

**Which job is SEARCHED, never listed** (ADR 0052): `tell/find.ts` is pure —
number first ("24-108" is the one thing a builder says exactly), then name,
then street, then a word in common, then everything open. Never edit distance:
"Lot 12" is one character from "Lot 13", and choosing on distance is how a day
gets logged on the wrong house. Only open projects are offered; a finished
job is not something anybody is standing on. Three sentences joined the
golden set, each with its `why`: a headcount that sounds like a timecard, a
punch item that sounds like `work.add`, and a delay that is a non-event.

Migrations `0337_job_field.sql` (hand-reordered like the four before it) and
`0338_job_field_rls.sql`, applied to dev and prod before the merge;
`db:verify-rls` reports **206 tables** on both. Tests: ten more pure (the
one-per-day index, the crew CHECKs, RESTRICT and cascade, the entity types,
hours to tenths, and the finder pinned case by case — Lot 12 is not Lot 13),
five more ops (upsert and append, crews replaced and added and refused, staff
allowed, delete, the punch item as a linked work item), five more isolation,
and a new db suite `tests/jobs-tell-source.test.ts` (nothing offered without
a job; the finished job not offered; two sentences land on one day with the
crew; the punch item in Work's own table). Every tell db suite re-run,
because adding a source changes what every tenant is offered.

**DRIVEN ON THE DEV BRANCH, on 24-108.** *Log today* → weather `Clear, 78°`,
two lines of report, one crew row *Concrete · 4 · 6.5* → *Log it*. The
**Daily log** page read **2026-09-14 · Clear, 78° · 4 on site · 26 man-hours**,
the two lines, the crew table *Concrete 4 6.5*, and the photo strip with
*Add a photo* and *No photos yet* — the shared gallery, on a day, with this
pack's gates. Back on the project page, *Touch up paint in the master bath* →
*Add* → **1 open** with the item and its checkbox; ticked → **Nothing open.**
The Work module's list no longer shows it, because it is done — the ops test
is what proves it was Work's row all along. The upload itself was not driven:
the browser pane cannot hand a page a file (open item).

**And the sentence.** The tell box on the project page, typed (the pane
blocks the microphone): *poured the garage slab at Oak Row, four guys, six
hours* → *Read it* → one card, **Logged on site · Jobs**, with *Which job* =
**Oak Row residence — phase 2 · 24-108 · Luxury custom · 118 Oak Row** (found
by the street), *What happened* = `Poured the garage slab.`, *How many* 4,
*Hours each* 6, *Which day* today — read back, not recorded. *Record 1 thing*
→ toast *Oak Row residence — phase 2: Poured the garage slab. — crew 4 × 6h*,
and the Daily log page read **Clear, 78° · 8 on site · 50 man-hours**, the
day's notes with the third line appended, and a second crew row *Crew 4 6*.
One sentence, the same day, no second report.

### 2026-09-14 — Slice 5: the schedule of values, and the draw against it (`claude/pay-applications`)

`job_sov_lines`, `job_pay_applications`, `job_pay_application_lines`, and the
first page in this pack that BILLS: one per contract
(`/dashboard/m/jobs/[id]/contracts/[contractId]`), with the schedule of
values above and the pay applications drawn against it below. The four
numbers the earlier slices built — worth, planned, ordered, spent — now have
the fifth that pays for them: **billed**.

**ONE MODEL FOR THE PILOT'S THREE BILLING METHODS.** Fixed price billed
monthly on progress, an AIA pay application, and a home's draw schedule are all
percent-or-milestone against a fixed sum: a schedule of values breaks the
contract into lines (one line for a monthly draw, a G703 for the AIA form,
milestones for the draw schedule) and each application says how much of each
line is complete to date. The G702 falls out — completed and stored to date,
less retainage, less previous certificates, is the **current payment due** —
in `billing-math.ts`, pure, so the form shows the same numbers the server
writes and `tests/jobs.test.ts` pins every one. Cost-plus, unit price and T&M
are different sums and are not here; the contract records them and nothing
bills them yet.

**AN ISSUED APPLICATION IS AN ORDINARY INVOICE
([ADR 0058](../decisions/0058-a-pay-application-is-an-ordinary-invoice.md)).**
`issuePayApplication` freezes the certificate and posts it through
Accounting's own verbs — `createInvoiceDraft` → `issueInvoice`, the path the
platform's own revenue takes — with two lines: the work earned this period to
contract revenue (`4030`, else `4000`), tagged with the project's cost object
so the job's revenue is on every report; and the retainage withheld this
period as a NEGATIVE line to `1230 Retainage Receivable`, the account the
construction profile seeded for exactly this. The entry is Dr AR (net) · Dr
Retainage Receivable (held) · Cr Revenue (gross). AR, aging, reminders,
payments and the cash lens see it with no second ledger, and the pack never
reads Accounting's tables to follow the link — `loadInvoice`, `voidInvoice`
and a new Accounting verb, `ensureCustomerForParty`, are the whole seam.

**RELEASING RETAINAGE IS NOT A SECOND FEATURE.** A later application at a
lower rate — the final one at 0% — computes less retainage to date than the
last certificate held, so the "withheld this period" is negative, the line to
`1230` is positive, and the invoice collects what was held. The ops test walks
a contract through three applications and the third releases the ten
thousand held by the first two with no code path of its own.

**WHAT IS FROZEN AND WHAT IS LIVE.** A draft's figures are computed from its
lines and the schedule as it is NOW, and a draft picks up schedule lines added
after it was started (an approved change order's). An issued application's
five totals and each line's scheduled value are written down at issue, so the
certificate a client signed reads the same whatever the schedule becomes —
the same rule an invoice's tax and a change order's price follow.

**THE RULES THAT REFUSE.** One draft per contract at a time (`ONE_DRAFT`) —
each carries the previous one's figures forward, and two open at once would
each claim to be next. Nothing due, nothing issued (`NOTHING_DUE`). Nobody on
the other side, nobody billed (`COUNTERPARTY_REQUIRED`). A chart with no
`1230` cannot withhold (`ACCOUNT_MISSING` names the code — a pack must not
create accounts in a business's chart). A schedule line an application has
billed against cannot be removed (`SOV_LINE_BILLED`; the RESTRICT is the
backstop) but its value can change, because every certificate froze the value
it saw. Only the LATEST issued application can be voided (`NOT_LAST`), and
Accounting refuses to void an invoice with payments on it — the pack hands
Accounting's refusals on in Accounting's own words, through `friendlyMessage`.

**`this period` MAY BE NEGATIVE.** An over-billing on an earlier application
is corrected on the next one, which is how the G703 has always worked; a line's
total to date may not go below zero, and that is a CHECK.

**THE PACK'S STATUS HAS NO `paid`.** Whether the client has paid is the
invoice's business, read from it when shown; a second copy would be the drift
every derived status in accounting exists to prevent.

Migrations `0335_job_billing.sql` (hand-reordered like 0329 and 0333) and
`0336_job_billing_rls.sql`, applied to dev and prod before the merge;
`db:verify-rls` reports **204 tables** on both. Tests: twelve more pure (the
CHECKs mirrored, the G702 arithmetic line by line, retainage rounded once, the
release, the negative period, percent boxes to ppm and back), nine more ops
(the schedule replaced whole and the billed line held, one draft at a time,
the invoice's lines, accounts, entry and dimensions, the carry-forward and the
release across three applications, the three refusals, void of the latest
only and the invoice with it, a draft picking up new lines, staff refused),
seven more isolation (read, write, cross-tenant contract, the issued-has-
invoice CHECK, RESTRICT on a billed line, per-contract numbering, cascade).

**DRIVEN ON THE DEV BRANCH, on 24-108's New Home contract.** *Set up the
schedule* → *One line for the whole contract* → the tiles read **Scheduled
$1,854,500.00** with the red *not on the schedule* note gone. *New
application* at 10% → *Open* → `370,900` this period → the G702 under the grid
read **$370,900.00 · −$37,090.00 · $333,810.00 · $0.00 · Current payment due
$333,810.00**, balance to finish $1,483,600.00. *Issue as invoice* was
refused twice, each time in the words designed for it: *Say who the contract
is with before billing it* (the contract had no counterparty — fixed from the
project page's edit dialog), then *The chart of accounts is missing something:
the chart has no 1230 Retainage Receivable account* — the farm fixture has
the general chart, not the construction profile's, so `1230` was added through
Accounting's own *Add account*. Third time: **Application 1 issued as an
invoice**; the row read *Issued · INV-0006 · Open* with a *Void* button, the
tiles **Billed to date $333,810.00 · Retainage held $37,090.00 · Balance to
finish $1,483,600.00**, the schedule line **20%**, and the project page's
contracts table *$333,810.00 / $37,090.00 held*. In Accounting, INV-0006 to
Tractor Supply Co, due in thirty days by the customer's terms, memo *Pay
application 1 · 24-108 · new_home*, two lines: *Application 1 — work
completed and stored through 2026-09-14* $370,900.00 to **4000 · Sales** (the
farm chart has no 4030, so the fallback was the one that posted) and
*Retainage withheld (10%)* (37,090.00) to **1230 · Retainage Receivable**,
total 333,810.00.

**One thing driving showed that the tests could not:** a refused issue leaves
the draft saved (the editor saves first, then issues), so the second attempt
starts from what was typed rather than from an empty grid. Worth keeping.

### 2026-09-14 — The profile arrives, and the pack takes its first seed (`claude/the-construction-profile`)

No screen changed. What changed is that every seam this pack left open now
has something on the other side of it: the `construction` profile
([construction.md](construction.md)) supplies `packConfig.jobs.deliveryMethods`
and `.contractKinds`, so the project and contract forms show a picker instead
of a free-text box for the first time outside a test; `customer` renders as
*Client*; and two starter cost code lists arrive with the profile.

**THE PACK OWNS ITS SEED.** `src/packs/jobs/seed-shape.ts` is the shape
(`CostCodeSetSeed`, parsed as tolerantly as `deliveryMethodsFrom` parses its
config) and `src/packs/jobs/seed.ts` the applier, registered in
`src/packs/seeds.ts` under this pack's slug
([ADR 0057](../decisions/0057-a-pack-registers-a-seed-applier-and-the-profile-carries-the-data.md)).
It writes through `createCostCodeSet` / `createCostCode`, so every seeded code
is a cost object; the first list a tenant ever gets becomes its default by the
pack's own rule; a list the tenant already has by that name is skipped WHOLE —
a business that pruned a starter list must not find the pruned codes back
after a re-install. Nothing about the profile is known here: the pack does not
import it, and a second industry's lists would arrive the same way.

### 2026-09-14 — Slice 4: original + approved changes = revised (`claude/original-plus-approved-changes`)

`job_change_orders` and `job_change_order_lines`, and the line every owner and
surety reads on every pay application — **original + approved changes =
revised** — computed on both halves of a job at once.

**A CHANGE ORDER BELONGS TO A CONTRACT, NOT A PROJECT.** It changes ONE
agreement: a custom home on its third of three contracts has a change order
against the New Home contract, not the concept-design agreement it grew out of,
and the pay application it appears on is that contract's. `project_id` is
reachable through the contract and deliberately not duplicated; `listChangeOrders`
joins through, and the join is the proof it does not need to be. Numbers are
unique per CONTRACT, so CO-1 on the drawings agreement and CO-1 on the build are
what they are on paper: two documents on two pay applications.

**PRICE ON THE HEADER, COST ON THE LINES, AND THEY ARE DIFFERENT NUMBERS.** A
change order has a price to the owner — `value_cents`, the revenue side — and
an estimated cost by cost code, the budget side. The price carries the markup;
a model that stored one and derived the other would be wrong on every job where
the markup is not flat, which is all of them. Zero lines is legitimate (a pure
price change); a zero price with lines is legitimate too (scope moved between
trades at no charge).

**REVISED IS COMPUTED, NEVER STORED.** `job_contracts.value_cents` stays the
original, `job_budget_lines.original_cents` was named for exactly this moment,
and revised is original plus the sum of APPROVED change orders, computed
wherever it is shown. A stored `revised_cents` would be a column that could
disagree with the rows it summarises, and nothing would be gained: the sum is
one indexed query. `projectValues` returns the revised value and the approved
changes beside it; `jobCostRows` returns `originalCents`, `changesCents` and
`budgetCents` (revised) per code. A code budgeted only by an approved change is
budgeted — it joins the report at the change, without the `Not budgeted` badge,
because that badge is for money ordered against a code nobody planned for and a
code the owner approved money onto has been planned for, late.

**WHEN A CHANGE COUNTS IS ONE PREDICATE, `countedChange`**: the change order is
approved AND the contract it changes is one whose value counts. An approved
change on a declined or cancelled contract is a change to nothing, and summing
it would grow a job the business never got. Both roll-ups in `ops.ts` and the
page's own in-memory sum read the same two exported constants, so three places
cannot hold three opinions about what "approved" means.

**THE FIRST MONEY IN THIS PACK THAT MAY BE NEGATIVE, ON PURPOSE.** Every other
amount carries a `>= 0` CHECK. A deductive change order — the owner drops the
pool — is `-18,500`, not a separate "credit" concept, and each cost line may go
either way. It has consequences one layer up: `formatMoney` drops the sign, so
every change-order figure and every revised total renders through
`formatMoneySign`, or a deduction prints as its own opposite.

**APPROVED NEEDS A DATE, BOTH WAYS, AND THE DATABASE SAYS SO.**
`job_change_orders_approved_has_date` is `(status = 'approved') = (approved_on
is not null)`. The date is the evidence; a status anybody can flip without one is
a status nobody has to justify. The action refuses an approved change with no
date (`APPROVAL_DATE_REQUIRED`) and CLEARS the date on anything else, because a
change taken back to proposed was not approved on that day after all and a form
should not have to know to blank the box. The form fills today into the box when
`Approved` is picked and the box is empty.

**A SIGNED CONTRACT'S VALUE IS LOCKED — AND THE BUDGET IS NOT.** Once an
agreement counts, its value is the ORIGINAL half of the line, and a value that
can still be edited in place makes the line meaningless; `updateContract` throws
`VALUE_LOCKED` and the form disables the box with `Signed. Change the value with
a change order.` A typo in a signed value is corrected by a change order, which
is what the business does on paper. The one exception is a signed contract whose
value was never recorded: filling it in once is entry, not revision. The budget
is NOT locked the same way, and the asymmetry is the point: a contract is an
agreement with another party, a budget is an internal plan, and the editor still
writes `original_cents` — it is handed the original, never the revised, or a
save would fold the approved changes into the original and count them twice.

### Four sentences that had never been said

`toResult` translated a duplicate job number, list name, code and order number
into a sentence by matching on `err.message`. **Not one of those translations
had ever fired.** Drizzle wraps the driver's error, so the message is `Failed
query: insert into …` — the SQL, never the constraint; the constraint is on
`err.cause`. A duplicate job number has said `Something went wrong. Try again.`
since slice 0. Found by the new suite asserting on the message and failing, which
is what the assertion is for; the time module had found the same thing on its own
tables and written `violatedUniqueIndex`, so that helper moved to
`src/lib/db-errors.ts` where a pack can reach it without importing another
module, and time re-exports it.

### Two holes found by driving it, both in the form

**An empty listbox.** The dev tenant's only cost code was retired (by slice 3's
own drive), so the line's `Cost code` dropdown opened on nothing and the form
said nothing about why — and a hidden blank row then failed the save with
`Every line on a change order needs a cost code.` An empty listbox is a form
lying about a choice it cannot offer. With no active codes the lines block is
now a sentence — *No active cost codes on this job's list, so the change cannot
be costed by code yet* — and the action is sent no lines at all, whatever a
hidden row might hold. The retired-code rule itself stands: a change order
offers active codes plus any it already names, the budget editor's rule one
table over.

**A sentinel with no item.** The first cut initialised a line's code to
`"__none__"` the way the commitment form does — but that form has a `No code`
item and this one deliberately does not, so Radix rendered neither the value
nor the placeholder and the trigger collapsed to a chevron. An empty string is
what shows a placeholder.

**Driven on the dev branch, on 24-108's New Home contract:** CO-1 *Add covered
porch*, price $12,500.00, approved today, no lines (no active code yet). The
contracts panel read **Worth $1,962,000.00 across 3 signed agreements,
including $12,500.00 in approved changes**, the New Home row **$1,854,500.00 /
orig. $1,842,000.00**, the job list **$1,962,000.00 / incl. $12,500.00 in
changes**. Then `03 30 00` un-retired on the cost-codes page and CO-1 edited to
carry one line, $5,000.00 against it: the job cost report read **Budget
$45,000.00 against $62,000.00 ordered, after $5,000.00 in approved changes**,
the row **$45,000.00 / orig. $40,000.00 · Left −$17,000.00**, and the change
order's Cost column $5,000.00. The edit dialog shows the contract as text with
*A change order stays on the agreement it was raised against*, and the New Home
contract's own edit dialog has its value box disabled with *Signed. Change the
value with a change order.*

### What was removed

`budgetTotals` shipped in slice 3 and nothing read it. Deleted, by the standard
this pack set for `PackDefinition.dimensionTypes` and `projectValues.openCount`:
a field nothing reads is worse than an honest absence. The job list still shows
worth only; planned, ordered and spent columns are a list-screen slice the day a
screen wants them.

Migration `0333_job_change_orders.sql` needed the same hand-reordering as 0325
and 0329 — two new tables referencing each other in one file — and
`0334_job_change_orders_rls.sql` is the pattern. Both applied to dev and prod
before the merge; `db:verify-rls` reports **201 tables** on both, and
`db:verify-modules` 19 of 19. Tests: nine more pure (the status CHECK mirrored,
the absent floor, the approval-date CHECK, no `project_id`, per-contract
numbering), thirteen more ops (approved-only counting, the deduction, a change
on a contract that does not count, the revised budget with its original kept,
the value lock and its exception, the date rule both ways, lines replaced and
an empty list as an instruction, per-contract numbering, staff refused, the
protected code), eight more isolation (read, write, cross-tenant contract and
code, the date CHECK, the negative, per-contract numbering, cascade).

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
| `job_budget_lines` | What each cost code was PLANNED to cost. | One line per code per project, enforced by a unique index rather than by the action remembering — two would make every variance ambiguous. `cost_code_id` is NOT NULL, unlike a commitment line's: a budget without a code is a single number for the whole job, which is what this table exists to stop being the answer. `original_cents` is the ORIGINAL; revised is original plus approved change-order lines, computed by `jobCostRows` and never stored. RESTRICT to the code, so a budgeted code is retired and never deleted. |
| `job_change_orders` | A change to ONE contract: its price to the client (`value_cents`), its status, and when it was approved. | Composite FK to the CONTRACT, **cascade** — never to the project, which is reachable through the contract and deliberately not duplicated. Number unique per `(tenant, contract)`. `value_cents` **may be negative** — the one money column in the pack without a floor; a deduction is a negative number, not a credit concept. `job_change_orders_approved_has_date` makes `(status = 'approved') = (approved_on is not null)` a database fact, both ways. |
| `job_change_order_lines` | What the change costs, one cost code at a time — the budget side. | Cascade from the change order; **RESTRICT to the cost code**, the same rule as a commitment line and a budget line. `amount_cents` may be negative. Zero lines is legitimate: a pure price change. |
| `job_sov_lines` | A contract's schedule of values: how the sum breaks down, by trade, phase or milestone. | Cascade from the contract. Optional cost code (RESTRICT) and the approved change order that added the line (cascade). `scheduled_cents` ≥ 0. Should sum to the revised contract value; the page says when it does not, a CHECK does not — a schedule is built before it is complete. |
| `job_pay_applications` | One draw against a contract: the G702. | Numbered per contract, void ones included. `status` draft/issued/void — **no `paid`**, that is the invoice's word. `retainage_ppm` 0–1,000,000. Five totals FROZEN at issue. `invoice_id` RESTRICT to Accounting's `invoices`; CHECK `(status = 'draft') = (invoice_id is null)`, both ways. |
| `job_daily_logs` | One report per project per day: weather, what happened. | Unique `(tenant, project, log_date)` — the whole design; `saveDailyLog` upserts and `appendNotes` adds a line. Cascade from the project. Photos hang on it through Documents' `document_attachments` (`entity_type = 'job_daily_log'`), detached when the day goes. |
| `job_daily_log_crews` | Who was on site that day: a trade or a subcontractor, how many, hours each (tenths). | Cascade from the day; `party_id` RESTRICT to `parties`. CHECK `workers >= 0`, `hours_tenths >= 0`, and that a line names a trade OR a party. A HEADCOUNT, not a time entry — the two are not joined. |
| *(punch list)* | What still needs fixing: Work's `work_items`, linked to the project. | No table of this pack's. `work_item_links` with `extension_slug = 'jobs'`, `entity_type = 'project'`, through `createWorkForEntity` — never a second task engine. |
| `job_wip_periods` | One work-in-progress schedule per COMPANY per period end: its status, and the adjustment and reversal it posted. | Unique `(tenant, entity, period_end)`. RESTRICT to the company and to both entries. CHECK `(status = 'posted') = (entry_id is not null)`, both ways, and a reversal needs its adjustment. `status` draft/posted. |
| `job_wip_lines` | One job on a schedule: the re-estimate typed for the period (`estimate_cents`, null = the budget) and six figures FROZEN at posting, zero while a draft. | Cascade from the period and from the project. `percent_complete_ppm` 0–1,000,000; `reason` is `''`, `no_value` or `no_estimate` — why the job was left out of the entry. Over/under is not stored: it is earned − billed. |
| `job_pay_application_lines` | One line of the G703 per schedule line. | Cascade from the application; **RESTRICT to the schedule line** — billed lines are never removed. `previous` and `stored` ≥ 0; `this_period` may be NEGATIVE (a correction); CHECK that the three sum to ≥ 0. `scheduled_cents` frozen at issue. |
| `job_commitments` | What the business has ORDERED: a purchase order or a subcontract. | `party_id` is NOT NULL — a commitment with nobody to pay is a budget line, not a commitment. `kind` is a CHECK list of two because the two diverge in behaviour later. Number unique per tenant: a vendor quotes it back on the invoice. Cascade from the project. |
| `job_commitment_lines` | The money, one cost code at a time. | Cascade from the commitment; **RESTRICT to the cost code**, which is the backstop for "codes are retired, never deleted". Amount non-negative — a credit is a change order. |
| `job_projects` | The spine. | FOUR composite FKs, each certified in `tests/isolation/jobs.test.ts`: company, division, client, cost code list. `delivery_method` is an open taxonomy (P1) with a **format check and no value check**, and is nullable. `metadata` is the P2 extension bag. |

Migrations `0325_jobs.sql` / `0326_jobs_rls.sql` (slice 0) and
`0327_job_contracts.sql` / `0328_job_contracts_rls.sql` (slice 1), each applied
to dev and prod before its merge, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
`0329_job_commitments.sql` / `0330_job_commitments_rls.sql` (slice 2) and
`0331_job_budget.sql` / `0332_job_budget_rls.sql` (slice 3) and
`0333_job_change_orders.sql` / `0334_job_change_orders_rls.sql` (slice 4,
hand-reordered like 0329) and `0335_job_billing.sql` / `0336_job_billing_rls.sql`
(slice 5, hand-reordered the same way) and `0337_job_field.sql` /
`0338_job_field_rls.sql` (slice 7, likewise) and `0339_job_wip.sql` /
`0340_job_wip_rls.sql` (slice 6, built after 7; likewise, and 0339 first adds
`wip_adjustment` to `journal_entry_source`, which nothing in the file uses)
follow the same rule —
and from slice 3 the pair is `db:verify-rls` **and `db:verify-modules`**, after
the pack shipped invisible for want of a catalogue row. `db:verify-rls` reports **208 tables**, all enabled, forced and with
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
- `src/packs/jobs/seed-shape.ts` + `seed.ts` — what a profile may seed into
  this pack (starter cost code lists) and the applier that writes it through
  the pack's own ops, registered in `src/packs/seeds.ts` (ADR 0057).
- `src/packs/jobs/components/change-order-form.tsx` — price and cost typed
  separately, negative allowed, `Approved` fills the date box.
- `src/packs/jobs/field-ops.ts` — the daily log, its crews, and the punch list
  as Work items; the one place that names `job_daily_log` and `project` as
  the entity types Layer 0 rows hang on.
- `src/packs/jobs/tell/source.ts` + `tell/find.ts` — what a site can say in
  one sentence (`jobs.log`, `jobs.punch`), and the pure search for which job.
- `src/packs/jobs/components/daily-log-form.tsx` + `punch-list.tsx`, and
  `src/app/dashboard/m/jobs/[id]/log/page.tsx` — the day, the crews, the
  photos (Documents' `RecordPhotos`) and the list.
- `src/packs/jobs/wip-ops.ts` — the work-in-progress schedule (live or frozen),
  the estimate, and the two verbs that move the ledger: `postWip` (the
  adjustment and its reversal through `postEntry`) and `unpostWip` (both
  through `voidEntry`). Reads Accounting only through `getBalances`.
- `src/packs/jobs/wip-math.ts` — percent complete, earned, under and over,
  pure and BigInt-safe; the page and the posting compute the same figures.
- `src/packs/jobs/basis-lens.ts` — the pack's provider in
  `src/lib/basis-lens/registry.ts`: a WIP adjustment does not exist under the
  cash basis.
- `src/app/dashboard/m/jobs/wip/page.tsx` +
  `src/packs/jobs/components/wip-controls.tsx` — the schedule, the estimate
  box, and the post and unpost buttons.
- `src/packs/jobs/billing-math.ts` — the G702 arithmetic, pure: the form and
  the server compute the same certificate from it.
- `src/packs/jobs/components/sov-editor.tsx` + `pay-application-editor.tsx` —
  the schedule and the G703 grid, with the totals live.
- `src/app/dashboard/m/jobs/[id]/contracts/[contractId]/page.tsx` — one
  contract's billing: schedule above, applications below, five tiles on top.
- `src/lib/db-errors.ts` — `violatedUniqueIndex`, the constraint name from
  `err.cause`. Every unique-index sentence in `actions.ts` goes through it,
  because matching on `err.message` never fired (slice 4 build log).

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
- **A change order belongs to a CONTRACT, and revised is computed, never
  stored.** `value_cents` and `original_cents` stay the originals; revised is
  original plus approved changes, summed where it is shown. One predicate,
  `countedChange` — approved AND the contract counts — is what every roll-up and
  the page share. See the slice 4 build log.
- **A signed contract's value is locked; a budget is not.** An agreement with
  another party moves by change order; an internal plan is edited. `VALUE_LOCKED`
  in `updateContract`, the box disabled in the form, and one exception: a signed
  contract with no value yet may be filled in once.
- **A change order is the only money here that may be negative**, so every
  figure it touches renders through `formatMoneySign`. `formatMoney` drops the
  sign and would print a deduction as its own opposite.
- **The field is a chore, and its two other halves are not this pack's rows.**
  Daily logs and crews are `member`-level; photos are Documents' attachments
  hung on the day and punch items are Work's items linked to the project, each
  through the Layer 0 seam every pack uses. A daily log's manpower is a
  headcount, never a time entry — the `time` module is wages, this is who was
  on the site.
- **`jobs.log` is read back; `jobs.punch` records itself.** ADR 0050's three
  tests, applied inside one source: a line on the wrong job is not visible on
  a screen this person already looks at; a punch item on a list is.
- **Work in progress is a snapshot and a self-reversing entry** —
  [ADR 0059](../decisions/0059-work-in-progress-is-a-snapshot-and-a-self-reversing-entry.md).
  Cost-to-cost, capped; the re-estimated total cost is the one human input;
  the adjustment is dated the period end and reversed the next day, so the
  ledger's own billings-by-job read needs no filter on the pack's source.
  Periods post forward only and unpost latest-first. Under the cash basis the
  entries are dropped whole by the pack's lens.
- **Left is the budget less the GREATER of ordered and spent**, never the
  sum: a subcontract's bill is its commitment arriving, and adding the two
  would count one dollar twice. `projectedCents` on the row is that maximum.
- **Actual per code comes from the ledger sliced to the job, never from a
  second group-by over every job.** `withinMemberId` on `getBalances`; the
  pack still reads no Accounting table.
- **A job that cannot be measured stops the whole period.** No budget and no
  estimate, or billings with no fixed value, refuses by job number rather than
  posting the rest. A schedule missing a job is what a bank would not accept.
- **A pay application is an ordinary invoice, and retainage is a negative
  line to a receivable** —
  [ADR 0058](../decisions/0058-a-pay-application-is-an-ordinary-invoice.md).
  The pack calls Accounting's document verbs and never its tables; lowering the
  rate releases retainage through the same line. The pack's status has no
  `paid`.
- **Frozen at issue, live while a draft.** An issued application's totals and
  line values are written down; a draft computes from the schedule as it is
  now and picks up lines added since. Same rule as an invoice's tax.
- **Read the constraint from `err.cause`, never `err.message`.** Under drizzle's
  wrapper the message is the SQL. `violatedUniqueIndex` in `src/lib/db-errors.ts`;
  four translations in this pack were dead for three slices before a test noticed.

## Open items

- ~~**No budget.**~~ — **closed 2026-09-14.** All four numbers exist: worth,
  planned, ordered, spent.
- ~~**Nothing revises a budget or a contract value.**~~ — **closed 2026-09-14.**
  An approved change order revises both, and a signed value can no longer be
  edited in place.
- ~~**ACTUAL COST IS PER PROJECT, NOT PER CODE.**~~ — **closed 2026-09-14.**
  `getBalances` took `withinMemberId` and the report has its `Spent` column;
  the uncoded remainder is said on the page. What is still open from it: a
  **bill line carrying a job and no code** is the common case on day one, and
  nothing yet nudges the person coding the bill toward the code — the setup
  source that says *"$3,000 on 24-108 has no cost code"* is the honest next
  step, and it is Accounting's screen it would speak from.
- ~~**Nothing bills.**~~ — **closed 2026-09-14** for fixed-price work: a
  schedule of values and pay applications, issued as invoices. Still open
  from it: **cost-plus, unit price and T&M** are recorded on the contract and
  billed by nothing (different sums, each its own slice); **retainage held
  FROM subcontractors** (the payables side; `2120` is seeded and nothing posts
  to it); **the AIA-style printout** of a certificate; and `billing_method` is
  still read by no code — the schedule does not yet shape itself to it.
- ~~**A contract cannot be edited from the screen.**~~ — **closed 2026-09-14.**
- **Nothing can be DELETED, and that is deliberate rather than missing.** A
  contract that should not exist is `cancelled` or `declined`; a cost code is
  retired; a project has no delete verb at all. The one real gap is a project
  created entirely by mistake, which today can only be `cancelled` — acceptable
  while a project is cheap to ignore, and worth revisiting if a business starts
  accumulating typos.
- **A contract's project cannot be changed, and neither can a change order's
  contract.** Moving an agreement between jobs, or a change between agreements,
  is a different and riskier act than editing it — the second would silently move
  money between two pay applications — and nobody has asked.
- ~~**Nothing edits a project yet.**~~ · ~~**A cost code cannot be renamed,
  reordered or retired from the UI.**~~ — **both closed 2026-09-14.** Every
  thing the pack creates can now be changed, and the version check that had
  existed unused since slice 0 is finally passed by the forms.
- **The founder has not clicked any of it.** Every slice from 2 on was driven
  in the browser on the dev branch by the builder, which is not the same thing.
  The construction profile does not exist yet either, so `deliveryMethodsFrom`
  has never returned a non-empty list outside a test.
- **The tell box's `jobs.log` is confirmed, not unattended — for now.** A line
  landing on the wrong job fails ADR 0050's first test today because nothing
  on a screen the person already looks at would show it. The day the
  project page (or the phone's home) shows "today on your jobs", the test
  passes and the four taps go.
- **Photos have been driven by no one.** The gallery is the shared component
  livestock and assets already use, wired with this pack's actions and gates;
  the upload itself needs a real file from a phone or a picker, which the
  browser pane cannot supply.
- **A suggested kind that is an acronym renders wrong.** `slugLabel("aia")` is
  *Aia*, and the construction profile's contract kinds carry `aia` because that
  is what every GC calls the form. The pack cannot know an acronym without
  knowing the industry; the fix is a per-kind label map in `packConfig`
  (`contractKindLabels`, read beside `contractKindsFrom`) the day a profile
  wants to spell one. Seen the first time a profile fed the picker, 2026-09-14.
- **`job_projects.number` is not generated.** Every business numbers its jobs its
  own way and the pilot's scheme is unknown, so the field is free text and the
  form suggests nothing. A generator is worth building only once a real scheme is
  in front of us.
- **The work in progress schedule measures fixed-value jobs only.** Cost-plus,
  unit-price and T&M contracts have no value to earn against; a job on one is
  shown with `No fixed contract value` and left out, and one with billings
  blocks the period. When those billing methods are built, the schedule needs
  a second method for them (revenue = cost + fee, or units × price).
- **Percent complete cannot be typed.** Cost-to-cost is the only method. A
  business that measures by units delivered or an engineer's estimate would
  need a second nullable column on the line (ADR 0059 leaves the door open);
  nobody has asked.
- **No schedule of completed contracts.** A finished job drops off once fully
  billed; the bank's other schedule — every contract completed in the year,
  with its final margin — is a different report and not built.
- **The reversal can be voided from the journal.** `wip_adjustment` is a
  managed source, so neither entry can be voided there; but a reversal posted
  with `reverses_entry_id` set is protected only by its own source, which is
  the same one, so it is covered — noted because the general guard
  (`assertEntryNotSourceManaged`) checks the entry's own source and not what it
  reverses, and a future source that reverses with `source = 'reversal'` would
  not be.
