# Livestock — build log archive

> Older build-log entries for the Livestock pack, moved out of
> [`livestock.md`](./livestock) so the dossier stays readable. Nothing here is
> superseded and nothing was edited — it is the record of how the pack got
> built, through the slice 8 run that settled **a lot is a group of animals and
> an animal is an animal**. The dossier itself carries the recent entries, the
> settled model, and the current state.
>
> **Vocabulary warning, the same one the dossier carries.** Entries here written
> before 2026-08-27 say *"an individual is a lot of one"*. That sentence is
> retired. [`livestock.md`](./livestock) → "The model, settled 2026-08-27" is
> what replaced it, and it is what to trust when an entry below contradicts it.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

### 2026-09-08 — Ask keeps the thread (`claude/ask-keeps-the-thread`)

**Livestock slice 11 of the improvement review — the last on its list.**
Migrations `0276` (`livestock_advisor_threads`, `livestock_advisor_messages`)
and `0277` (RLS) — applied to the dev branch and to production, RLS verified
on both (171 tables), before this PR was opened, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
**`0276` is hand-reordered**, like `0222`: drizzle-kit emits every FK before
every index, and the messages table's composite FK needs the threads table's
`(tenant_id, id)` unique index to exist first — the first run rolled back on
both databases with `42830` and the FK now sits last in the file.

**THE THREAD IS A ROW, PER PERSON.** Slice 1b kept the conversation in
component state to stay migration-free, and the dossier carried the cost as
two open items — *the advisor forgets on refresh* and *nothing rate-limits
it*. The review found what that costs on a phone: the starters vanished after
one question and the only way to start over was a reload, which also lost
everything. A thread is `livestock_advisor_threads` (`clerk_user_id`, a title
cut from the first question), its turns `livestock_advisor_messages`
(`position`-ordered, because a question and its answer written in one
transaction share a `now()`). **Per person**: every read in
`ai/threads.ts` is scoped to the asker; RLS stays tenant-wide at the row
level as everywhere in the pack, and what one member wondered about their
cows is not another's to open. Two tables rather than the interview's one
jsonb column because the turns are appended one at a time and COUNTED.

**THE BROWSER NOW SENDS ONLY THE QUESTION AND THE THREAD ID.** Until today
the history travelled from the client with every question — the digest was
server-built but the turns the model saw were whatever the browser posted.
Now `askAdvisorAction` reads the thread under the caller's tx, hands the
model `historyForModel` (the last `ADVISOR_HISTORY_MAX` turns, opening on a
question — a window that opened on an answer would hand the model a reply to
nothing), asks, and only then keeps the question and the answer as one act.
A question the model never answered is not kept and never counts.

**THE CAP CAME FREE.** `ADVISOR_DAILY_CAP` = 100 questions per farm in a
rolling day, over everyone's threads because the cost is the farm's, counted
off the messages table by an index made for it. The box closes and says so.

**Screens.** `New thread` in the header (a link to `?thread=new`); the
threads listed newest-first, a column from `md` and a `<details>` disclosure
below it; `?thread=<id>` opens one, no parameter lands on the newest — where
somebody who closed the tab in the barn expects to be; `Remove` per thread
behind `useConfirm`; the chat keyed on the thread so opening another starts
the component over. Starters are back on every empty thread.

Tests: `tests/livestock.test.ts` (pure: the title, the window, the cap);
`tests/livestock-ops.test.ts` "the advisor's threads" (order and newest-first,
another person on the same farm cannot read, continue or remove, the cap
counts questions not answers); `tests/isolation/livestock.test.ts` (both
tables, a turn on another tenant's thread unrepresentable, the CHECKs, staff,
default-deny). Guide `ask.md` rewritten. Driven on Hilltop Farm (dev).

### 2026-09-08 — The breeding calendar (`claude/the-breeding-calendar`)

**Livestock slice 10 of the improvement review, and slice 4c of the pack's own
table — the half of the founder's 2026-08-27 ask that 4a did not reach.**
Migrations `0274` (two tables) and `0275` (RLS) — applied to the dev branch and
to production, RLS verified on both (169 tables), before this PR was opened,
per [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).

**A BULL MEANS WINDOWS, NOT DATES.** The 2026-08-13 design said it in one line
— *in May 1, out Aug 1 means calves arrive roughly Feb 7 – May 10; a preg check
narrows it, the actual calving fixes it* — and that line is the whole model.
`livestock_breedings` is the exposure: the dam side (a cow, or the pen the
bull was turned in with), the sire, `exposed_from`, `exposed_to` (NULL while he
is still in), and the gestation used. `livestock_breeding_checks` is what the
vet found: `bred` | `open` | `lost`, with the vet's `days_bred` when there is
one. **The calving is not a third table** — it is the row `recordBirth` already
writes (`dam_lot_id` + `born_on`), read by the fold.

**THE CALENDAR IS A FOLD, NOT A COLUMN.** `core/breeding.ts` — `breedingCycles`
— folds an animal's exposures, checks and births into cycles, newest first:
an exposure opens one (`due = [from + g, (to ?? today) + g]`, and the far end
GROWS while he is still in); a `bred` check confirms it and, with days,
narrows it to the vet's date ± `PREG_CHECK_SLACK_DAYS` (kept inside the
exposure's window when the two overlap, trusted over it when they do not —
the arm beats a remembered date); `open` and `lost` close it with no due
date; a birth fixes it and reports `daysIntoWindow`, the cull signal. A birth
more than `EARLY_BIRTH_SLACK_DAYS` before the window opened is NOT this
cycle's — it belongs to an exposure nobody recorded — and the cycle stays
running. A check with no exposure on file still makes a cycle, with the
species' gestation from the profile, because "90 days bred on the 1st" is a
due date whether or not anybody wrote down when the bull went in. Nothing is
stored; correct the out date and every due date moves.

**ONE ROW ON THE PEN REACHES EVERY FEMALE IN IT** — `exposuresByLot` walks
`livestock_lot_members` exactly as `treatmentsByLot` does for a dose in the
water, both ends of a stay inclusive, one row to correct when he came out a
week later than somebody remembered. The bull himself and any male living in
the pen read nothing; a cow who left before he went in reads nothing. A row
keeps its own `livestock_lot_id`, so her page says `recorded on Cows` and
offers no Correct. `breedingByLot` is the single funnel; `whoIsDue` sits on it
and on the new `standingHerd` (the population fold the attention source had
inline, now shared) — a pen has a line only for its LOOSE head, an animal for
herself, a male never.

**THE GESTATION LIVES IN THE PROFILE, LIKE THE TAPE DIVISOR.** `gestationDays`
per species in the homestead profile's `packConfig` (cattle 283, swine 114;
poultry deliberately absent — a hen does not gestate), read by
`gestationDaysFrom`, pre-filled on the form, editable, and COPIED onto the row
so a later change to the profile moves nothing already on the calendar.

**Screens.** A fifth tab, `Breeding` (`/dashboard/m/livestock/breeding`):
four stat cards, the `Due` list soonest first (cards below `md`, `LinkRow`
above), `Finished` history. The lot page's Breeding section gained a `Due`
panel (hidden for a male): the newest cycle in a sentence, `Record breeding`
/ `Preg check` (member-level — opening the gate is a chore), the record
underneath with `He's out` (the one correction an exposure nearly always
needs), `Correct` and `Remove`, and on a pen an `Inside` list with each
animal's own line. `breedingAttention` raises the week before a window
opens, the day it opens, and a window shut with nothing recorded — never the
middle of a three-month window; `livestock-barn` now returns those lines too.

