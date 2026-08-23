# Production — build log archive

> The older half of [production.md](production.md)'s build log, swept here on
> 2026-08-23 when the dossier reached 1,658 lines and the log was 60% of it.
> `build-docs` walks the whole tree, so this renders at `/admin/docs` with no
> code change.
>
> **NOTHING HERE IS SUPERSEDED.** These are the entries for slices 0 through 1d,
> and the arguments in them are still the arguments — the two live weights, the
> condemnation adjustment, the withdrawal guard, the booking model, the
> migration that never ran. The dossier keeps the CURRENT half; this keeps the
> record. If you are about to change how a yield, a carcass or a booking works,
> the reasoning is here.

## Build log — slices 0 to 1d

### 2026-08-23 — Slice 1d driven on `Test`, and the meat already in the freezer (`claude/the-meat-already-in-the-freezer`)

All three parts render, and the one that had never been seen before is the
counter: **"Done here this year · Poultry — 100 of 1000 — 900 left of 1000 this
year."** That number is the whole three-party chain working — `livestock` said
the lot was poultry through the P5 slot, the profile said the cap was a thousand,
and `exemption-ops` multiplied them. Nothing is stored, so nothing can drift. No
badge appears at 10%, which is correct: the warning starts at 80%.

The finished run reads **Finished · Done here · Not inspected**, and *What came
out* now carries the sentence that governs it: *"No inspection. What may be done
with this is narrow and varies by state — typically direct to the person eating
it, in state, with no resale."* It states the shape of the restriction and
asserts no state's specifics, which is the line the design draws.

**AND DRIVING IT FOUND A HALF-STAMPED STATE, which is the dangerous shape.**
0190 backfilled the RUN's inspection but not the lots': every lot that landed
before this slice shipped had `metadata = {}`, while every lot landing after it
carries the eligibility. A reader finding the key on newer lots and nothing on
older ones has to guess what an absent key means, and the two available guesses
are "inspected" and "not inspected" — one of which is the enterprise-ending
answer. `retail`'s guardrail is the next consumer of exactly this key.

`0191` backfills them from the run's own inspection, and is idempotent by
`NOT (metadata ? 'production')` — re-running changes nothing, and it can never
overwrite a stamp the application wrote. It is filling a gap, not claiming
authority over lots that already have an answer. Both databases verified: every
landed output lot now reads `{"inspection":"uninspected","runId":"…"}`.

**Still unexercised:** a run that was actually SENT OUT. Everything driven so far
is on-farm, so `Sent out · <plant>`, an inspection inherited from a processor
rather than defaulted, and the exemption counter correctly *not* counting a
sent-out run have all been tested but never seen.

### 2026-08-23 — Slice 1d: which path the meat took (`claude/which-path-the-meat-took`)

**THE PATH IS A NULLABLE FOREIGN KEY, AND THAT IS THE WHOLE MODEL.**
`production_runs.processor_id` names the plant, or is null because this farm did
it itself. The design put the path on the run and said why in one line: *"The
same batch of birds may be processed on-farm uninspected or sent out to a
butcher, decided at booking. Modelling the path on the animal or the species is
wrong."* Null is not missing data here — it is the other half of the choice, and
`pathOf()` derives the answer rather than a second column disagreeing with the
first.

**INSPECTION IS STAMPED WHEN THE MEAT LANDS, and it is the second derived thing
in this table that is stored.** `cost_basis` was the first, for the same reason.
A plant's status can be corrected, lapse or be upgraded, and re-deriving this
later would silently change what a box already in somebody's freezer may legally
be sold as. **What was true on the day is what governs the meat**, so it is
written down on the day. A run with no processor stamps `uninspected`: the farm
did it, and nothing inspected it.

**THE LOT INHERITS IT**, into `inventory_lots.metadata` — the P2 bag, not a
column, because `inventory` must not learn what an inspection is. That is the
line the design calls existential: *"`retail` should refuse to list a lot into a
channel that is not legal for it. Selling uninspected product through the wrong
channel can end a poultry enterprise, and nothing on the market prevents it."*
**`retail`'s refusal is the next consumer and is NOT built** — what exists now is
the fact travelling with the meat, and a sentence beside the boxes saying what it
means.

**THE EXEMPTION COUNTER IS THREE PARTIES WHO EACH KNOW ONE THING.** The design
says the pilot *"sits at exactly 1,000 birds — i.e. already managed to a line"*,
and that recording runs yields the count for free. It does:

- **`livestock` says which species is in a lot**, through a new `kinds()` method
  on the P5 slot. It is not told why it was asked.
- **the profile says which kinds carry a cap** — `packConfig.production.exemptions`,
  `[{ kind: "poultry", annualHead: 1000 }]`. Only poultry is listed, deliberately:
  there is no equivalent head-count exemption for beef or pork, and inventing one
  would be worse than omitting it.
- **`exemption-ops.ts` multiplies them.** Nothing is stored, so nothing can
  drift, and a tenant with no livestock has no handler claiming a lot — the whole
  feature is silently inert, which is correct for a bakery.

Four counting choices, each of which could have gone the other way, are argued in
that file's header: **inputs not outputs** (the limit is on birds, not packages),
**complete runs only**, **`processor_id IS NULL`**, and **`started_on` not
`completed_on`** (a run finished in January over December's birds belongs to
December). It warns at **80%**, and that number is a lead time rather than a round
one: a processor books six to twelve months ahead, so being told at 999 is being
told far too late to send the next batch out instead.