Tests: `tests/livestock-breeding.test.ts` (pure: the window, the fold, the
words, the digest edges, the profile reader); `tests/livestock-ops.test.ts`
"the breeding calendar" (the pen walk, narrow → fix through `recordBirth`,
he's out, refusals, staff, who is due); `tests/isolation/livestock.test.ts`
(both tables); `tests/livestock-attention.test.ts` (the three edges and the
birth clearing the line). Guides: `breeding.md` new, `lot.md`, `overview.md`,
`lots.md`, `workspace/what-needs-you.md`. Driven on Hilltop Farm (dev).

### 2026-09-08 — A course of treatment (`claude/a-course-of-treatment`)

**Livestock slice 9 of the improvement review, and the pack's first migration
since the herd tables went.** `0273` adds `livestock_treatments.course_days`
(integer, NOT NULL DEFAULT 1, CHECK ≥ 1) — applied to the dev branch and to
production, RLS verified on both (167 tables), before this PR was opened,
per [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
Additive with a default, so the code that was live while it landed never
noticed it.

**A COURSE IS ONE ROW, AND THE CLOCK COUNTS FROM ITS LAST DAY.** A five-day
course of injections was five rows, and the withdrawal was right only if
somebody typed all five — the fifth being the one that decides. Now the form
asks `Given for (days)` (one for a single dose), the row says `5-day course,
last dose 2026-08-05`, and every clock reader gets the right day through the
one funnel: `lastDoseOn` in `core/withdrawal.ts` is `treatedOn + courseDays −
1`, `withdrawalStatus` counts from it, and the page's per-row `Meat clear` and
`Milk clear` read it too. Corrected from three days to five, the clock moves
two days later, because the last dose does.

**Membership inheritance sees the whole course.** `courseTouchesStay`
replaces `givenWhileThere` in `treatmentsByLot`'s pen walk: a course that
started before she went in and ran past that day was still in the water she
drank. Same ends-inclusive rule.

Tests: `lastDoseOn`, a five-day course's clock and `courseTouchesStay` in
`tests/livestock-withdrawal.test.ts`; the course row, its corrected clock and
the refused zero in `tests/livestock-ops.test.ts`; the CHECK in
`tests/isolation/livestock.test.ts`. Guide `lot.md` swept. Driven on Hilltop
Farm (dev).

### 2026-09-08 — Small chores in the barn (`claude/small-chores-in-the-barn`)

**Livestock slice 8 of the improvement review**: the short things the guides
had been apologising for, in one PR. No migration.

- **A tag can be taken off.** `retireIdentifierAction` had existed since
  slice 0 with no caller, so the Tags table rendered a `Removed` column and a
  `current` badge no screen could change. `RetireIdentifierButton` (a date
  dialog, `member` like adding one) sits beside the badge; the row stays,
  `preferredIdentifier` still falls back to it and `lotIdsByTag` still finds
  her by it. `Applied` hides below `md` so the control fits the row.
- **A camera button on photos.** `RecordPhotos` (Documents, Layer 0 — assets
  gets it too) gained the Inbox's second input with `capture="environment"`
  and a `Take photo` button below `md`; `Add a photo` takes the `ImagePlus`
  icon so the two read apart.
- **A lot can start with its head.** `How many arrived` and `Arrived` on the
  lot form, optional; `createLivestockLot` places them in the same
  transaction through `placeHead`. Blank still places nothing — the recorded
  asymmetry stands: how many actually came is a fact somebody checks. Test
  in `tests/livestock-ops.test.ts`.
- **`ITEM_REQUIRED` is mapped** — starting a lot with no stock line read
  *Something went wrong saving that* since slice 0.
- **`Name for the new lot` and `Name`** on the split and birth dialogs, which
  still said *lot code* against the pack's own ruling.
- **The three caps say so**: `Head events` (25), `Fed in by name` (10) and
  `Daily checks` (14) carry a line when full.

Guides `lot.md` (tags, photos, split and birth labels, the caps), `lots.md`
(the count on the form, the mapped error) and `assets/asset.md` (the camera)
swept. Driven on Hilltop Farm (dev) at 375px and desktop.

### 2026-09-08 — Feed without a feeder, and on a phone (`claude/feed-without-a-feeder`)

**Livestock slice 7 of the improvement review.** The Feed page mounted
`Record a draw` only once a shared feeder existed, while `RecordDrawForm`
had carried the by-name path since 8f and opens straight into it when there
are no feeders. So a farm that feeds every pen by name — right at a small
size, and what the page's own empty prose tells it to do — could not record
feed here at all, and for staff, who cannot create a feeder, the whole screen
was inert. The guide had a section headed *There is a catch*.

**The draw form mounts whenever there is something to feed and something to
feed it.** `Who ate it` now offers only lots with animals standing in them
(it offered emptied pens while the feeder list filtered them — two lists
disagreeing about who can eat). The empty-feeders prose points at the button.

**On a phone:** the By-lot table (twelve columns, 1,004px) is a card per lot
below `md` — cost and quantity at the top right, the six figures in a
three-column list, the provenance badge — and each feeder's members are a
card each with `Take off` on it; the four stat cards go two-up.
`EndMembershipForm` gained `idPrefix` for the two layouts.

**Two small ones the guide had to apologise for:** `Close` on a feeder now
asks first (`useConfirm`, the pattern accounting's dialogs use), because
nothing reopens a feeder from this screen; `Add a lot` says why when it is
greyed out.

No logic changed and no tests were added; guide tests, lint and a cold `tsc`
cover it, and it was driven at 375px and desktop on Hilltop Farm (dev).
`docs/help/livestock/feed.md` rewritten without the catch. No migration.

### 2026-09-08 — The lot page in a phone's order (`claude/the-lot-page-on-a-phone`)

**Livestock slice 6 of the improvement review.** The largest screen in the
product measured 3,895px tall at 375px with its eleven sections in one
column, the daily check 2,850px down, eight panels one per row before the
first section, and three tables — members 473px, treatments 711px, weighings
641px — whose `Take out`, `Correct` and `Remove` sat off the right edge. On
the treatments table that is the one control in the pack whose absence is a
legal problem.

**The order changed for every screen, not only the phone.** The working
records now come before the identity ones: panels, the books, `In this lot`,
`Daily checks`, `Treatments`, `Weighings`, then `Breeding`, `Photos`, `Tags`,
`Fed in by name`, `Head events`. A check, a dose and a weight are what a
person came to the page to do; parents and papers are what they came to
look up. One order rather than one per device, so the guide describes one
page.

**`On this page`**, a row of anchor chips under the tabs, phone only: eleven
sections is four thousand pixels and the one somebody came for is rarely the
first. Anchors rather than tabs, so the page stays one page and a link into
it still lands on everything; each section carries `id` and `scroll-mt-24`
for the sticky bar. A chip appears only when its section does.

**Panels two-up** from the narrowest phone, the product's stat-row rule;
`Fed` and `Withdrawal` take a whole row because they carry a sentence.

**Treatments, weighings and members are a card each below `md`**, the table
above it, the round's pattern. `RecordTreatmentForm` and `RecordWeightForm`
gained `idPrefix` for the same reason `LotCheckForm` did: each correction now
renders twice and a duplicate field id points every label at the first copy.

Done by a script over the file rather than by hand (the page is 1,900
lines): section ids, the strip, the grid, three card lists, then the blocks
cut and reordered by their id'd wrapper lines with every anchor asserted
unique. No logic changed and no tests were added; guide tests, lint and a
cold `tsc` cover the rewrite, and it was driven at 375px and desktop on
Hilltop Farm (dev). Guide `lot.md` gained *Finding your way on a phone* and
the page order. No migration.

### 2026-09-08 — The barn reaches What needs you (`claude/the-barn-reaches-what-needs-you`)

**Livestock slice 5 of the improvement review, and the pack's first attention
source.** Two open items had sat here for a month — *"nothing warns that a
withdrawal is about to expire, or that one has just cleared"*, and the round's
own argument that a day nobody looked is a fact, with no way to learn one had
gone by except to open the round and read `3 days ago`. `notifications.md`
has the seam for exactly this, and `production` had already shown a pack
could use it.

**`src/packs/livestock/attention/source.ts`** (`livestock-barn`, label
`Livestock`, registered fourth — below production, above accounting) reads
and nothing else; **`core/attention.ts`** is the arithmetic, pure and tested:

- **A missed round.** One line for the farm, never one per lot: `PEN-1 has
  not been looked at for 3 days`, `PEN-1 has never been looked at`, or `4
  lots have not been looked at for 2 days or more` naming four. Overdue, due
  the day the round was first missed. `ROUND_STALE_AFTER_DAYS` is two:
  yesterday is an ordinary morning and a 7am digest that raised it would
  raise every lot every day. Walked by pen — a member is looked at with the
  pen she lives in — over the population fold (`summarisePen`), so a pen
  whose head are all named is still a pen to look at.
- **A withdrawal nobody looked up.** Overdue, no date, until the treatment
  is corrected with a period — the one item here that does not clear by
  waiting.
- **A withdrawal clearing today or tomorrow.** `today` / `soon`; read off
  `state: "clear"` with `clearsOn` today, because `withdrawalStatus` clears
  ON the day. A clock with days to run, or one that cleared last week, is
  not raised.

Everybody gets the lines, like production's, for the same reason and at the
same cost. Closed lots and lots with nothing standing in them are skipped.
The digest carries the section for free; the What needs you guide names it.

Tests: `roundAttention` and `withdrawalAttention` in `tests/livestock.test.ts`;
`tests/livestock-attention.test.ts` (db) runs `collect` through RLS and pins
that each item clears itself — the round when walked, the unknown clock when
the label is read, the clearing line the day after. Guides `overview`,
`daily-round`, `lot` and `workspace/what-needs-you` swept. No migration.

### 2026-09-07 — A withdrawal follows the animal into and out of a pen (`claude/a-withdrawal-follows-the-animal`)

**Livestock slice 4 of the improvement review, and the safety gap the review
found by reading the code.** The withdrawal clock was inherited down the
SPLIT chain only, bounded by the day each branch separated — the right rule
when a split animal LEFT the pen, which is what a split did until 8b. Since
8b a named animal STAYS in her pen. So a pen medicated in the water the day
after four cows were named out of it left all four reading Clear on their
pages, on the hub and on the round, because `treatmentsByLot` never asked
`livestock_lot_members`.

**`membershipTreatmentSources`** asks it: every span an animal has ever had
in a pen (not only the open one — a dose given during a stay she has since
ended still runs its clock on her), and a dose given to the pen inside the
span reaches her. **Both ends of the span count** (`givenWhileThere` in
`core/withdrawal.ts`, pure): the day she went in she was there for the
afternoon water; the day she came out she may have been there for the
morning's. Membership's `ended_on` is exclusive because a cow taken out today
is out today; for a DOSE the question is whether she could have had it, and
the file errs toward saying she did. One level deep, like membership.

**The reverse never happens.** A dose given to one cow is hers alone; her
pen's clock is untouched. What changes on the pen's side is visibility: the
hub row reads `1 inside not clear` beside the pen's own badge, the pen's
Withdrawal panel says how many inside are not clear on clocks of their own,
and the `In this lot` table badges the animal — somebody loading a trailer
from the pen needs to know she is standing in it, and the pen's row was the
only place on the hub she was visible at all.

**A dose can arrive by both routes** — the pen treated on the day a cow was
named out of it is inside the split bound AND inside her membership — so a
row is kept once, by id, and every returned row now carries `via`
(`own | split | pen`); the page words the two inherited kinds differently
(*before this one was split out* / *while she lived in it*) and offers
Correct on neither. `run-handler.ts` needed no change: it reads
`withdrawalByLot`, the funnel this lives in, which is the reason the funnel
exists.

Tests: `givenWhileThere` in `tests/livestock-withdrawal.test.ts`; in
`tests/livestock-ops.test.ts` a pen dose reaches the cow living in it and
hers never reaches the pen, the span starts the day she was put in and stops
the day she was taken out, and a same-day dose arrives once. Guides
`overview`, `lots`, `lot`, `daily-round` swept. Driven on Hilltop Farm (dev).
No migration.

### 2026-09-07 — A pen counted once (`claude/a-pen-counted-once`)

**Livestock slice 3 of the improvement review, and the counting bug the
guides had been apologising for since 2026-09-03.** The hub folded a pen's
named members into `Head` and the pen's own page did not: `Cows` — five named
cows, nothing loose — read `5 (5 in)` on the list and `Nothing placed yet` on
its page, hid `Treat`, `Weigh` and the daily check off its own page, and was
absent from the round while its five cows were five separate rows. `Lost`
was over a different population from `Head` in the same row.

**`summarisePen` in `core/herd.ts`** is the one fold both screens make now: a
pen's population is what is loose in it plus every named animal living in it.
**A split between the pen and a member is internal** — naming four cows out
of a pen of a hundred writes `split_out` −4 on the pen and `split_in` +1 on
each cow, and `summariseHead` counts a transfer IN as intake so a split-off
lot has a mortality denominator; summed naively the population had taken in
104 head. A member whose inventory lot was split out of THIS pen has her
split-in taken back out of the intake (`lotMemberSummaries` now returns her
`summary`, `splitInHead` and `parentInventoryLotId`); a member split out of
some OTHER pen and put in here later genuinely arrived and keeps it.

**Which count a control reads is the point.** A loss, a split and a name-out
take head that is LOOSE, so they read the pen's own summary; a treatment, a
weighing, a check and the headline are about the animals standing in the
pen, so they read the population. `Record loss` is offered only while there
is loose head and the lot is open — on an emptied or closed lot it was
offered and then refused, and on a pen whose animals are all named it would
have taken the pen's own ledger negative. The check dialog on such a pen
replaces its `Head leaving` box with the sentence saying where the loss goes.

**The round is walked by pen.** One row per pen with the named animals living
in it under it (a sub-row on a wide screen, a list at the foot of the card on
a phone); `Mark normal` on a pen marks the pen and everything in it in one
tap through `markRoundNormal`, whose ON CONFLICT DO NOTHING keeps an animal
somebody already flagged this morning flagged; each animal keeps a log row
of her own, so her page still answers "when was she last looked at", and
`Something's up` under her name is where a lame cow or a dead one goes.
`Checked` counts pens and animals together, which is what the buttons act
on. An animal living in no pen is a row of her own. `Mark normal` also toasts
at last (`Marked normal` / `6 marked normal`).

Tests: `summarisePen` and `splitInHead` in `tests/livestock.test.ts`; the
member-summary assertions in `tests/livestock-ops.test.ts`. Guides `lots.md`,
`lot.md` and `daily-round.md` swept. Driven on Hilltop Farm (dev). No
migration.

### 2026-09-07 — The hub on a phone, and an animal found by her tag (`claude/the-hub-on-a-phone`)

**Livestock slice 2 of the improvement review.** The hub's table measured
655px in a 343px phone column, and the two columns off its right edge —
Withdrawal and Head — are the two a farmer opens the page for. And **finding
an animal by her tag was impossible**: the search matched the code and the
species, while `livestock_identifiers` has carried a value index since slice
0 "because finding an animal by its tag happens in a chute". Nothing read it.

**A card per lot below `md`, the table above it**, both from one `rows`
array folded once (head, members, breeding, zone, age, loss, withdrawal), so
the two shapes cannot disagree about a lot. The whole card is the link, and
above `md` the whole row is (`LinkRow`, its second use after accounting).
The thumbnail is bigger on the card, because a thumb is what a phone is for.

**`lotIdsByTag`** — one indexed query, only when there is a term:
case-insensitive, partial, wildcards escaped, and digits-to-digits when the
term is mostly digits (`840 9917` finds `USA-840-9917`, and so does
`8409917`). `numericTerm` in `src/lib/list-query.ts` is that rule, lifted out
of `matchesAny` so memory and SQL decide the same way. **Retired tags
count**: the number off a tag found in a fence is the only thing anybody has
to go on, the same reason `preferredIdentifier` falls back to one.

**A search reaches inside lots.** A cow named into `Cows` is no top-level row,
so "find Bluebell" found nothing — the one question the box exists for. Under
a search the pool is every lot, and a member that matches is shown with `in
Cows` beside her (a link on the row; plain text on the card, which is itself
a link). With no search the membership narrowing stands as before.

**Species pills.** `?species=` had been read by the page since slice 0 and was
reachable from nowhere. `All` plus one pill per species on the farm, only
when there is more than one; every href on the bar carries the other two
filters (`LotFilters.href` is the one place a URL is built). The species
filter moved from the query into the in-memory narrowing, so the pills can
list the species you are not looking at.

**Every dialog in the product scrolls on a phone now** — a Layer 0 fix found
here: `Add animals` measured 885px tall in an 812px viewport with `overflow:
visible`, its title clipped off the top and its Start button off the bottom,
and only the Treat form had set its own `max-h`. `DialogContent` carries
`max-h-[calc(100dvh-2rem)] overflow-y-auto` for everyone; see
[design-system.md](design-system.md).

Tests: `lotIdsByTag` in `tests/livestock-ops.test.ts` (partial, case, digits,
escaped wildcard, retired tag), `numericTerm` in `tests/list-query.test.ts`.
Guide `docs/help/livestock/lots.md` rewritten for both shapes, the tag
search and the pills. Driven at 375px and desktop on Hilltop Farm (dev).

### 2026-09-07 — The round on a phone (`claude/the-round-on-a-phone`)

**The founder's improvement review reached this pack** (the same four
questions accounting got: fewer clicks, easier UI, phone, gaps). Every screen
was measured at 375px in the Browser pane on Hilltop Farm. The round — the
one screen built to be used in a barn — rendered a 733px table, and `Mark
normal` and `Something's up` sat at x=516–736 on every row: off the right
edge of the phone, reachable only by dragging each row sideways. The three
stat cards stacked one per row and pushed the first lot to y≈1080.

**A card per lot below `md`, the table above it**, both rendered from the same
`round` array with CSS choosing — the review queue's pattern, because a
`matchMedia` hook has to guess a width on the server and would flash the table
on exactly the device this exists for. The card carries the name, species and
paddock, the withdrawal badge when it blocks, the head, what left today, when
it was last checked, and the same two buttons along its bottom. Stat cards go
two-up from the narrowest phone, the third taking the whole row.

**`LotCheckForm` takes an `idPrefix`**, because rendering every row twice put
the same lot's dialog in the DOM twice and a duplicate field id points every
label at the first copy. Each layout passes its own.

**`Sold live` is finally read back.** The dialog has offered it beside `Died`
and `Culled` since slice 1a, and `LOSS_KINDS` in `core/daily.ts` omitted it —
correctly, a sale is not a loss — so the head left the count and then showed
nowhere. `soldOn` is the other half of `lossesOn`; the table says `2 sold
live` under the loss column, the card says `3 lost, 2 sold live today`
(`describeLeft`), the `Lost today` tile names it in its footnote and the
`Noted today` list no longer reads *"Flagged with no note"* about a sale. The
box in the dialog reads **`Head leaving`** — the lot page's dialog has been
headed that since slice 0 — because `Head lost` beside a `Sold live` option
was the label the guide had to apologise for. Tests in `tests/livestock.test.ts`.

Driven at 375px and desktop on Hilltop Farm (dev). `docs/help/livestock/daily-round.md`
rewritten for both shapes. Findings for the rest of the pack, and the slice
list they became, are in the session's memory rather than here: the next
slices are the hub on a phone with search by tag, a pen counted once (the
head fold below), a withdrawal that follows membership, and a livestock
attention source.

### 2026-09-04 — Photos answer to Documents too (`claude/a-photo-is-still-the-dms-s`)

The photo half of yesterday's entry was wrong and is reverted. `canEdit` on the
Photos section is `canRecord && roleMayWrite(ctx.role)` now — the pack's rule AND
the DMS's, because a photo is a pack chore that writes a row in `documents`, and
`expert` is read-only in Documents by design.

**Add-to-lot and Take-out-of-lot are unaffected** and stay open to everyone,
accountant included: putting an animal in a pen writes no document. See
[documents.md](documents.md) for the mechanism and the test.

`docs/help/livestock/lot.md` and `overview.md` say photos are closed to the
accountant again, and say why.

### 2026-09-03 — A chore is a chore in the pen too (`claude/a-chore-is-a-chore-in-the-pen`)

Three UI gates on the lot page disagreed with the ops layer they call. All three
were the UI being stricter than the server, so nothing that used to be refused is
refused now.

**Membership is a chore.** `AddToLotForm` and `TakeOutOfLotButton` were behind
`isOwner` while `addLotToParent` and `removeLotFromParent` were both `member`
(`ops.ts:1258,1343`). Putting an animal in a lot creates no cost object — she
already exists and so does the lot — and the row says which pen she is in
tonight, which is the definition of a chore. The section's own render condition
moved with them, so a staff member on a lot with no members sees the invitation
rather than an empty page.

**And the photo panel's `ctx.role !== "expert"` is gone.** ~~`photoGate` asks
`allowsWrite(role, "member")` and that clears the accountant.~~ **CORRECTED THE
NEXT DAY — see the 2026-09-04 entry above.** A photo answers to TWO rules, and
only the pack's was asked; the DMS refuses the accountant the `documents` row.
The comment correction was right as far as it went. Add-to-lot and
Take-out-of-lot are unaffected. **Settled 2026-09-03** by the founder:
`authorize.ts` excludes `expert` from the OWNER level and no other, and that is
the rule. `assets` carried the identical comment and the identical UI lockout;
both are fixed in their own PR.

**`Treat` and `Weigh` keep their `head > 0` gate.** It looks like a fourth
mismatch and is not one: there is no server rule to disagree with, and the defect
behind the symptom is already recorded as *Head is counted two ways, and it hides
controls* — the lot page's balance excludes named members while the hub's
includes them, so a lot whose head are all named reads 0 and loses three
controls. That is a counting bug in the read, not a permission gate, and fixing
it here would have hidden it.

Guides swept in the same PR: `lot.md` and `overview.md` no longer put animals in
and out of a lot on the owner's list, and no longer say the accountant cannot
touch photos.

### 2026-09-03 — Six tenant guides, and what writing them found (`claude/livestock-guides`)

Guides in `docs/help/livestock/` for all five screens plus an overview:
`overview` (the `**` fallback, 0), `lots` (10), `lot` (20), `daily-round` (30),
`feed` (40), `ask` (50) — numbered in the pack's own tab order. Four agents read
the two lot screens, the four lot panels, the three tab screens and the action
layer before a word was written. The lot page is the largest screen in the
product: eleven sections, nineteen dialogs, roughly ninety-five visible strings.

**Vocabulary: the worst of the five packs.** `livestockLot` is resolved in three
files, about 22 visible strings honour it, and about **24 hardcode it** — four of
those as `pen` rather than `lot`. `structure` is resolved exactly once, and
reaches the reader in a single select label that renders as `In a pen or barn`,
which reads as a typo rather than a label. The hub never resolves `structure` at
all. The guides therefore use `{{livestockLot}}` in prose and quote hardcoded
strings literally, the same rule as `inventory` and `retail`.

Two further vocabulary faults worth their own line. **Article agreement breaks
on any renamed word** — `A {lower}`, `Start a {lower}`, `Find a {lower}` all
assume a consonant, so a tenant word like *Enclosure* yields `A enclosure`. And
`New lot code` / `Lot code` on the split and birth dialogs contradict this pack's
own recorded decision to rename that field to `Name`, because *Lot code* told a
farmer to invent a barcode.

**Head is counted two different ways, and it hides controls.** The hub folds
every member's balance into `Head` (`LivestockModule.tsx:483-505`); the lot page's
`Head` panel is the lot's own balance only (`page.tsx:596`). A pen of 100 with
four named cows reads `100 (4 in)` on the hub and `96` on its own page. **The
consequence is not cosmetic:** `Treat`, `Weigh` and the daily check are gated on
`balance > 0`, so a lot whose head are entirely held by named members can be
neither treated, weighed nor checked from its own page, while the hub says it
holds animals. `Lost` on the hub then excludes members while `Head` includes
them, so the two figures in one row are over different populations.

**The Feed screen cannot record feed on a farm with no shared feeder.**
`feed/page.tsx:274-285` renders the draw form only when `groups.length > 0`.
`RecordDrawForm` fully supports the no-feeder case — it defaults to `named` and
hides the toggle — but is never mounted in it. So the by-name path is unreachable
from this screen until somebody creates a feeder they do not need, and the
screen's own empty prose tells them not to. **For staff the whole screen is inert**,
because `New feeder` is owner-only. The guide sends readers to the lot page's
`Feed` button instead.

**`Sold live` on the daily round is invisible.** The round writes the movement
with the real kind, but `LOSS_KINDS` (`core/daily.ts:152`) omits `sold_live`, so
recording a live sale drops the head count, flags the lot `Noted`, and leaves both
the `Lost today` column and the stat card reading `—`. The field is labelled
`Head lost` with `Sold live` sitting in the picker beside it.

**Two dead actions, callers checked across `src/` and `tests/`.**
`moveLotsToZoneAction` and `retireIdentifierAction` have none. The second is
user-visible: the Tags table renders a `Removed` column and a `current` badge for
a state no screen can produce.

**`ITEM_REQUIRED` is thrown and has no case in the mapper** (`ops.ts:270`), so
starting a lot with no `Counted as` reports `Something went wrong saving that.`
Six other codes throw a specific sentence and are replaced by a generic one; two
genuinely useful ones are lost — `that one is not in a lot` and `that feeder does
not exist`.

**Four UI-stricter-than-server mismatches**, the pattern now found in four of the
five packs: Add-to-lot and Take-out are owner-gated in the UI while the ops layer
calls them chores; Photos hide from `expert` though the server allows it; Treat
and Weigh are gated on `head > 0` with no server rule. And `actions.ts:196` says
the accountant role is read-only everywhere, while `allowsWrite` lets `expert`
through at member level — so an expert can place head, treat, weigh, feed, tag and
daily-check. Either the comment or the gate is wrong.

**Smaller findings**, all in the guides where a reader would be misled: three
silent truncations (head events 25, fed-in 10, checks 14) in a pack whose own
comment forbids them; `?species=` is read and unreachable; `Record loss` is
offered on an emptied or closed lot and then refused; the trigger says `Record
loss` and the dialog says `Head leaving`; `The whole lot` multiplies a historical
average by today's head count; `Who ate it` offers emptied lots where the feeder
list filters them; `Mark normal` is the only write on these screens that toasts
nothing; `Add a lot` disables itself with no explanation; closing a feeder has no
confirmation and no way back; and the Ask thread is lost on refresh with no clear,
copy or cancel control.

**Ask is read-only by construction**, which the guide states plainly: it writes no
record, and the only thing persisted is an audit row carrying the lot and turn
counts, never the question or the answer.

**Not clicked through live:** the pane's Clerk session is expired.

### 2026-08-31 — The split dropped one more thing (`claude/the-cost-side`)

No change in this pack; the fix is one line in `inventory`'s `splitLot`, which
`splitLivestockLot` calls. It is recorded here because **this is the third time
the same split has been found dropping something**, and this pack is where it
bites hardest.

The pattern is written down twice already in this dossier: the split *"carried
her species, her sex, her birth date, her breeding and both parents across"* and
dropped her lot membership, then dropped her feeder membership. **This time it
dropped her line of business** — `enterpriseId` was omitted from the
`createLot` call, which `inventory` reads as "not said" and answers by
inheriting the ITEM's tag instead of the parent pen's.

**`splitIntoIndividuals` calls the split once per animal**, so naming ten cows
out of a pen minted ten lots whose costs went wherever the item pointed. See
[enterprises.md](enterprises.md) for the rule and the live example on the dev
tenant.

**The lesson worth keeping is the shape, not the field.** Anything that derives
a lot from another lot has to state every inherited property explicitly, because
in `createLot` an omitted `enterpriseId` is not neutral — it means "inherit the
item's". Three fields have now been lost to that one function; the fourth will
be too unless the next person adding a column to `inventory_lots` checks the
split.

### 2026-08-28 — An empty pen is not a lot (`claude/an-empty-pen-is-not-a-lot`)

**Three the founder asked for after driving.** No migration.

**A LOT DOES NOT GIVE BIRTH.** *Record a birth* was the last animal-shaped
control left on a lot page, and it survived the sire-and-dam fix only because
the flock→hatch case looked like a reason to keep it. It is not: a birth is
recorded on the MOTHER's page, and a mother is an animal. **A hatch parented by
a flock is still reachable** — the dam picker lists lots as well as animals — it
just starts from an animal rather than from the container.

**AN EMPTIED PEN CAN BE PUT AWAY.** PEN-2 held 50 broilers, they went to the
processor, and it has been on every screen since — including as somewhere to put
animals. **The app cannot infer this and must not try:** a lot at zero head is
either finished or about to be filled, and the ledger says the same thing about
both. So it is an act, and reversible.

**The status is `inventory_lots.status`, not a column of our own.** Inventory has
had `open | closed` and a `closeLot` since its slice 0 and livestock simply never
used it. Refused while anything is still in it — head standing, or animals named
into it — because closing a lot that holds a cow would hide her, and the hub is
where somebody would go looking. Closed lots leave the hub by default (`?closed=1`
brings them back, the same shape as `inventory`'s retired items) and are no longer
offered by `lotsAvailableToJoin`.

**A REGRESSION I INTRODUCED AND CAUGHT BY OPENING THE PAGE.** Filtering earlier
meant members were no longer in the array the head cell looked them up in, so
`Cows` read **0** while holding four animals. The fix inverts `parentByLot` —
which phase one already has — into members-per-parent, and fetches the members'
movements alongside their parents'. **No test noticed**; the page said 0 and the
farm had four.

**THE HUB NARROWS BEFORE IT WORKS, NOT AFTER.** The dossier's "fine at 20 lots,
wrong at 200" was not really about rendering — it was that every lot's movements,
zone, withdrawal clock, breeding and thumbnail were fetched whatever you were
looking for. The load is now two phases: what exists, then the expensive reads
**for the rows that survived**. Search and the closed filter cut the work, not
just the list.

**The order of the three narrowings is load-bearing.** Membership first and never
after the cap — a member excluded here is one shown on its parent's page instead,
and capping first could let a named cow through as a top-level row while her
herdmates were cut. `LOT_PAGE_SIZE` is 100, and the footer **names what it left
out**, because a list that quietly stops is one somebody trusts to be complete.

**AND "TAKE OUT" DID NOTHING, which is how a fourth thing got found.** Pressing
it set `ended_on` to today — and `ended_on` was INCLUSIVE, copied from
`land_occupancy`, so the animal was still in the lot for the rest of that day and
the button read as broken.

**`livestock_lot_members.ended_on` is now EXCLUSIVE**, and that divergence from
land is deliberate: a paddock stay is inclusive because the animals genuinely
grazed that ground that day and the rest clock has to know. **A lot membership is
not a duration, it is a placement** — and a placement somebody ends is ended. It
simplifies a move as well: the superseded row closes at the new row's
`started_on`, so the two meet exactly with no off-by-one day.

**A TRAP IN THIS SESSION'S OWN VERIFICATION, worth more than the fixes.**
`tsc --noEmit` was reporting clean while a real error sat in the file being
edited. Next writes `.next/dev/types/validator.ts`, it was momentarily malformed,
**tsc bailed on its parse errors before reaching `src/`** — and the habit of
piping through `grep -v ".next"` hid exactly the line that said so. With
`incremental: true` a stale `tsconfig.tsbuildinfo` can hold the answer too.
**Clear both and read the raw output when a check passes on a file you know you
just broke.** Found by noticing that a `Cannot find name` could not possibly be
clean.


### 2026-08-28 — A calf stays with its mother (`claude/a-calf-stays-with-its-mother`)

**Two more found by driving, and the second is a real model error.** No
migration.

**A BIRTH WAS THE ONE WAY TO CREATE AN ANIMAL THAT LANDED NOWHERE.** The
founder: *"the birthing thing says it creates a new lot, but don't we want it to
stay in the same lot with its mother and the other cows in that lot."*

He is right, and it is the same rule a SPLIT has followed since 8b — name a cow
out of a pen and she stays in it. A birth was the exception nobody noticed: a
calf born to a cow in the north herd appeared on the hub as an unrelated record
and somebody had to go and put her back.

`lotForOffspring` takes the three readings of "her mother's lot", in order:

  1. **the dam's own lot**, if she is in one — the calf joins her herdmates
  2. **else the dam HERSELF** when she is a lot rather than an animal — chicks
     out of a layer flock belong in that flock
  3. **else nowhere.** A loose cow has no lot to put a calf in, and inventing
     one would be the app making a grouping nobody asked for.

The sire stands in when there is no dam on the record. Exported rather than
inlined, because it is a RULE: anything else that makes an animal from a parent
should land it in the same place, and a second copy would drift.

**One level deep still holds.** The calf joins the dam's LOT, never the dam —
joining her would make a grandchild, and there is no such thing here.

**AND A LOT DOES NOT HAVE A BIRTHDAY.** *"A lot never has a birthdate. It is
just a container."* True, and the field is not about the container — it is about
the ANIMALS counted in it. That is why it survives rather than being removed:
**head counted in bulk has no per-animal record anywhere for a hatch date to
live**, and Age, days-to-slaughter and `production`'s age-band pricing all read
it. Removing it would blank all three for every flock and pen.

So it stays for the case it is FOR, marked *optional* and saying so: *"for head
counted in bulk that all share a date — a box of chicks, a delivery of feeder
pigs. Leave it blank for a lot you are going to put named animals in; they carry
their own."* The founder's call, taken as a question first.

**Also: the retired doctrine, again.** The birth dialog still read *"One calf is
a lot of one."* Now *"One calf is an animal with a page of her own."* That
sentence has now been removed from copy in 8a, from the schema header in 8g, and
from here — worth noticing how long a retired phrase survives in the corners.

Driven on Hilltop Farm: a birth recorded from Rosie, who is in `Cows`, put
**Piglet Pip in `Cows`** beside her. 128/128 ops.


### 2026-08-28 — Slice 8g: the herd tables go (`claude/drop-the-herd-tables`)

**The second of two releases, and that separation is the whole slice.** `0232`
drops `livestock_groups` and `livestock_group_members`. Slice 8 is done.

8e converted every herd into a LOT and stopped the code reading these tables.
This drops them, one deploy later. **`main` auto-deploys and nothing applies
migrations for it**, so a DROP shipped beside the code that stops reading a
table takes the running app down in the gap between the two — ADR 0014's rule,
read backwards for a removal. Splitting it cost one extra PR and bought the
guarantee that no release ever has code and schema disagreeing.

**TWO CHECKS BEFORE RUNNING IT, both on both databases:**

  - **Every herd had a converted lot.** A query for herds with no
    `metadata->>'migratedFromHerd'` counterpart returned **0 on dev and 0 on
    production** — so nothing here loses a grouping. Had it returned anything,
    the DROP would have deleted a real fact and no test would have noticed.
  - **No foreign key outside these two tables points at them**, so the CASCADE
    takes only their own constraints and policies. `CASCADE` on a DROP is worth
    proving rather than assuming; it is exactly the clause that quietly removes
    something else.

**The isolation tests for the herd tables go now, with the tables.** They stayed
alive through 8e on purpose — the tables were still there, and a live table with
no certification is what that suite exists to catch.

**Also corrected: the retired doctrine at the top of the schema.**
`livestock_lots`' own comment still opened with *"Every animal record is a lot,
and an individual is a lot of one"* — the sentence 8a retired and the founder
objected to. It sat where every agent reads it first. Half of the old reasoning
was right and is kept: ONE TABLE is still correct, because two entities would
give every downstream table two code paths. What changed is that the
distinction is now recorded in `record_kind` rather than inferred.

**BOTH DATABASES ARE DROPPED AND VERIFIED: 153 tables → 151**, RLS enabled,
forced and with policies on every remaining one. Confirmed AFTER as well as
before — the herd tables are gone from `information_schema` on both, and the
converted lots still hold their members: dev `Cows` holds 4, **production
`Dexter Heard` holds 1**. That second one is the whole argument for 8e having
existed: a bare DROP would have thrown that grouping away.


### 2026-08-28 — A lot has no mother (`claude/a-lot-has-no-mother`)

**Two things the founder found by driving slice 8, and one of them is 8c's
mistake.** No migration.

**A LOT WAS BEING OFFERED A SIRE AND A DAM.** *"The lot is not the animal."* He
is right, and 8c's reasoning for keeping the whole Breeding section on both
pages was wrong — it conflated two different claims:

  - a lot can **BE** a parent. *"These chicks came from that flock"* is true, it
    is the only pedigree a flock will ever have, and the offspring table still
    says so. **Kept.**
  - a lot **HAVING** one dam and one sire. For a hundred broilers that is not a
    fact about anything. **Gone** — `SetParentsForm` and the Dam/Sire panel are
    now `isAnimal` only.

**What a lot is MADE OF stays**, because "Cornish Cross" is a real answer to
what a pen is. So does **Record a birth**: a cohort produces offspring even
though a cohort has no mother, and that is the layers→hatch path the schema was
built for. **That last one is the judgement call in this PR** — say so if a lot
should not be offered it either.

**AND THERE WAS NO WAY TO PUT A NAMED ANIMAL IN A LOT.** *"I see how I can
increase head count, which works for chickens but not when I want to track the
individual animal. Maybe I'm missing something."* He was not missing anything.

`lotsAvailableToJoin` only ever offered lots that **already existed**, so a lot
created five seconds ago said *"Nothing to add"* — the one thing a person does
straight after making a lot was the one thing the dialog could not do. Naming an
animal meant going to the hub, creating her loose, coming back, and picking her
out of a list: **four steps across two pages, and nothing said so.**

**Place head was never the same thing.** It adds ANONYMOUS head, which is right
for a hundred broilers and wrong for a cow you intend to weigh, treat and breed
by name. The empty state said "the head counted above is loose in it" and read
as though that were the answer.

So `startIndividual` takes an optional `parentLotId` and the dialog leads with
**A new animal** / **One already here** — new first when there is nothing to
pick, so the dead end is unreachable. She is created, her one head is placed and
she joins the lot **in one transaction**: she exists in it or not at all. She
inherits the lot's species and stock line, so the form asks for a name and
nothing else.

Driven on Hilltop Farm: PEN-2 had 0 head and nothing in it — the founder's exact
case — and now holds Henrietta, created from its own page. Set parents, Pedigree
and Dam are all absent from it. 125/125 ops.


### 2026-08-28 — Slice 8e: the herd becomes a lot (`claude/the-herd-becomes-a-lot`)

**Every herd is now a LOT holding what it held, and nothing reads
`livestock_groups` any more.** Migration `0231`. Slice 8 is complete except the
DROP, which is deliberately not here.

**THE TABLES ARE NOT DROPPED IN THIS PR, AND THAT IS THE WHOLE SHAPE OF IT.**
`main` auto-deploys and nothing applies migrations for it, so a DROP shipped
beside the code that stops reading it would take the running app down in the gap
between the two. ADR 0014's rule is usually read as *apply the migration before
merging an addition*; a removal runs the same risk in the other direction, and
the answer is the same — **two releases.** 8g drops them once this is live.

**A BARE DROP WOULD HAVE LOST REAL GROUPINGS.** Hilltop Farm's "Cows" holds
Rosie, Hazel, Mabel and Bluebell. Without a conversion they would have become
four unrelated rows with nothing saying they belong together — the app would
have "removed herds" by deleting the farm's only herd.

A converted herd is an `inventory_lots` row named for it with **no head of its
own** (the head was always its members' and stays there), a `livestock_lots` row
at `record_kind = 'lot'`, and one `livestock_lot_members` row per membership with
the dates carried across.

**THE LINK IS THE HERD'S ID IN `metadata`, NEVER ITS NAME.** `livestock_groups`
does not enforce unique names, so two herds called "Cows" would produce two lots
coded "Cows" and a name join would cross them — duplicating every membership and
tripping the one-open-per-member index. Found by reading the constraint rather
than by running it.

**Two skips, both stated in the SQL:**

  - **An animal already placed in a lot by hand keeps that placement.** The
    partial unique index allows one open membership, and somebody who stated it
    outranks a migration inferring it.
  - **A member that HOLDS things is skipped**, for the one-level rule — a herd
    containing a lot that itself contains animals cannot become a two-level
    tree.

Closed memberships carry across regardless: history does not collide.

**What came out of the code.** The `herds/[id]` route, `herd-controls.tsx`, 411
lines of herd ops, five actions, the hub's Herds section, the lot page's herd
link, and the `livestockGroup` label from both the registry and the
homestead-farm profile. `NO_UUID` and two type imports went with them — every one
was only there for herd code.

**The hub has one rule again.** It used to exclude both "in a herd" and "inside
another lot"; now it shows top-level lots, full stop.

**THE ISOLATION TESTS FOR THE HERD TABLES DELIBERATELY STAY.** The tables are
still there, and a live table with no certification is exactly what that suite
exists to catch. They go in 8g with the DROP. The herd OPS tests went now,
because the functions did.

**BOTH DATABASES ARE MIGRATED AND VERIFIED**, and production had a herd too:
dev 1 herd → 1 lot holding 4, **production 1 herd → 1 lot holding 1**. Checked
before and after, because `verify-rls` sees tables and this migration only
moves rows. Both at 153 tables, RLS enabled, forced, with policies.

Driven on dev: the hub is ONE list — no Herds section, no *Start a herd*, no
*Not in a herd* — and `Cows` lists Bluebell, Rosie, Hazel and Mabel with the
dates their herd memberships had.


### 2026-08-28 — Slice 8d: a lot moves as one (`claude/a-lot-moves-as-one`)

**The last thing herds could do that lots could not**, and with it gone 8e has
nothing left to preserve. No migration.

**MOVING A LOT MOVES WHAT IS INSIDE IT.** `moveGroupToZone` walked a herd's
membership so ten cows were one trip through the dialog instead of ten. Once
animals live inside a lot (8b), the same walk over the same shape gives lots the
same power — `moveLotsToZone` expands each lot to itself plus its members,
dedupes, and puts every one through `land`'s own `moveOccupant`.

**IT EXPANDS RATHER THAN ASKING THE CALLER TO.** Name the north field and the
three pens inside it come, along with the cow somebody named out of one of them.
A caller that had to list them would go stale the moment an animal was added,
and the whole point is that a lot moves as one thing.

**THE DEDUPE IS NOT TIDINESS.** "Move these two" where one is inside the other
would move the inner one twice on one day, and `moveOccupant` would end the stay
it had just opened. The lot page hits the same edge from the other side, which is
why the action moves the primary lot through the SINGLE path and only its
members through the bulk one — the single path is what returns `movedOff`, and
the toast's *"North Pasture is resting from…"* is the half of a move nobody sees.

### Mixed species: warned, never refused

The founder asked for a guard. **A hard refusal would have been the wrong one**,
for two reasons that outrank tidiness:

  - **It is real.** Pigs and poultry on one paddock, moved together, is a
    homestead's ordinary Tuesday. So is a nurse cow with orphan lambs.
  - **It would make the pilot farm unrepresentable.** Hilltop's "Cows" holds
    three swine and one cow *today*. A constraint that cannot describe the farm
    it was built for is describing something else.

So the add dialog says so before rather than refusing after — the same treatment
an unknown withdrawal period gets: state the fact, let the person decide.

### The headline numbers now tell on themselves

**A CONVERSION UNDER 1 : 1 IS NOT A MIRACLE PEN.** A pound of gain cannot come
from less than a pound of feed, so the farm-wide 0.94 : 1 on Hilltop means
**they are eating something this app has no record of** — pasture, which `land`
allocates as a zone cost and which the design deliberately never prices as feed.
`conversionWarning` says that, and says to read the figure as a **floor**. Not
hidden: hiding it throws away a real signal, and printing it bare invites
somebody to quote 0.94 : 1 to a neighbour.

**A YIELD OVER 100% IS AN UNWEIGHED INPUT.** Weight is not created by cutting an
animal up, so `production`'s 150% finished kill is an input nobody weighed, an
output weighed in its packaging, or somebody else's cuts on this run.
`yieldWarning` says which three to check. Also not refused — the yield fold
already rejects PARTIAL weights, so anything reaching this point was weighed on
both sides and the arithmetic is honestly reporting what was entered.

Both live in `core/` beside the figures they judge, both are pure, and both
return null when there is nothing to say so a caller renders them without a
second condition.

4 new ops tests, 4 new pure tests. **No migration.**


### 2026-08-28 — Slice 8f: a cow eats alone (`claude/a-cow-eats-alone`)

**The other half of the founder's feed rule** — *in a lot, feed is the lot's; on
her own, it is hers.* This pack had only the first half: the one feed control in
the module required a shared feeder, so **a cow standing on her own could not be
fed from here at all**, and every named animal on Hilltop Farm read `—` in every
feed column.

**NO MIGRATION, AND THE SLICE PLAN SAID THERE WOULD BE ONE.** The plan assumed
`livestock_feed_draws.feed_group_id` had to become nullable with a lot column
beside it. **It was wrong, and checking first is what found that.** Every part
already existed:

  - `inventory_movements.issued_to_lot_id` — *"WHICH LOT ATE IT. The join that
    closes the livestock costing loop"* — has been there since the loop was
    closed
  - `issueStock` has always accepted it
  - `core/feed.ts` has always read it as **measured** rather than allocated
  - `inventory`'s own stock screen has always offered a *"Fed to"* picker

**What was missing was never the data model. It was the door.**

**THE ONLY DIFFERENCE FROM A DRAW IS ONE NULL.** `recordFeedDraw` sets
`issuedToLotId: null` deliberately — *"NOBODY IS NAMED. That is what makes this
an allocated cost rather than a measured one"* — so `recordDirectFeed` is the
same function with somebody named. Same ledger, same stamping, same
`issueStock`.

**AND IT WRITES NO `livestock_feed_draws` ROW.** That table says which FEEDER an
issue was drawn for, and there is no feeder. A row with a made-up group would
put the cost into a head-days allocation as well and double it.

**Two doors, and the second one asks nothing.** The feed page's dialog gained a
choice — *A shared feeder* / *One by name* — leading, the way the lot form leads
with One animal / A lot. On an animal's OWN page the button passes no feeders at
all, so the dialog opens straight into *"Feed one"* with her already picked and
no toggle: on her page there is only one answer to "who ate it".

Driven on Hilltop Farm. Rosie went from *"$0.00 · Nothing fed to this lot yet"*
to **Fed · `Measured` · $30.67 · 25 lb**, and the feed page's By-lot row now
reads `Rosie · 1 · 25 lb · $30.67 · Measured`. The badge is the point: the cost
landed entirely on her rather than being spread by head-days.

3 new ops tests. **No migration, so nothing to apply to either database** —
worth saying out loud on a pack where the last four slices all carried one.


### 2026-08-28 — Slice 8c: a flock is not a cow (`claude/a-flock-is-not-a-cow`)

**One page was rendering two different things.** A named cow and a hundred
broilers went through the same component, so a flock got a Pedigree section, a
photo gallery promising *"a series over time shows the gradual change in this
animal"*, an offspring table headed *"Out of this animal"*, and a valuation card
reading *"what **she** cost to buy plus what has been spent raising **her**"*.

**THE COLUMN IS THE SLICE, AND IT IS THIS PACK'S FIRST DELIBERATE ONE.**
`livestock_lots.record_kind` — `'animal' | 'lot'`, NOT NULL DEFAULT `'lot'`,
CLOSED by CHECK. Everything else here is a fold, so the exception has to justify
itself.

**IT IS NOT DERIVABLE, AND DERIVING IT WAS ALREADY PRODUCING BUGS.** The obvious
rule is "one head means one animal", which the app was applying live on four
screens. It is wrong in both directions and both were observed, not imagined:

  - **A pen of three that loses two became an animal**, growing a pedigree page
    because the arithmetic moved under it.
  - **A breeding cow at zero head stopped being one.** Rosie on Hilltop Farm,
    2026-08-27: she lost her `named` badge and dropped out of the herd's
    "3 named" count while standing in a paddock.

**THE DIFFERENCE IS INTENT, AND SOMEBODY ALREADY STATES IT.** The create form has
asked *One animal* or *A lot* since 8a and threw the answer away. This keeps it.
That is precisely why a column is right here and wrong for head, withdrawal or
capital state: **those are facts about a DAY that later events restate, and this
is a fact about what the record IS.**

**The backfill uses the old rule once, on purpose.** `0230` sets `'animal'` where
the head balance is exactly one — the same rule every screen was applying — so
nothing's answer changes on the day it runs. What changes is that the answer
stops moving afterwards. On Hilltop Farm it produced exactly the right five
animals and four lots.

**What each page stops wearing.** Photos take the subject word (the component was
already parameterised and was always passed `"animal"`). The offspring table, the
tag empty-state and the valuation copy all branch. **Split** and **Record as
individuals** disappear from an animal — splitting one cow into two pens is not a
thing, and the button said otherwise. **In this lot** disappears too, because an
animal holds nothing.

**PEDIGREE AND BIRTHS STAY ON BOTH, deliberately.** It would have been easy to
call them animal-only and wrong: `livestock_lots`' own comment has said since 4a
that *"a parent need not be a lot of one — fifty layers are one lot, and 'these
chicks came from that flock' is both true and the only pedigree a flock will ever
have."* Stripping them would have regressed a decision, not tidied one.

**The same derived-from-head bug was in two more places** and is fixed with it:
`groupSummaries` counted a herd's individuals as `balance === 1`, and the herd
page's `named` badge did the same. Both now read the kind. That is why Rosie's
badge went missing, and it would have come back the moment she was sold.

**BOTH DATABASES ARE MIGRATED AND VERIFIED** — column present, CHECK present,
and the backfill run: dev 5 animals / 4 lots, **production 1 animal / 2 lots**.
`verify-rls` cannot see a column or a data change, so those were checked
directly rather than inferred — the gap that made `0226` unprovable.

Migrations `0229` (column + CHECK) and `0230` (backfill). 6 new ops tests, 2 new
isolation tests, including the two regressions the column exists to prevent.


### 2026-08-28 — Slice 8b: animals live in a lot (`claude/animals-live-in-a-lot`)

**The slice the founder actually asked for**, and the one that makes
[The model, settled](#the-model-settled-2026-08-27) true in the data rather than
only in the copy. `livestock_lot_members`, migrations `0227` and `0228`.

**A LOT HOLDS ANIMALS AND SMALLER LOTS, AND BOTH SIDES OF THE TABLE ARE
`livestock_lots`.** The founder's call, taken as a question before anything was
built: a herd held LOTS, so if a lot could only hold individual animals then
herds were not redundant after all and 8d would need a mechanism of its own.
Three broiler runs standing in one field stay THREE lots — per-lot feed
conversion is this pack's headline number and merging them would destroy it —
while still being one thing somebody walks to the next paddock.

**NAMING A COW OUT OF A PEN NOW LEAVES HER IN IT.** This is the bug the whole
slice exists for. `splitLivestockLot` carried her species, her sex, her birth
date, her breeding and both parents across — and dropped her out of her group,
so *"create lots and then add individual animals to it"* was undone by the only
mechanism that could have produced one. The split now writes the membership.

**AND SHE KEEPS EATING.** The same split dropped her FEEDER membership, and
allocation is head-days over feeder membership — so naming a cow out of a pen
that was on the bin silently stopped her accruing any feed cost at all. Carried
now, and **from the split date, not from when the pen went on the bin**: the
pen's own share already counted her before today, and backdating would charge
her twice over the same days.

**ONE LEVEL DEEP, AND WHICH LOT A SPLIT JOINS FALLS OUT OF IT.** If the pen is
itself inside a field, a cow named out of the pen joins the FIELD — joining the
pen would make her a grandchild and there is no such thing here. Two refusals in
`addLotToParent` keep it that way: a member may not hold things, and a holder may
not be a member. Both live in the write path because a CHECK cannot see other
rows, the same division of labour as the pedigree loop check.

**THE HUB SHOWS THE TOTAL, NOT WHAT IS LOOSE.** A pen of 100 that has had four
cows named out of it is 96 loose plus four animals, and a row reading 96 would
say the farm had lost four. Members are folded into the count and excluded from
the flat list, so a named animal appears once — inside her lot — rather than
twice.

**A NEW TABLE RATHER THAN A RETARGETED ONE, and this deviates from what the
design section said.** It called for `livestock_group_members` to survive with
its parent FK moved to `livestock_lots`. That would have broken herds the moment
it shipped, and the same section requires them to keep working until 8d. The
SHAPE survived; the table did not. `livestock_groups` is still dropped in 8e,
and its rows want migrating to lots when it goes — a herd becomes a lot holding
what it held.

`lotsAvailableToJoin` takes **no date**, unlike every other read here, and says
so: it answers "what can go in right now", which is only ever about open
memberships, and a date it ignored would be a promise it does not keep.

**A TRAP 8A LEFT, FOUND BY DRIVING AND FIXED HERE.** Interpolating the tenant's
word mid-sentence ate the space beside it: the feed page read *"makes a bad
lotlook cheaper"* and *"what a lotcost to raise"*. `{expr}` with ordinary text
after it is NOT reliably spaced — an explicit `{" "}` on the side that touches
the expression is. Every other interpolation added in 8a ends its element
(`In this {lotWord}</h2>`) and was fine; only the two mid-sentence ones broke.
**Check the rendered page, not the source, whenever this word goes inside a
sentence** — 8c and 8d will both do it.

**BOTH DATABASES ARE MIGRATED AND VERIFIED** — dev and production each at 153
tables, every one RLS enabled, forced and with policies, before this was
merged. Recorded here because 4f's entry did NOT say so, and finding out
took four commands and a browser session.

Migrations `0227` (the table) and `0228` (RLS, member-wide like the herd table
it replaces). 8 new ops tests, 8 new isolation tests. Two existing isolation
tests changed from "tenant A has one lot" to two — the fixture needs a second so
one can go inside the other, and what those tests are about is that neither
belongs to the other tenant.


### 2026-08-28 — Slice 8a: the words (`claude/a-lot-is-a-group-of-animals`)

**Copy, labels and comments. No schema, no migration, no logic** — the first
slice of the ruling in [The model, settled](#the-model-settled-2026-08-27), and
deliberately the one that changes no behaviour at all.

**THE HEADER WAS THE DATA MODEL PRINTED AS A TAGLINE.** *"Every animal is a lot,
and an individual is a lot of one"* is now *"A lot is a group of animals. An
animal you name has a page of its own."* The old sentence was written for
whoever was building the tables and it ended up above the tenant's animals.

**"START A HERD" AND "START A GROUP" NO LONGER SIT IN ONE HEADER.** The lot form
called its group shape "a group", which is the literal fallback of the
`livestockGroup` label — so a homestead-profile farm saw two adjacent buttons
that created two different things and used one word between them. `LivestockLotForm`
now takes `word` like `HerdForm` already did, and reads *Start a lot* / *A lot* /
*Start lot* — or *Start a flock* for a tenant who says flock.

**A NAME, NOT A CODE.** The field was labelled *"Lot code"* over a placeholder
of `B-2026-04-15`, which tells a farmer to invent a barcode for a pen he already
calls the north pen. It is *Name*, placeholder *"e.g. North pen, Spring
broilers"*. **The column is still `inventory_lots.code`** and `inventory` still
calls it a code — the word is per pack, the storage is one.

**"BATCH" IS OUT OF THE PACK, INCLUDING THE COMMENTS**, and the comments are the
point: every user-facing "batch" in this pack was written by somebody reading a
comment that used it. `production` owns the noun — the farm profile labels a run
"Batch" — and `inventory` uses it for a stock lot, which made three meanings for
one word across three packs. 45 occurrences replaced.

**WHAT KEPT IT, and the distinction is the whole reason this was not one
regex:** `feed-controls.tsx` says batch about a DELIVERY of feed, which is
inventory's sense and correct; `ops.ts` has "ten batched ones", a different word
entirely. Both left alone.

The advisor's prompt and the digest's suggested questions changed too — an AI
told to say "your last batch averaged 5.4" will say batch to the farmer, which
is the copy leaking back in through the one surface nobody greps.

Driven on Hilltop Farm: the hub, the lot dialog in both modes, and the feed
page's *vs last lot* column. `tsc` and `lint` clean.

**Slices 8b–8f are untouched by this.** Herds still exist, animals still cannot
live inside a lot, and a lone animal still cannot be fed — 8a moved no data and
no behaviour, on purpose, so the rename can land before the structure changes.


### 2026-08-27 — Slice 4f: a cow is not inventory (`claude/a-cow-is-not-inventory`)

The last slice of 4, and the one the design has called the line between a
tracking app and an accounting one since 2026-08-13: *"The same animal is
inventory or a capital asset depending on its purpose… Moving an animal from the
market herd to the breeding herd is therefore an accounting event that must POST,
not a status checkbox. Most farm software treats it as a flag and quietly makes
the books wrong."*

**SO THERE IS NO FLAG.** Whether an animal is breeding stock today is a fold over
`livestock_capital_transfers` — the latest direction wins — for the same reason
the head count is a fold over movements and the withdrawal clock is a fold over
treatments. A boolean would stop agreeing with the journal the first time
somebody corrected a date, and the journal is the half that matters.

**THE ENTRY IS THE POINT, AND IT IS NOT THE ONE AN ORDINARY ISSUE WOULD MAKE.**
`postCapitalisation` posts **Dr fixed assets, Cr inventory**. The normal outgoing
path debits COGS, which says the cost was consumed — a farm that ran a breeding
cow through it would have expensed an animal it still owns and understated its
assets by her whole cost. The seam lives in `inventory`, names no pack, and would
serve a dealership moving a demonstrator out of stock unchanged.

**THE AMOUNT IS HER CARRIED COST**, through `carriedValue` — the same fold the
valuation screen uses, so the credit to inventory is exactly the figure that was
in stock a moment before and the two screens cannot disagree. Coming back, it is
**net book value**: depreciation has been running, and putting her back at cost
would re-create value the books have already written off.