**THREE THINGS THE MIGRATION NEEDED BY HAND**, all worth knowing before the next
one:

- **`drizzle-kit` wanted to DROP and re-ADD four unrelated constraints** on
  `audit_log`, `interview_sessions`, `schedule_items` and `work_items` — snapshot
  churn, not a change. Checked against production with `pg_get_constraintdef`:
  all four already had exactly the definition it wanted to re-add. Dropping three
  other modules' foreign keys inside a production-pack migration is risk with no
  upside, so they were stripped.
- **A backfill had to run before the CHECK.**
  `production_runs_finished_states_inspection` says a complete run must say how
  it was inspected, and every run that completed before this migration says
  nothing — so the migration fails on every database that has one. `uninspected`
  is truthful for all of them: none had a processor, because there was no column
  to name one in.
- **`ON DELETE` was left off `production_runs_processor_fk` on purpose**, so it
  is NO ACTION: a plant that has processed your animals cannot be deleted out
  from under the record. `SET NULL` was not available anyway — composite FK, same
  trap as 1c.

**And a bug in two other modules fell out of reading that churn.**
`schedule_items_parent_fk` and `work_items_parent_fk` are composite FKs declared
`ON DELETE SET NULL`, which is the exact shape that cannot work. Verified on the
dev branch inside a rolled-back transaction: deleting a parent schedule item that
has a child fails with *"null value in column tenant_id violates not-null
constraint"*. Live on production, out of scope here, and raised as its own task.

### 2026-08-23 — Slice 1c driven on `Test`, and two things reading it out loud found (`claude/booked-for-in-18-days`)

Two dates booked by hand on the live site, chosen so the slice's own claim could
be tested rather than described: **one ahead** (Miller's, 20 cattle, 2026-09-10,
$200 down, confirmed) and **one already in the past** (Valley, 180 birds,
2026-08-18, no deposit).

**THE WHOLE ARGUMENT HELD.** The past date landed in **Nothing recorded**, above
everything else, with *Start the batch* beside it. Starting the batch moved it to
**Done with**, the badge became *Went ahead*, the actions collapsed to *Open the
batch* — no Edit, no Remove, because a date that became a processing day is no
longer editable — and the section vanished. Self-clearing, without a status
anybody set.

**AND IT REACHED `What needs you`**, which is the first time a PACK has put a
line there: *"Miller's Custom Meats is booked in 18 days · 20 head cattle ·
Soon"*, with *Email me this each morning* switched on. The missed one was gone
from that list too, in the same act that cleared it from the page.

**The capacity warning behaved as designed**: 20 head against Miller's stated 8 a
day produced *"They told you 8 a day, and this is 20… so nothing is stopping
you"*, and **Book it stayed enabled**. Advisory, not a refusal. It also carries
into the list as *"Cattle · they said 8 a day"*. Kinds in the form were correctly
scoped to what each plant actually takes — Miller's offered only Cattle, Valley
only Poultry — and an unpaid deposit rendered as an em dash, never `$0.00`.

**TWO DEFECTS, BOTH ONLY VISIBLE BY READING THE SCREEN:**

- **"Miller's Custom Meats is booked FOR in 18 days."** `describeBookingDate`
  returns a phrase that already carries its own preposition ("in 18 days", "5
  days ago") or none at all ("today", "tomorrow"), so anything placed in front of
  it has to work with all four. "is booked" does; "is booked for" does not. The
  missed variant read "was booked for 5 days ago" for the same reason.
- **Starting a batch defaulted its date to TODAY.** On the one screen whose
  entire purpose is catching up with a date that already went by — it put 23
  August on a kill that happened on the 18th. It defaults to the booked day now.

Neither is a logic error and both survived tsc, eslint, 63 pure tests and 38
isolation tests. They are the class the dossier keeps recording: **the defects
that only exist in the sentence a person reads.**

### 2026-08-23 — Slice 1c: the date you cannot lose (`claude/the-date-you-cannot-lose`)

**THE SCARCE RESOURCE FINALLY HAS A ROW.** The design has said since 2026-08-13
that slaughter dates are it, that plants book six to twelve months ahead with
deposits involved, that losing a date is expensive, and that booking one is *"a
first-class feature, not a date column on an animal"*. `production_bookings` is
that feature. A column on a pen could not hold a deposit, could not survive the
pen being split across two dates, and could not exist before the animals do —
which is exactly when the date has to be booked.

**A BOOKING IS A PLAN; A RUN IS THE FACT — and that split is the whole design.**
`run_id` is what the booking became, null until the day happens, and there is
deliberately **no `delivered` or `completed` status**. A status somebody must
remember to advance is a second answer to a question `run_id` already answers,
and the two would disagree within a season. What the split buys is the item this
slice exists for, and it is derived rather than stored:

> **a date that has passed with no run recorded against it and no cancellation.**

Either the animals went and nobody wrote it down — so the yield, the cost and
the traceability chain for that kill are all missing — or the date was lost.
Nothing has to remember to flag it, and it clears two ways, both of which are the
correct thing to do: record what happened, or cancel the booking. That is exactly
the self-clearing shape [notifications.md](notifications.md) requires.

**THE FIRST ATTENTION SOURCE THAT IS A PACK.** `src/packs/production/attention/source.ts`
puts those rows in the morning digest and on *What needs you*, which is what
makes the bookings page something nobody has to remember to open. Three notes on
it:

- **It goes to everybody, and that costs something.** A booking has no assignee
  and inventing one would be a column nobody fills — a processing day is two or
  three people and the design says so. So a three-person farm gets the line three
  times. Accepted, because the failure in the other direction is a kill date
  nobody was told about, and because it disappears for all three the moment any
  one of them acts.
- **The horizon is 21 days, three times Work's seven.** A livestock number, not a
  software one: animals at weight, a trailer, and a withdrawal that has cleared —
  the last of which cannot be fixed in the final week.
- **No rule in `eslint.config.mjs` changed.** Its module-isolation patterns are
  generated from `MODULE_SLUGS`, which covers `src/modules/**` only, and the
  registry is the documented composition root whose job is naming concrete
  implementations. The source still imports `types.ts` and nothing else.

**`startRunFromBooking` IS WHAT MAKES A PROCESSOR MEASURABLE AT ALL.** Slice 1b
could record what a plant charges and what the farm thinks of it, but could not
compute one measured figure, because nothing joined a run to a plant. Booking →
run is that join. It is **not** total yet — it covers runs that came from a
booking — and slice 1d, which puts the processing path on the run itself, is what
finishes it. Any screen showing a measured comparison before then has to say
which runs it covered. The run starts EMPTY on purpose: a booking made in March
cannot know which pen will be ready in October, and carrying the promised head
over as a real input would be this pack inventing a movement nobody made.

**THE CAPACITY WARNING IS A SENTENCE, NEVER A REFUSAL.** Promising twenty hogs to
a plant that said eight a day is often correct — two days, a stale figure, or an
exception they agreed to. This app has no standing to overrule a farm about what
another business agreed to, so it says the two numbers disagree. Same call `land`
makes between declared and measured acreage.

**AND A COMPOSITE-FK GOTCHA WORTH CARRYING, caught by a test that was written to
prove the opposite.** `production_bookings_run_fk` was first declared
`ON DELETE SET NULL`, on the elegant argument that a booking should outlive the
run it became because it records a date held and a deposit paid. It does not
work: **on a COMPOSITE foreign key, `SET NULL` nulls *every* referencing column,
`tenant_id` included, and that column is `NOT NULL`** — so the delete fails
outright rather than clearing the link. (PG 15 added `SET NULL (run_id)`;
drizzle's `onDelete` takes an action, not a column list.) It is CASCADE now, and
that is also the *right* answer rather than merely the working one: **nothing in
this app deletes a run**, so the elegant argument was defending a state nothing
can reach — the same mistake this pack removed a guard for once already.

### 2026-08-23 — Slice 1b driven on `Test`, and the word the note forgot (`claude/the-word-the-note-forgot`)

Two butchers stood up by hand on the live site, chosen to be the comparison the
design says a farm actually makes:

| | Miller's Custom Meats | Valley Poultry Processing |
| --- | --- | --- |
| Inspection | USDA, EST 4712 | Custom exempt |
| Takes | Cattle, 8/day | Poultry, 400/day |
| Kill fee | $105.00 a head | $4.50 a head |
| Cut and wrap | $0.90 a lb | *not quoted* |
| Label | Yours | Not established |
| Books ahead | 300 days | — |

**"Some do only poultry" is now a row rather than a sentence**, which was the
whole argument for putting `handles` in its own table.

**ONE DEFECT, AND IT IS THE EXACT MISTAKE THIS SLICE ARGUES AGAINST.** The note
under the inspection field read *"Nobody has recorded how this **processor** is
inspected"* — on a screen headed **Butcher directory**, under a button saying
*Add a butcher*, beside a caveat that already said "butcher". Every other string
resolves through `labelFor`; this one had the pack's default baked into it, in
the one paragraph a person actually reads. A pack that declares a renameable
word and then hardcodes it there has not really made it renameable.
`inspectionNote(status, word)` now substitutes `{word}`, and the test asserts
that **no** rendered note contains "processor" when the tenant's word is
something else — which catches the next one written the same way.

**Everything else held.** The upsert corrected rather than duplicated: editing
Miller's cattle fee from $95 to $105 left one row, and the audit log shows it as
two `handle_set` entries on the same `handleId` — 9500 then 10500. That is the
column earning its place: *when did the quote change* is answerable, and the
prose (`good_at`, `price_notes`) is correctly absent from the meta. An unquoted
fee rendered **"Cut and wrap not quoted"** and never `$0.00`. `Cattle` came
pre-selected from the profile's `processorHandles`, and the kind was locked on
edit.

**Worth knowing, not yet fixed:** the *Only for* dropdown on a cut offers every
kind in the profile, not just the ones this processor takes — so "Dry-cured
bacon · Swine only" now sits on a butcher whose only handle is cattle, and
nothing flags it. Arguably right (you can learn what they make before recording
what they take) and arguably a record that contradicts itself. Left as it is
because the honest fix is a warning rather than a refusal, and there is nothing
yet reading these rows that would be misled.

### 2026-08-23 — Slice 1b: the processor directory, and the roadmap gap it closed (`claude/the-processor-and-the-date`)

**THE DESIGN CALLED BOOKING A DATE "THE LOUDEST UNMET NEED IN SMALL LIVESTOCK
PRODUCTION" AND THE ROADMAP HAD NO SLICE FOR IT.** Processors appeared once, at
slice 5, as a *report* — "processor comparison, throughput analysis, needs
history". Nothing created the processor record and nothing held a date. That is
the gap this slice starts closing; 1c is the dates themselves.

**A PROCESSOR IS A ROLE ON A PARTY, WHICH THE DESIGN HAD ALREADY SETTLED** —
*"the party spine already holds it, no new contact model."* So
`production_processors.party_id` points at `parties`, the same spine `customers`
and `vendors` hang off, and the plant that both processes your animals and
invoices you is one party with two role rows.

**AND THE NAME IS NOT IN THIS TABLE.** `customers` and `vendors` each still
carry their own `name` beside the party's — `role-sync.ts` calls that the "both
exist" stage of an expand/deploy/contract nobody has finished — and there was no
reason to open a third copy of that problem. A rename here updates the party and
nothing else, so this table cannot disagree with the rest of the app.

**THREE TABLES, AND THE SPLIT IS WHAT MAKES "SOME DO ONLY POULTRY" A QUERY.**
A plant that kills birds and a plant that kills everything differ by how many
`production_processor_handles` rows they have, not by a column. Price lives on
that row too, per kind, because that is how plants quote: a kill fee per head and
cut-and-wrap per pound, both different for a beef than for a hog. A single price
on the processor would have to pick one animal and be wrong about the rest.

**INSPECTION IS NOT A BADGE AND IT IS NOT A BOOLEAN.** Five values, and the fifth
is the one that matters: `unknown` is a real answer. A farm that has not asked is
not a farm that has been told no, and a boolean would turn the second into the
first on the very screen a legal question gets answered from. `custom_exempt` is
its own value rather than a flavour of uninspected, because it is inspected for
the owner and may not be resold — precisely the distinction
[`retail`'s channel guardrail](retail.md) will have to make. Each status carries
a sentence describing the SHAPE of its restriction and asserts no state's
specifics, which vary and are not this app's to declare.

**THE RATING IS SPLIT IN TWO ON PURPOSE, AND ONLY HALF OF IT EXISTS YET.**
`rating` and `good_at` are somebody's opinion, stored as one, and they are the
only assessment that works on day one. What the app can COMPUTE — dressing
percentage, condemnation rate, turnaround — is a ratio over runs and is therefore
never stored, by the rule that keeps a yield out of every other table here. **The
computed half is not merely unbuilt, it is not yet possible**: nothing says WHICH
processor did a given run, because that link arrives with the booking. The screen
says so in words rather than showing an empty chart, since a chart with no data
reads as "no difference" instead of "not asked". The design's own caveat applies
when it does arrive — yield varies by animal as well as by plant, so a computed
figure is evidence about a processor, never a verdict on one.

**TWO THINGS THIS SLICE CAUGHT THAT WERE NOT ABOUT PROCESSORS AT ALL:**

- **`drizzle-kit` generates an unrunnable migration whenever a new table
  references another NEW table on `(tenant_id, id)`.** It emits every CREATE
  TABLE, then every FOREIGN KEY, then every index — so the composite FK is added
  before the unique index that makes those columns referenceable, and Postgres
  refuses with *"there is no unique constraint matching given keys for referenced
  table"*. `0186` was hand-reordered. Slice 1a asked itself this question and the
  answer was no, because both of ITS targets already existed; this is the first
  time in the pack that the answer was yes. `scripts/dry-run-migration.ts` is new
  and is how it was found — it applies migration files in a transaction and rolls
  back, so a broken file is a message rather than a half-migrated database.
- **`toResult` moved out of `actions.ts` into `action-errors.ts`.** A
  `"use server"` module may export nothing but async functions, so the moment a
  second actions file needed that mapping the choice was a shared module or a
  second copy — and two copies of the mapping from error codes to sentences is
  how two screens start describing the same refusal differently. Its `FORBIDDEN`
  message is now "Only an owner can change this", where it used to name starting
  and finishing a run; it serves both files.

Writes are OWNER here, and the contrast with slice 1a is deliberate: transcribing
a kill sheet is a chore, but recording what a plant charges and what you think of
it is a decision. Every write is audited, and the prose never is — `good_at`,
`notes`, `labelling_notes` and `price_notes` stay in the row, the same rule the
condemn reason follows.

### 2026-08-23 — Slice 1a driven on `Test`, and for once it found nothing (`claude/driven-on-test`)

**THE FIRST KILL SHEET ANYBODY HAS EVER TRANSCRIBED IN THIS APP**, entered by
hand on the live site against the finished Butchering run (BATCH-2, 100 head in,
618.0 lb on the trailer, 468.0 lb packaged). Three lines, deliberately chosen to
walk the sheet from useless to answerable:

| Line | Head | Live (plant) | Hanging | Outcome |
| --- | --- | --- | --- | --- |
| 1 | 60 | 368.0 lb | 292.0 lb | Passed |
| 2 | 37 | 226.5 lb | 180.0 lb | Passed |
| 3 | 3 | 18.5 lb | — | Condemned · Airsacculitis |

**The refusal held at both incomplete stages, which is the behaviour worth
having.** At 60 head the page said *"40 of the 100 that went in are not on it
yet"* and both ratios read `—`; at 97 it said *"3 … not on it yet"* and still
refused. Only at 100 — *"matches the 100 that went in"* — did it answer. A
cutting yield computed at line one would have read about 160% and looked like a
triumph.

**Both ratios came out exactly where the arithmetic says**, over the passed
animals only: dressing **79.4%** (472.0 hanging / 594.5 live) and cutting
**99.2%** (468.0 packaged / 472.0 hanging). The condemned bird is out of both
sides rather than averaged out of one.

**The headline did not move, and that is the decision working.** Yield stayed
75.7% over the full 618.0 lb and grew the line *"3 of 100 head condemned (3.0%),
and they are still in the pounds that went in. This number is meant to read low
when that happens."* The loss stays visible in the number a person actually
looks at.

Everything else behaved: the condemned form dropped the hanging-weight field
entirely and offered an optional cause; causes grouped into *"Why they were
condemned — Airsacculitis · 3 head"*; the `Condemned` column appeared on the run
list only once a sheet existed, having been correctly absent while none did; and
a FINISHED run accepted the sheet without complaint, which is the one write a
complete run is meant to allow.

**Checked behind the screen too.** Three `production.carcass.recorded` audit
rows carrying `carcassId`, `runInputId`, `headCount` and `disposition` — and
**not** the cause, which is free text off somebody else's paperwork and stays in
the row. In the table, the condemned line holds `hanging_lb = NULL` and the
passed lines hold an empty `condemn_reason`, so both CHECK constraints are doing
their job rather than being enforced only in TypeScript.

**No defect was found, which breaks a run of five slices in six.** Worth stating
plainly rather than quietly: it is one sheet on one run, and the paths below are
still untouched.

### 2026-08-23 — The migration that never ran, and the re-land (`claude/the-migration-that-never-ran`)

**SLICE 1a TOOK THIS PACK'S PAGE DOWN FOR FIVE HOURS, AND THE CODE WAS NEVER THE
PROBLEM.** #251 merged at 03:24 UTC and auto-deployed. Nothing in the deploy path
runs migrations — `build` is `next build`, `prebuild` copies the map worker,
`vercel.json` is crons — so `production_run_carcasses` was queried by live code
before it existed anywhere. #252 reverted at 08:16 and the page came back.

**The blast radius was the whole module, not the new screen**, and that is worth
knowing before adding the next read here. `ProductionModule` calls
`listRunCarcasses` for every run in its summary loop, to decide whether the sheet
column has earned its width. A read that exists to keep a column honest is still
a read on every page load, so a missing table erased the run list rather than one
detail page.

**Two diagnoses in the revert were wrong, and re-landing meant disproving them
rather than working around them.** Both are recorded because each would have sent
the next session somewhere expensive:

| Claim | What production actually says |
| --- | --- |
| `app_user` has no `SELECT` on the new table, because `ALTER DEFAULT PRIVILEGES` only covers tables created by the role that set it | True in general, irrelevant here. `db:create-role` and `db:migrate` both connect as `DATABASE_URL_OWNER` — the same `neondb_owner` — which is the case where default privileges **do** apply. `pg_default_acl` holds `app_user=arwd/neondb_owner`, and **no** table in `public` is unreadable by `app_user`. |
| Running the migration by hand did not fix it, so a second cause is underneath | The table existed on neither database. The migration had not run anywhere, so nothing was tested by "running it by hand". Replaying `0184` and `0185` against production inside a transaction and rolling back applied both cleanly. There is no second cause. |
| `0184` may have reached production, leaving an orphan table to `DROP` before re-applying | It did not. `to_regclass` returned null. There was no orphan, and dropping on that advice would have been a destructive act taken on a guess. |

**The re-land is the same code, certified in the opposite order.** Migrations were
applied to the dev branch and then to production **before** the merge; the table
was verified in `pg_class`/`pg_policies` on both (RLS enabled *and* forced, both
policies, six CHECKs, three FKs, `app_user` holding SELECT and INSERT with no
manual grant); then the isolation suite ran — 429 tests, 25 files. That run is the
one that means something, because the dev branch created this table by migration
**long after** `app_user` existed. The from-zero ordering CI uses grants
`app_user` after the schema is built and structurally cannot see a grant skew;
this ordering can, and there was none.

The rule this leaves behind is [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md),
and a `migrations` job in CI that refuses a PR adding a `drizzle/*.sql` without
the `full-tests` label. **The guard checks a label, not a database** — it makes
forgetting loud, it does not make it impossible, and the pipeline change that
would is still open.

The lesson is not about this pack. **A green suite certifies the code, not the
deploy.** Everything passed on #251, honestly, and it was reported as though it
meant the change was safe to ship.

### 2026-08-23 — Slice 1a: the carcass stage, and where a condemnation finally goes (`claude/homestead-farm-modulas-elewgg`)

**ONE HONEST RATIO BECAME TWO, and the pack stopped owing the design an
explanation.** Slice 0 could say packaged over live and said no more, on purpose:
telling **dressing percentage** (live → hanging) from **cutting yield** (hanging
→ packaged) needs the carcass recorded as a stage of its own, and the design
names those two as the ratios a butcher actually argues about. `production_run_carcasses`
is that stage. Both ratios are folded in `core/carcass.ts` and stored nowhere,
which is the rule this pack was built on.

**CONDEMNATIONS WERE DEFERRED FOR AN ARITHMETIC REASON, AND THE ARITHMETIC IS
WHAT SETTLED THEM.** Slice 0's note is worth re-reading, because the fix is
exactly the shape it predicted: a `condemned_head` column would have made the
head reconcile while leaving the condemned animal's live weight in the
denominator, and *nothing short of per-animal weights can take it out*. So
`live_lb` sits on the carcass row, and there is exactly ONE honest adjustment —

> **Sum only the animals that PASSED, on both sides of the ratio.**

The condemned animals are then in neither number, nothing is averaged, and no
correction is applied to anything. It works only when the plant weighed the
carcasses. When it did not, the app **declines to adjust and says so**:
`includesCondemned` is true, the denominator is the farm's own trailer weight
with everything that left the yard in it, and the screen names the gap. A real
condemnation reading as a bad kill forever is the failure that flag exists to
prevent.

**TWO LIVE WEIGHTS ARE ALLOWED TO DISAGREE, AND THEY ARE NEVER SUMMED.** The
input's `weight_lb` is what left the farm; the carcass's `live_lb` is what the
plant's scale said hours later, and shrink makes them differ by 3–5% for a real
reason the design already recorded. The fold **chooses** — the plant's when it
covers every passed carcass, the farm's otherwise — and prints which. That is
`land`'s declared-versus-measured acreage rule generalised off geometry: report
both, prefer the one that answers the question, never overwrite.

**THE NEW REFUSAL IS THE ONE THAT WOULD HAVE READ OVER 100%.** Sixty birds
transcribed off a sheet of a hundred puts all the boxes over some of the
carcasses, and `SHEET_INCOMPLETE` catches it. The sheet reconciles against
`head_in` read off the input's own ledger row — not a number retyped — and the
count comes through the count dimension's base, so five dozen is sixty rather
than five. Ten refusals now, each with a sentence.

**A FINISHED RUN ACCEPTS A KILL SHEET, and it is the first thing on this pack
that does.** Everything else refuses once the cost has landed, because everything
else stamped something. A carcass row stamps nothing — no quantity, no cost, no
movement — and the design is explicit that the sheet *arrives days after the run,
from a party who is not this farm*. A sheet enterable only before the boxes
landed would be a sheet nobody ever entered. So it follows `livestock_weights`
rather than `production_run_outputs`: corrected in place, because a number typed
wrong never happened. An ops test asserts the landed cost is byte-identical
before and after.

**ONE LINE IS ONE DISPOSITION**, which is what keeps `hanging_lb` meaning one
thing. "100 birds, 3 condemned" is two rows, not one with a count on it, and a
condemned line carries no hanging weight — CHECKed in the database and refused in
words by ops. A partial condemnation is deliberately NOT a third state: the
carcass passed, and the bruised quarter that never came off it is a byproduct
that failed to materialise, which is slice 3's business.

**THE CAUSES ARE OPTIONAL AND THE UNSTATED ONES ARE COUNTED.** `inventory` made
an adjustment's reason required because the reason is the diagnostic and the farm
is the one who knows it; here the farm is reading somebody else's paperwork,
which can be smudged, abbreviated or silent. Refusing to record the FACT of a
condemnation until somebody supplies a cause would trade a real number for an
invented one — `livestock`'s *an unknown is not a zero*, a second time. They
group under an empty key rather than being dropped, so the causes always add up
to the count beside them.

- **The overall yield's denominator did not move, and that is the whole point.**
  Slice 0 chose to state it plainly as everything that went in so a condemnation
  reads as a visibly low yield rather than a normal one with a hidden correction.
  What was missing was the explanation. The sheet is the explanation; the number
  stays exactly where it was and gains a sentence beside it.
- **The condemnation column is on the LIST, and only once a sheet exists.** A
  cause repeating across runs is the finding the design asks for — *the variance
  across batches is the learning* — and a per-run page can never show it. A
  tenant whose runs are bakes never sees the column.
- **A run with no sheet reads "—", never "0".** Zero would say the plant passed
  everything.
- Migration `0184` needed **no hand-reordering** — ninth check, and this time the
  answer was no. Both composite-FK targets (`production_runs`,
  `production_run_inputs`) were created back in `0168`, which is what the rule
  actually asks: *check whether the target is created in the same migration*.
  `0185` is the RLS pair.
- 25 new pure tests, 8 new ops tests, 7 new isolation tests. `killSheet` declared
  in `src/packs/index.ts` and set by the homestead profile.
- **The whole suite ran green — 3,470 tests, isolation included** — against a
  Postgres built from zero inside this container. The first attempt at this
  slice reported the db-backed suites as unrun because no `DATABASE_URL` was
  set, which was true and was the wrong conclusion: **the runner has Postgres
  installed and CI's own local-proxy path works on a laptop too.** Written up in
  [ci-and-tests.md](ci-and-tests.md) so the next session does not repeat it.
- **STILL NOT DRIVEN IN A BROWSER**, and that one is not a missing database: the
  app needs a signed-in Clerk session and there are no Clerk keys here. Kept as
  the top open item — five of the last six slices had a defect only clicking
  found, and every one of them had passing tests over it.

### 2026-08-22 — The question this pack was answering for itself (`claude/a-cost-you-can-put-right`)

**"Has anybody said what this batch cost" was asked here AND in `inventory`, in
two different shapes, and two shapes of one question is a question that can be
answered differently in two places.** It duly was.

`addRunInput` tested `purchased + consumed === 0` before stamping a pen's share
onto its output; `inventory`'s `carriedValue` tested
`purchased !== 0 || consumed !== 0 || released !== 0`. When
[ADR 0012](../decisions/0012-what-capitalises-stock.md) §A.4 landed
`inventory_cost_adjustments` — a correction to what a batch cost, which is a row
of its own rather than a movement — a pen whose ONLY money was an appended
correction passed neither test. A kill day would have stamped NULL on meat
carrying real money while the valuation screen called the same pen "No cost
recorded": the `$0.00`-per-bird bug this pack shipped in slice 0, arriving
through a new door, in two files at once.

It is `hasRecordedCost` now, exported from `inventory/core/valuation.ts` and
called by both. **This pack must not restate that test**, and if a future slice
adds another way for money to reach a batch, that predicate is the one thing to
change.

Nothing else moved: the genuine zero still gets through (a pen whose cost was
already carried out by an earlier run has accumulated something and has nothing
left), and the unpriced pen still stamps null. One new ops test stands a pen up
with no priced chicks, corrects its cost, and expects half the pen to carry half
the money.

### 2026-08-20 — Driven on the live app, and it found what the dev tenant could not (`claude/cost-that-left-with-the-meat`)

Slice 0 driven on the `Test` tenant against **a pen with real feed on it** —
BATCH-2, 197 Cornish Cross at 7 weeks, $141.67 fed. Everything the slice claims
held up:

| | |
| --- | --- |
| Yield | **75.7%** — 468.0 lb out of 618.0 lb in |
| Cost carried | **$43.15** = $85.00 stamped feed × 100/197 head |
| Split | $39.74 + $3.41 = **$43.15 exactly** |
| Landed | Two *Made here* batches, receipts carrying the cost |
| Head | 97 standing, `Processed −100`, **mortality still 6.2%** |
| Guard | *"BATCH-2 — Cannot be processed until 2026-09-03, after Tylan 50."* |

**And it found a defect this pack caused in the pack next door.** With the cost
gone to the freezer, `livestock`'s Fed card went on showing the whole $141.67
against the 97 birds left — 72 cents a head became **$1.46 a head**, because the
numerator sat still while the denominator halved. The fix is in
[livestock.md](livestock.md); what belongs here is the rule it establishes:

> **Once cost can leave a lot, every figure derived from "what this lot cost"
> has to say which side of the departure it is on.** `production` created that
> possibility, so `production` owns the consequence.

The second half was quieter and is a boundary decision. The run carried $85.00
of that pen's $141.67 because the other $56.67 is an *allocated* estimate that
was never stamped on a movement — correct, and completely unexplained on screen.
The Cost in card now says **"Only cost stamped on the ledger travels. Anything a
batch carries as an estimate stays with the batch."** Deliberately worded
without naming what the estimate is OF: a shared feeder is `livestock`'s idea
and this pack must not know what one is, so the batch's own page says that half
in the words of the pack that owns the distinction.

### 2026-08-20 — Slice 0: the run model, and the clock that finally refuses (`claude/a-run-lands-in-stock`)

The pack that makes profit-per-pen answerable. Before this, a pen accumulated
chicks, feed and medicine and then the animals simply stopped being counted;
nothing carried what they had cost into the freezer, so the profile's whole
thesis — *every farm activity posts a cost to a cost object* — described nothing
for meat.

**A RUN IS TWO ACTS, AND THE GAP BETWEEN THEM IS THE POINT.** Starting takes the
inputs out of stock; finishing lands the outputs in `inventory` with the input
cost split across them. In between, the cost is on no shelf anywhere — which is
**work in progress**, the third inventory state the design says every accounting
system models and no farm app does. It is not a design flourish: the split
across outputs cannot be known until they have all come off the line, and
`inventory` stamps a receipt's cost once, when it happens.

**THE YIELD IS FOLDED AND IT REFUSES MORE OFTEN THAN IT ANSWERS.** 690 lb out of
1,150 lb in is 60%, it will be different for the next steer, and it is different
again at the next plant — which the design notes is real money that essentially
nobody measures. There is no stored factor anywhere in this pack, because
`inventory`'s own units file says a live-to-hanging conversion baked into a unit
is an unauditable fudge that makes every carcass quietly wrong. What there is
instead is `core/yield.ts`, and **five of its six outcomes are refusals**. The
sharp one is `PARTIAL_OUTPUT_WEIGHTS`: three of five boxes weighed, divided by
the whole animal, does not read as approximately right — it reads as a
catastrophic kill, and it looks precise. Same rule `livestock` applies to FCR:
never relax a refusal into an approximation.

**THE WITHDRAWAL CLOCK NOW REFUSES SOMETHING, AND THAT NEEDED A NEW MECHANISM.**
`livestock` built its two-clock guardrail a slice ahead of anything that could
enforce it and said so in its own dossier: *"when slice 6 lands it must consult
`blocksProcessing` before booking anything — that is the enforcement point this
slice was built for."* The problem is that `production` must NOT require
`livestock` — a bakery running runs over purchased flour is a legitimate
composition — and `livestock` must not require `production`, because a farm that
never processes anything still has a clock.

So this is **the first use of P5, a declared extension point**
([extension-model §4](../extension-model.md)):

| File | Role |
| --- | --- |
| `src/packs/production/core/handler.ts` | Production NAMES the slot. Types only |
| `src/packs/livestock/run-handler.ts` | Livestock FILLS it: claims its lots, blocks on the meat clock, and removes head through `removeHead` |
| `src/packs/run-handlers.ts` | The registry. **The only file that knows both packs exist** — same layer and same justification as `src/packs/index.ts` |

A refusal carries the owning pack's own sentence verbatim, because a withdrawal
message is a legal statement about whether meat may lawfully be sold and this
pack has no standing to reword it. *"PEN-DRUG — Cannot be processed until
2026-09-05, after Penicillin G."* **There is no override**, and `unknown` blocks
exactly as `under` does.

**HEAD LEAVES THROUGH `livestock.removeHead`, NOT A SECOND LEDGER.** The reason
`consume` is on the handler rather than done here: a run writing its own head
movement would be the parallel counter the whole pack model exists to prevent.
`removeHead` gained a fourth reason, `processed`, and it is **not offered to a
person** — `HAND_REMOVAL_REASONS` is what the pickers use — because head leaving
for a run must also land the meat, carry the cost and consult the clock, and a
dropdown does none of those. `processed` is a REMOVAL in `core/herd.ts`:
unrecognised kinds fall through to `transfer`, and a transfer would have moved
mortality's denominator on the one number the broiler enterprise lives on.

**TWO COST BASES ON THE INPUT SIDE, AND THEY ARE DIFFERENT ON PURPOSE.** A lot a
handler claims carries its ACCUMULATED cost — chicks plus feed plus medicine —
pro-rated by the share being taken; ordinary stock leaves at `inventory`'s
average, exactly as a bag of feed does. Pricing a bird at what the chick cost
would throw away eight weeks of feed.

**AND THE PRO-RATA IS NET OF WHAT HAS ALREADY LEFT.** Half a $1,000 pen on
Saturday, the rest a fortnight later: the accumulated figure never goes down, so
pro-rating the gross twice charges $1,500 for a $1,000 pen. `lotCarried` in
`inventory/core/costing.ts` subtracts what has been released, and
`tests/production-ops.test.ts` certifies the two halves summing to the pen on
the real ledger rather than in the fold.

**THE OUTPUT SPLIT PICKS A BASIS AND SAYS WHICH.** Weight when everything was
weighed, count when nothing was and every output is counted the same way (sixty
loaves are each a sixtieth of the flour — how a bakery has always costed), and
**`none` when neither**, which lands the boxes with no cost and explains why. A
dozen eggs and a pound of butter have no ratio between them, which is
`inventory`'s own rule about adding across units. The basis is the one derived
thing in the pack that is STORED, on `production_runs.cost_basis`: the rule may
change, and a historical run must keep explaining the split it actually had.

**CONDEMNATIONS ARE SLICE 1, and the reasoning is in Decisions below** — the
design is explicit that delivered head ≠ sellable carcasses, and this slice
neither models it nor pretends it away.

**DRIVEN ON `Hilltop Farm` BEFORE THE PR, and the loop closed on the second
try.** 50 birds out of PEN-2 at 312 lb live, 218 lb of whole broilers out: the
run page showed **69.9%**, the birds landed in Inventory as a **Made here**
batch called *Kill day 2026-08-20*, and the pen went to 0 head with mortality
still reading 0.0% — processing is not loss. HOGS-1, 26 days into a penicillin
withdrawal, was greyed out of the picker under *"HOGS-1 — Cannot be processed
until 2026-09-15, after Penicillin G."* That sentence is the first time this app
has refused anything on the strength of the clock.

**It found five defects, and every one of them was invisible to types and
tests:**

| What | Why no test saw it |
| --- | --- |
| **"No batchs yet"** on the very first screen | A label is the tenant's to rename and the profile renames this one to *Batch*. Naive `+ "s"`. Every other pack keeps these words singular; now this one does too |
| **Starting a run left you on a stale empty list** | `router.refresh()` immediately before `router.push()` raced, and the refresh won. `revalidatePath` had already done the server half, so the refresh was redundant as well as harmful |
| **A blocked pen's REASON was unreachable** | It rendered only for the selected lot — and a blocked lot is disabled, so it cannot be selected. All anybody saw was a greyed row saying "Not looked up", with nothing to say that an unknown is not a zero. Now every blocked batch of the chosen item lists its sentence, selected or not |
| **A pen with no recorded cost stamped `$0.00`** | **The one with a passing test over the wrong behaviour.** Every ops test used a pen with feed on it. Zero says the birds were free; nobody had said what they cost. It now stamps NULL and lands in the unpriced count, which this pack already reports honestly. A genuine zero — a pen whose cost an earlier run already carried out — still gets through |
| **A run could not land its own outputs on a farm with no meat item** | The picker offered feed, chicks, pigs and penicillin. A first kill day produces whole broilers, and the only way to record one was to leave for Inventory mid-processing-day. The output form can now create the stock line, owner-gated, exactly as `createLivestockLot` does — livestock hit this with its first cattle and fixed it in the same slice |

- `production` flipped to `available` in `scripts/seed.ts`; both databases
  re-seeded. The homestead profile gained
  `packConfig.production.runKinds` — the pack declares no kinds of its own,
  because one that knew what "butchering" meant would know what industry it was
  in.
- `receiveStock` gained `source` and `extensionSlug`. An output is `produced`,
  which `inventory`'s own column comment says slice 3 cannot infer
  retroactively.
- Two new `inventory` reads for this pack, both there because the ledger is
  `inventory`'s: `carriedCostByLot` and `balanceByLots`.
- 31 new pure tests, 11 new ops tests, 15 new isolation tests. Migration `0168`
  **hand-reordered — eighth check, third time the answer was yes**; `0169` is
  the RLS pair per table.
