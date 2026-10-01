# Fitness

> The first tool in a person's [personal space](personal-space.md): follow a
> program somebody gave you, or one you built, from the first day to the last,
> on a phone on the floor beside you. The exercise demo plays in the app, the
> breaths are counted for you, and the program's own rules (how many days before
> the next phase, how hard to try) are kept by the app rather than by memory.
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-30 — The posture pages locked to this site (`claude/posture-lockdown`)

Every page under `/personal/m/fitness/posture` now carries a content security
policy that lets it, and the pose worker, reach only this site and Clerk, and
moving into or out of those pages from the rest of Workouts is a full page
load, so the policy never follows the person to a program page and its
videos. Nothing else in Workouts changed. All of it is in
[posture.md](posture.md) and
[ADR 0122](../decisions/0122-the-posture-pages-are-locked-to-this-site-and-loaded-whole.md).

### 2026-09-30 — A posture check at a program's start and each phase's end (`claude/posture-3c`)

The program page asks for a posture check, for a person who has taken one
before: in the next phase's gate box (`NextPhaseOpen` gains a `posture` slot,
beside F4b's tests nudge), in a new box for a last phase whose days are in
(`LastPhaseDone`, shown only with a mark to carry), or above Start (the
program's start, or the end of the phase just left). The Today card on the
Workouts home gains a line when one is due. The gate boxes say which check
marked their phase once one has. The marks are worked out from the sessions
and the checks, like F3's progress: no workout table or column changed. All
of it is in [posture.md](posture.md) (slice 3c); the guides are
[program.md](../help/fitness/program.md#posture-checks-along-the-way) and
[overview.md](../help/fitness/overview.md).

### 2026-09-30 — Posture repeat checks and slipped stickers (`claude/posture-3b`)

`fitness_posture_checks` gains `repeat_of` (0436): a posture check can repeat
another with the stickers put back on, to learn the person's own noise, and a
check stops for a sticker that moved since last time. Everything about it is in
[posture.md](posture.md) (slice 3b) and
[ADR 0121](../decisions/0121-a-persons-own-noise-comes-from-repeat-checks-and-a-slipped-sticker-is-put-back-before-it-is-measured.md).
No workout table changed.

### 2026-09-30 — Posture checks in the account (`claude/posture-history`)

Workouts gains its eleventh table, `fitness_posture_checks` (0434, RLS 0435):
a posture check's numbers, kept in the personal space so every device shows
the history, with a comparison and a trend per measure. Everything about it is
in [posture.md](posture.md) (slice 3a) and
[ADR 0120](../decisions/0120-a-posture-check-is-kept-as-what-the-phone-measured-and-read-again-every-time.md).
No workout table changed.

### 2026-09-30 — The posture check itself (`claude/posture-standing-check`)

The posture page gains **Start a posture check** and **Your checks on this
phone**, and two screens under it: the check
(`/personal/m/fitness/posture/check`) and a check's report
(`/personal/m/fitness/posture/checks/[checkId]`). Everything about them is in
[posture.md](posture.md) (slice 2). Nothing in workout mode or the database
changed; a check and any photo it keeps live on the phone that took it.

### 2026-09-30 — Workout mode's buzz and screen in the app (`claude/app-camera`)

App 1.0.8, made for the posture check's camera ([mobile-app.md](mobile-app.md)),
also carries what workout mode was waiting on: the VIBRATE permission, so the
pacer's buzz can work inside the app, and the KeepAwake plugin, which
`useWakeLock` now uses inside the app in place of the WebView's Screen Wake
Lock (a browser still gets the Screen Wake Lock). Nothing else in workout mode
changed. Neither has been felt or watched on a phone yet (Open items).

### 2026-09-30 — The posture check begins (`claude/posture-setup-check`)

The Workouts page gains a **Posture check** card (between Today and Your
programs) that leads to `/personal/m/fitness/posture`. The posture check has
its own dossier, [posture.md](posture.md), with its plan, its slices and this
first one's build log (checking the setup on the person's phone), and two ADRs:
[0118](../decisions/0118-a-posture-checks-pictures-never-leave-the-phone.md)
and [0119](../decisions/0119-a-posture-measure-is-read-from-stickers-and-reported-against-yourself.md).
Its code lives under `src/modules/fitness/posture/`, behind the same
`requireModuleEnabled(…, "fitness")` gate, so it previews exactly where
Workouts does.

### 2026-09-29 — F4c: an exercise's levels, and moving up (`claude/fitness-f4c`)

The last of F4. His program starts the calf raise at a first level and says
when to move on (a number of good sets without much fatigue), but it names
the levels nowhere in its words: they are only shown in the exercise's video,
which the app cannot watch (YouTube also answered a bot check when its page
was fetched for chapters; nothing tried to get past it). The founder approved
a mockup with four calls: **he names the levels** in the editor, each with the
part of the video that shows it; the app suggests moving up after **the first
session that makes the mark**; it does so **right after the exercise and on
the program page**; and **a level can be gone back to**.

**Migration `0433`**: `fitness_phase_items.progression` (jsonb),
`fitness_enrollments.levels` (jsonb), `fitness_session_exercises.level` and
`level_up`, and a range check. Additive only. On dev; production on his word,
before the merge. No new table: `verify-rls -- --dev` passed (255 tables).

- **The model** (`core/levels.ts`, pure): an item's levels (a name and a part
  of the video each, two to twenty) and its mark, `sets` × `target`, on each
  side for an exercise done per side. `markMade` adds the rest: effort no
  higher than the program's top, and nothing hurt; an effort or hurt left
  unanswered makes no mark. The person's level is on the enrollment, by item
  (`levelOf`: the first until one is saved, never past the last).
- **The editor**: `Levels` on an exercise, `Add levels` (two to start, the
  mark from the exercise's own fewest sets and the top of its count, which on
  his calf raise is exactly the book's 2 × 15), a name and `Plays … to …` per
  level, `Add a level`, `Move up after … sets of …`, `Remove levels`, and
  their messages.
- **The program page**: an exercise with levels says `Your level: Level 1 of
  3`, with `Move up` and `Back a level` (`setLevelAction` → `setLevel`), the
  line `Ready for Level 2: your last session did 2 × 15 at Level 1, effort 3,
  nothing hurt.` when its latest go at this level made the mark
  (`latestTries`), and its video playing the level's part (`levelClip`).
- **Workout mode**: `sessionPlan(…, levels)` gives the item its level, the
  demo that level's part; the start screen and the set screen say the level;
  the coach names it after the exercise on its first set. After the exercise,
  once effort and hurt are answered and the sets make the mark, a box offers
  `Move up to Level 2` or `Not yet`. The choice rides in the session document
  (`levelUp` on the exercise) and `saveSession` applies it, so it works with no
  signal; `level_up` on the row makes that happen once. A set of reps at a
  level starts at the set before's count, so the climb to 15 is tapped once.
- Guides: `editor.md` (levels, how to add them, their messages),
  `program.md` (`Your level`), `workout.md` (the level, the box, the count).
  Guide icon: `trending-up`. The draft never reads levels (a program shows
  them in its videos); the book's rule stays in the exercise's notes.

**Driven** on a production build against dev, on his program:

- The editor at 375 px: `Add levels` on the calf raise gave `Level 1` and
  `Level 2` and the mark `2` sets of `15` reps, each side; `Add a level` a
  third; level 1 given `0:05` to `0:30`. Saved (`Program saved`).
- The program page, phase 3: `Your level: Level 1 of 3` with `Move up` only,
  the video `Tap to play here · 0:05–0:30`. `Move up`: `Now on Level 2`, both
  buttons, the whole video. `Back a level`: `Now on Level 1`, the part again.
- A workout on phase 3: the start screen and the set said `Level 1 of 3`; the
  first set's count started at 6 and, tapped to 15, the left side and set 2
  started at 15. After the exercise the box stayed away until effort (3) AND
  hurt (No) were answered, then said `2 × 15 at Level 1, effort 3, nothing
  hurt. That's the program's mark to move on.`; `Not yet` and `Move up` each
  said what they do. With Move up and Next, the program page read `Level 2 of
  3` once the session was sent.
- Back a level on the card: `Ready for Level 2: your last session did 2 × 15
  at Level 1, effort 3, nothing hurt.`
- Dev's calf raise had its levels removed after, through the editor; the
  drive's phase 3 session stays.

Tests: `tests/fitness-levels.test.ts` (new, pure: the ladder, the level, the
mark and its words), `tests/fitness-session.test.ts` (a go at a level, and a
move up kept only when there is a next), `tests/fitness-coach.test.ts` (the
level named on the first set), `tests/fitness-core.test.ts` (the editor both
ways and its messages), `tests/fitness-ops.test.ts` (db: levels saved and
loaded, each level's part played, `setLevel` and its refusals, a workout's
move up applied once however often it is sent and not again after going back
a level — proven to bite with the guard taken out — and `latestTries`).

### 2026-09-29 — F4b, part 2: taking the tests, and one-sided workouts (`claude/fitness-f4b2`)

The second half of F4b. The founder approved an interactive mockup with four
calls: **the flow as drawn** (a `Your side` card on the program page, the
author's video, one test at a time, the result with what each answer points
to, Save, and redo any time), answers **`Left`, `About the same`, `Right`**
(the same points nowhere), the nudge in **the card and the phase 2 gate box**,
and **no per-session override** (retaking the tests is the way to change it).

**No migration.** Part 1's `0432` made the columns this writes
(`fitness_enrollments.side`, `side_answers`, `side_assessed_at`), and a
one-sided set needs nothing new (below).

- **Taking the tests**, `/personal/m/fitness/programs/[id]/side`
  (`components/side-tests.tsx`): the video (`VideoPlayer`), then one test at a
  time with a bar, `Back` (the earlier answer highlighted) and `Watch the video
  again` (answers kept; `Back to the tests` resumes at the first unanswered),
  then the result: `You lean left` or `No clear side`, how the tests add up,
  each answer with where it points (`Right went further → Left` on a reversed
  test), `What changes`, and `Save my side` or `Save the result`.
- **`saveSideAction` → `saveSide`** (`side-ops.ts`): the answers only; the side
  is worked out on the server from the program's own tests, and kept with the
  answers by test name. Taking the tests before any workout starts following
  the program (the enrollment, from that day), as a first session would.
- **The `Your side` card** (`components/side-card.tsx`) under Reminders: before,
  what the tests are for and `Take the tests`; after, `Your side: Left` with
  how many tests point that way (`savedCounts`; only the date, once the
  program's tests have changed since) and each one-sided exercise's side, or
  `Your side: none clear`; `Redo the tests`.
- **The gate box** (`NextPhaseOpen`) says the next phase's one-sided exercises
  and links the tests while they are untaken.
- **One-sided workouts.** `sessionPlan(program, phase, lean)` makes an
  exercise the program does on one side for someone who leans NOT `perSide`,
  with its `onlySide` and `sideMeans`; everything downstream then counts and
  words it as it should: a set is one set, "per side" and "each side" drop
  away. `nextStep` gives each set that side (`sidesOf`), and the phone's
  document keeps it on the exercise (`onlySide`, optional, like
  `plannedSets`). The set line says `Lying on your left side` and `One side
  only: you lean left.`; the coach says the side every set and never "Now the
  left side"; the start screen names the side under the exercise; the program
  page's exercise card says `Lying on your left side only, because you lean
  left.`. An exercise begun on both sides before the side was saved finishes on
  both.
- Guides: `side.md` (new), `program.md` (the card, the gate box's line, the
  exercise line), `workout.md` (a one-sided set, what the coach says, the start
  screen; and its example exercise, one of his book's, is an invented one
  now), `editor.md`, `read-again.md`.

**Driven** on a production build against dev, on his program, in a pane tab
never in front:

- The card before the tests: `This program has 5 quick tests…` and `4
  exercises in phases 2 to 4 change once your side is known.`
- The tests at 375 px as drawn. Left, right, left, left, right: `You lean
  left`, `5 point left, 0 point right`, the two reversed tests showing `Right
  went further → Left`, and the four exercises' sides. `Back` highlighted the
  earlier answer; the video step offered `Back to the tests` and resumed at
  test 3. Saved: the card read `Your side: Left` and `5 of 5 tests point left.
  Taken Sep 29.`
- Phases 2–4 of the program page: each one-sided exercise's line with its
  reason, and its prescription without "per side".
- Workout mode on phase 2: the start screen listed the pullback as `2 × 5
  breaths`; skipping the first exercise, its set read `Set 1 of 2 · Lying on
  your left side · 2 × 5 breaths` and `One side only: you lean left.`. The
  start screen's side line, added after, showed `Left leg on top` on phase 3.
- All `About the same`: `No clear side`, `Save the result`, the toast `Saved.
  No side is clear, so every exercise stays on both sides.`, and the card
  `Your side: none clear`. The intro had said `Taken Sep 29: you lean left.`
- The gate box's nudge, with phase 1's days set to 1 and the side cleared on
  dev for the check (both put back): `Phase 2: Weeks 3-4 has 2 exercises done
  on one side. Take the tests first, to find yours.` and `Take the tests`.
- Dev was left with his side saved as left, and one unfinished phase 2 session
  from the drive (one exercise skipped).

Tests: `tests/fitness-side.test.ts` (the answers, `savedCounts`, `onlySideOf`,
`oneSideLine`, `phasesWords`), `tests/fitness-session.test.ts` (a one-sided
exercise walked: every set on its side, counted once, kept through a reload;
one begun on both sides finishing on both), `tests/fitness-coach.test.ts` (its
words each set, fetched ahead, and none of the two-sided ones),
`tests/fitness-day.test.ts` (its sets make the day), `tests/fitness-ops.test.ts`
(db: the side worked out and saved by name, the enrollment it starts, a second
result replacing the first, the refusals; `sessionPlan` with a side, and a
one-sided session saved and counted).

### 2026-09-29 — F4b, part 1: the side self-assessment and one-sided exercises, in the program (`claude/fitness-f4b`)

F4b ships as two PRs, as the founder was told before the build: this one puts
the side self-assessment and the one-sided exercises IN THE PROGRAM, read from
his PDF into the program he already follows; the next takes the assessment and
runs one-sided workouts. His two calls: **read the tests from the PDF, the
table's picture too** (the table is an image), and **each test is answered with
which side went further**, the app applying the table.

**Migration `0432`** (two enums, five columns, a CHECK), on dev; production on
his word, before the merge. No new table, so no new policy and no isolation
change; `db:verify-rls -- --dev` passed (255 tables).

- **The model.** `fitness_programs.assessment` (jsonb: the video, how many
  tests must agree, each test's name, question and `leftMeans`, notes).
  `fitness_phase_items.side_rule` (`both` / `toward` / `away`, default `both`)
  and `side_means` (`side` / `lying` / `top_leg`), with a CHECK that only a
  per-side item takes a rule. `fitness_enrollments.side_answers` and
  `side_assessed_at`, which part 2 writes.
- **`leftMeans` is the table in one field**: the side a test points to when the
  LEFT side went further. The person says what they saw, and `assessedSide`
  counts it, reversed tests and all (`core/side.ts`, pure). `sideFor`,
  `sideWords` (`Lying on your left side`, `Left leg on top`) and `ruleWords` are
  what part 2's workouts will say.
- **A page whose table is a picture is sent as a picture**
  ([ADR 0117](../decisions/0117-a-page-whose-table-is-a-picture-is-sent-as-a-picture.md),
  amending 0112): its words say "table" or "chart" (not "table top") and it
  draws an image; rendered on the device at 1,100 px as a JPEG; at most four,
  2.4 MB of base64 together, under the 4 MB an action takes (`pictureFits`, and
  the schema again). His PDF sends one page of 59. Both screens' lock line
  says so, and the import's reading line ends `, and 1 page as a picture`.
- **The draft reads them**: `record_program` gains `assessment` and each item's
  `sideRule` and `sideMeans`, taught by `ASSESSMENT_INSTRUCTIONS`, which
  describe such a table in words of our own and quote nothing of his book.
- **Read the PDF again** (`/personal/m/fitness/programs/[id]/read`, a button on
  an imported program): the same reader, a second tool (`record_additions`: the
  assessment, and the one-sided exercises named as the program in the app lists
  them, once per phase), `mergeAdditions` (by phase and name, else by a name
  only one exercise has; anything else reported, never guessed onto another),
  and the editor opened on the result, with its version. Nothing is written
  until Save, and the log stays with the program. Its failures have their own
  words (`READ_AGAIN_WORDS`: `Nothing was changed.`, never the import's advice
  to build the program by hand).
- **The editor**: a `Side self-assessment` card between the program's fields
  and the phases (the video, each test with which way it counts, how many must
  agree, notes), and on a per-side exercise `Side, once yours is known` and
  `That side is`, with what a workout will say for someone who leans left.
  Unticking `Per side` puts the exercise back on both sides.
- **The program page** gives each one-sided exercise its rule: `For someone who
  leans to a side: lying on the side you lean toward. Otherwise both sides.`
- Guides: `read-again.md` (new), `import.md`, `editor.md`, `program.md`, and
  `overview.md`, whose examples had been his book's title and two of its
  exercises in a tenant-facing guide since F3 (now the invented program's).
  Guide icon: `arrow-left-right`.

**Driven** on a production build against dev, on his program, in a pane tab
that was never in front, with his PDF served from the scratchpad to that origin
only (never in the worktree):

- **The first read stopped at `Reading page 15 of 59…` for over a minute.**
  pdf.js paces a `display` render on animation frames, which a tab in the
  background does not get; page 16 is the table. The picture is rendered as
  `print` now (a printout is what it is), and the next read took about a
  second for all 59 pages and the picture, in the same hidden tab. A phone
  switched to another app mid-read would have stalled the same way.
- **The first read matched none of the four one-sided exercises.** The prompt
  listed each as `Name (per side)`, and Claude named them that way. The prompt
  marks it `[per side]` now and says to leave it out, and the merge ignores the
  note in either bracket.
- The second read answered 10 s after the reading: `A side self-assessment,
  with 5 tests.` and `4 exercises done on one side, for someone who leans to a
  side.`, with no warning. The five tests, each counted the way the table says
  (the two reversed ones included), 3 to agree, the video `plays here`: the
  same as the first read, wording aside. The four exercises, in phases 2–4,
  with the book's rules: two by the side lain on (one toward, one away), two by
  the leg on top (toward). Every other per-side exercise stayed on both sides.
- At 375 px the card and the side fields fit, with no sideways scroll.
- Saved on dev (`Program saved`): phases 2–4 of the program page show the four
  rules' lines. Dev's program keeps them, for part 2.
- A fresh import of the same PDF (the import line: `Read 59 pages and 40 links,
  and 1 page as a picture`) drafted the same self-assessment and the same four
  rules in about 80 s. The draft was discarded.

Tests: `tests/fitness-side.test.ts` (new, pure: a test's answer, the side the
tests agree on, a one-sided exercise's side and words),
`tests/fitness-read-again.test.ts` (new, pure: the merge by phase, by a unique
name, through the per-side note, and what it reports; the assessment read; the
failure words; the prompt), `tests/fitness-core.test.ts` (the draft's
assessment and sides, the save's rules, the editor both ways, `pointsToPicture`
and "table top", the pictures' number and size), `tests/fitness-ops.test.ts`
(db: an assessment and sides saved and loaded; the CHECK refusing a side on an
exercise not per side; `readAgain` writing nothing, keeping every id, and its
failures' words).

Older entries (F4a, F2d, F3, F2c, F2b, F2a, F1 and the plan) are in [fitness-build-log.md](fitness-build-log.md).

## What his program demands of the model

A generic set/rep tracker cannot run this program. Each row below is a rule in
the PDF and the part of the model that keeps it.

| The program says | So the model has |
| --- | --- |
| Four phases of two weeks, in order, and "complete at least 14 days of the given exercises before moving on" | Phases with a `min_done_days`, counted in **done days**, not calendar days. A missed day moves the gate, not the calendar |
| Most drills are counted in **breaths** ("2 × 8 breaths per side"), some in reps, the release sequence in rolls | A unit per exercise: `reps`, `breaths`, `rolls`, `seconds` |
| "Per side" on most rows | `per_side`, and a set logged per side |
| Ranges: "2–3 × 8–10", "5–8 slow breaths", "2+ sets" | `sets_min`/`sets_max` and `target_min`/`target_max`; the minimum is what counts a day done |
| Sets may be split: "1–2 in the morning, 1–2 at night" | More than one session a day; a day is done when its sessions together meet every item's minimum |
| Effort "3/10, never beyond 5/10": the author calls trying too hard the biggest mistake | Effort logged per set, and a warning when it runs above the program's ceiling |
| Every exercise has "How to know you're doing it right" (three or four cues) | `cues` on the exercise, shown during the set and ticked after it |
| A video link on every exercise, a playlist per phase | A video on the exercise, played inline |
| A five-test self-assessment says which side you are "lateralized" to, and changes four exercises in phases 2–4 to one side | The assessment on the program (each test with `leftMeans`, the side it points to when the left went further), the person's side on the enrolment, and a side rule on the item (`both`, `toward`, `away`, and what the side is: the side, the side lain on, the leg on top). Until the assessment is done, both sides, which is the program's own default |
| Calf raise progression: "move on once you can do 2 sets of 15 perfect reps" | Levels on the item, each with the part of the video that shows it, and the mark for moving up (F4c; the book shows the levels only in its video, so the person names them), and a suggestion when the log meets it when the log meets it |
| An optional exercise ("if you have extra time"), and alternatives ("I like this one more, but most people don't have the equipment") | `optional` on an item, and an alternative that can be swapped in |
| Sessions 3–4 a week ("3 is good, 4 is great, 5 is even better") | A weekly target on the program |

Nothing above is specific to this author. Each is a rule a program states;
another program states its own. **A shipped program template must never carry
this author's content**: it is copyrighted and bought, and it lives only in the
person's own space, the way a pack must never carry one business's price list
(AGENTS.md, the Discovery prompt rule).

## The slices

| # | Slice | Done when |
| --- | --- | --- |
| F1 | **The program, imported** | His PDF goes in; a draft program comes back (phases, exercises, sets, units, cues, videos); he corrects it and saves it; the program page plays every video inline |
| F2 | **Workout mode** | "Start today's session" runs the day one exercise at a time with the video looping, the breaths paced and counted, the sides switched, every set logged, and the screen awake |
| F3 | **Progress and the gate** | Done days per phase, the week against its target, the effort warning, how he felt before and after, and the next phase opening at 14 done days |
| F4 | **Fitting it to him** | The side self-assessment, progressions and their nudges, morning and evening split with reminders |
| F5 | **Your own workouts** | An exercise library and a builder, for strength as well as mobility: weight, rest timer, last time's numbers, personal bests |
| F6 | **Hands-free** | "Next", "done", "again" said aloud, for when you are lying on the floor |

### F1 — the program, imported

Built 2026-09-27; the build log has the detail. Where the build moved from the
plan is said in place below.

- **The first personal tool, so it brings the plumbing P0 left for it**
  ([personal-space.md](personal-space.md)): the `/personal/m/[slug]` route
  that renders a personal tool (`requirePersonalSpace` +
  `requireModuleEnabled`, whose gate already refuses a tool in the wrong kind
  of workspace), the rail loop in `src/app/personal/(space)/layout.tsx`, a
  `fitness` catalogue row with `category: "personal"`, and the seed run on
  both databases. The seed also switches it on in every existing personal
  space, and the day that row is `available` the `Personal space` door opens
  for everybody (`personalSpacesOpen`). **As built, the row is `coming_soon`**
  (the founder's decision: his space only until workout mode), which the seed
  does not switch on anywhere; a superadmin's own space previews it instead
  (`ensurePersonalToolsSql`'s `preview`, passed by `/personal/open`).
- **The PDF is read on the device** (the plan said the server). pdfjs in the
  browser takes each page's text AND its link annotations. Documents' extracted
  text is not enough: it drops the annotations, and every video URL in this PDF
  is an annotation (29 distinct YouTube videos and four playlists). Only the
  words and links are sent: his PDF is 19.3 MB and a server action takes 4 MB,
  and a book somebody bought does not need uploading to be read. The pdfjs
  loader moved out of Documents into `src/lib/pdf/browser.ts`, which both use.
- **Claude drafts the program** through `getClaude()`, from the pages and their
  links, into a draft the editor opens: program, phases, items, exercises, cues,
  videos per exercise. The PDF's headings are letter-spaced
  (`E X E R C I S E`), which a model reads and a regex does not.
- **An exercise's video is the link on its own page**, not one on a phase
  overview. In his PDF the phase 4 overview carries a link to a video that no
  longer exists, while the exercise's own page links a working one.
- **The draft is never the program.** The person reviews it on a screen laid
  out like the program (phase by phase), fixes a range or a unit, and saves.
  Nothing is written to the program tables before that. The same rule the tell
  box lives by (ADR 0054: draft, never send).
- **The program page**: phases in order, each exercise with its purpose, its
  cues, its sets and its video, playing in the page.
- **Hand entry** is the same review screen started empty. It is F5's builder in
  its first form, and it is what a person with a program on paper uses. As
  built, the same screen is also how a saved program is edited.

### F2 — workout mode (the during-the-workout tool)

The screen you use with sweaty hands, from the floor, a metre away. Every idea
below is for that person.

- **One exercise at a time, full screen**, huge targets, the whole screen a
  "set done" button when the timer is not running. Dark by default.
- **The demo loops above the count.** The exercise's video, muted, looping the
  part that shows the movement, at the speed you choose (0.5×, 0.75×, 1×). Tap
  for sound and the full clip.
- **A breath pacer**, because most of this program is breaths. A circle that
  shrinks on the exhale (5 s, "long, relaxed, through the mouth") and grows on
  the inhale (5 s, "even softer, silent"), the count in the middle, a soft tone
  or a spoken word on each turn, a buzz at the end of the set. The set finishes
  itself at 8 breaths. The pace is the program's (5 s / 5 s) and editable.
- **A tempo for slow movements**: the release sequence says "about 1 inch per
  second, 15 slow rolls"; a gentle metronome counts them.
- **Cues spoken mid-set.** One of the "doing it right" cues read aloud halfway
  through ("keep your low back relaxed"), because you cannot read a screen with
  your face on the floor. Uses the speech layer the tell box already has
  (`src/lib/speech/say.ts`, which falls back to the native plugin in the app).
- **Sides handled for you.** "Now the left side", announced; the count resets;
  the log knows which side it was.
- **After each exercise, three taps**: effort (1–10, the program's 3–5 zone
  shaded green), which cues you felt (ticked), and anything that hurt (a pinch
  in the hip is worth knowing about by week three).
- **How do you feel, before and after.** The author promises "some improvement
  immediately following your exercises". A 0–10 "how does your body feel" before
  the first exercise and after the last, charted, shows him whether it is true
  for him, which is the thing that keeps a person going in week two.
- **The screen stays on.** Screen Wake Lock in the browser; in the app, a check
  that the WebView honours it, and the native keep-awake plugin if not (a new
  plugin is a new app build, [mobile-app.md](mobile-app.md)). The plugin came
  with app 1.0.8 and `useWakeLock` uses it inside the app.
- **Split days are one tap.** "Morning: 1 of 2 sets" on the home card, and
  starting a session in the evening picks up where the morning stopped.
- **A session survives a dropped signal.** Sets are held on the device and sent
  when the connection comes back, the way a device grant's offline queue is
  (ADR 0048's idempotency key per set).

#### F2 as it is being built

The founder approved the four screens from a mockup (2026-09-27: the feel
check, one exercise at a time with the pacer, the three taps, the finish) and
the order **F2a the session → F2b the coach's voice and the looping demo →
F2c split days**. His call on counting: **reps and rolls confirm the target**
(Done records it, minus for a set that came up short); breaths are the
pacer's. The build log has F2a, F2b and F2c; F2 is built. Where it moved
from the list above:

- **Big buttons, not the whole screen as one.** A screen-wide "set done"
  target was too easy to hit by accident while getting into position; the
  first set of an exercise waits for Start, and every later set counts down
  five seconds and starts itself (breaths and holds).
- **No roll metronome.** Rolls confirm the target instead (his call), so
  nothing needs to keep their tempo.
- **One cue a set, shown and said at one moment.** F2a shows one of the
  exercise's checks in large type, changing each set. F2b says it once, as the
  middle breath starts or halfway through a hold, through ONE voice queue
  ([ADR 0114](../decisions/0114-a-workout-has-one-voice-and-a-line-knows-how-long-it-is-worth-saying.md)).
  `sayIt` cancels whatever it is saying on every new line, which is right for
  the tell box and wrong for a pacer, a cue and (later) the posture check's
  feedback ([posture.md](posture.md)) all wanting to speak in the same minute.
- **No spoken count, breath by breath.** The tones mark every turn. A number
  said every ten seconds for twenty minutes would nag, so the voice says only
  "Last one.".
- **"Tap for sound and the full clip" became `With sound`**: the clip once,
  from its start, at 1× with the sound on, then back to the loop. YouTube's
  own controls stay hidden in the loop, and the whole video is the program
  page's player.
- **The demo's buttons sit under the player, not on it.** YouTube's terms
  forbid anything drawn over a player.
- **Offline is a document, not an idempotency key per set**
  ([ADR 0113](../decisions/0113-a-workout-session-is-a-document-the-phone-keeps-and-sends-whole.md)).
- **Split days are a choice at the start, not a slot.** "Half now, the rest
  later today" plans the session's share, and any later session that day
  picks up what is left. Nothing stores "morning" or "evening": when in the
  day a session was is its start, on the space's clock. The home card says
  `Evening · 4 sets` and what is left, rather than "Morning: 1 of 2 sets",
  because a phase's exercises need different numbers of sets.
- **F2d, after the founder used it** (2026-09-27: "the video is really
  small. the voice starts talking and the video plays at the same time ...
  the voice sounds very robotic"): the demo spreads out on a wide screen,
  a new exercise's demo waits for the coach to finish, and the coach speaks
  in a recorded natural voice ([ADR 0115](../decisions/0115-the-coach-speaks-in-a-recorded-voice-fetched-ahead-and-kept-on-the-phone.md)).
  The build log has it.

The posture check (camera, feedback) is its own area with its own dossier,
[posture.md](posture.md), begun 2026-09-30. F2 built nothing camera-related
and left three seams for it, which its slice 5 (live cues during a workout)
uses: the exercise screen's top **stage** (the looping demo today, a camera
view during a set later), the one **voice** (built in F2b: `coachSay({ text,
priority: "high", key: "posture" })` cuts in on a cue or a count, replaces its
own unsaid last correction, and goes unsaid when more than two seconds late),
and the enrollment's **side**, where a left-or-right assessment lands.

### F3 — progress and the gate

Built (the build log has it). Where it moved from the list below: the streak
counts weeks on target, not days; the effort warning counts exercises, since
effort is given per exercise; there is no stored current phase, and moving
on is starting a session on the next phase; a phase whose gate has not opened
warns but is not locked (the founder's calls).

- **The phase bar**: "6 of 14 done days · Phase 2 opens when you reach 14".
  When it opens, a preview of the new exercises with their videos, and a
  button to move on; the app never moves you on its own, because the program
  says do not skip, not "leave on day 14".
- **The week**: sessions against the program's 3–4.
- **A calendar of done days**, a streak that forgives a single missed day (the
  program forgives it too: it only asks for 14 done days).
- **The effort warning**, in the program's own terms: "Two sets at 6/10 this
  week. The program says stay at 3–5."
- **Feel before and after**, charted by phase.

### F4 — fitting it to him

The founder's order (2026-09-28): **F4a reminders → F4b the side → F4c the calf
raise**, and F4b and F4c read what they need from his PDF again, into the
program he already has, so his logged workouts stay with it.

**F4a is built** (the build log has it). Where it moved from the list below: a
push only, not a line in the daily digest; a reminder skips a day that is done
and nothing more (he was offered "quiet for the week once its sessions are
done" and declined).

**F4b is built**, in two halves. The first put the self-assessment and the
one-sided exercises in the program, read from the PDF (the table's picture too,
ADR 0117) into the program he already has with "Read the PDF again". The
second takes the tests on the program's page and runs one-sided workouts.
Where it moved from the list below: each test is answered with which side went
further, and the app applies the table (`leftMeans`); a session never goes
back to both sides (his call).

**F4c is built**: an exercise's levels, named by the person from the video,
with a suggestion to move up after the first session that makes the mark,
right after the exercise and on the program page. **F4 is complete.**

- **The self-assessment**: the five tests as a short flow with the author's
  video, the answer (left, right or none) saved on the enrolment, and the four
  affected exercises switched to one side, each saying why.
- **Progressions**: the calf raise shows which level you are on and suggests
  the next when the log says so. You decide. (Built as F4c: after the first
  session that makes the mark, not the second.)
- **Reminders**: a chosen time for the morning and the evening half, as a
  push on the phone (Android push is proven; [mobile-app.md](mobile-app.md))
  and a line in the daily digest ([notifications.md](notifications.md)), where
  it clears by doing the workout: the test every digest source must pass.

### F5 and F6

F5 widens the same model to strength: an exercise can carry a load, a set logs
weight and reps, and workout mode gains a rest timer and last time's numbers,
with a personal best called out when you beat it. F6 is voice commands in
workout mode. Neither is designed further until F1–F4 have been used.

## Inline video

The founder does not want to leave the app to watch a demo.

- **YouTube is embedded, never re-hosted.** The program's videos are the
  author's, on YouTube. They play in YouTube's own embedded player from
  `youtube-nocookie.com`, which is what the author published them for;
  downloading and serving them ourselves would be copying them. F1 embeds the
  plain player behind a click-to-play picture (`video-player.tsx`), with
  `playsinline` so an iPhone does not force full screen and the clip's start
  and end in the URL. Workout mode's demo (F2b) uses the IFrame Player API,
  which adds loop, mute and speed (below).
- **Workout mode's demo is an API client, and keeps YouTube's terms for one**
  (Required Minimum Functionality, Developer Policies). It starts by itself
  only muted, and only while at least half of it is on screen. It pauses when
  it is not, or when the screen is off, which also rules out a background
  player. It is the only player on its screen. Every player here is at least
  200 × 200 px, the program page's included. Nothing is drawn over a player:
  the demo's buttons are below it. It calls only what the API reference
  documents. The API talks only to `www.youtube.com` unless the Player is told
  its `host`, which the privacy-enhanced player needs; `host` is not in the
  reference but is how every privacy-enhanced embed is driven. The loop is the
  page's: YouTube's `loop` replays a whole video and ignores the clip's
  start. The API is YouTube's own script (`youtube-api.ts`), loaded only by
  workout mode and only for a video that may be embedded. A page that cannot
  load it gets F1's player.
- **An exercise's videos** are a list of `{ provider, id, startS, endS, label,
  embeddable }` on the exercise (`fitness_exercises.videos`). The first is THE
  video; any other has a `label`. The import fills the id and a start from the
  PDF's link; start and end are the person's to set ("0:42–1:10").
- **A video the uploader has not allowed to be embedded** plays nowhere but
  YouTube. YouTube's oEmbed endpoint is asked about every video when a program
  is drafted, and about any video a save brings that nobody has asked about
  (`markVideos`), and such an exercise gets an `Open in YouTube` button
  instead of a dead player. The same answer carries the video's title, which
  names an unnamed second video.
- **Your own clip** (F5): a short video you recorded, uploaded to Blob storage
  and played with a plain `<video>` element, which can loop, slow down and be
  flipped left to right for the other side. A flip is NOT offered on YouTube
  videos: altering the embedded player is against YouTube's API terms.
- **Nothing blocks the frame today**: there is no site-wide
  Content-Security-Policy. The first one written must allow
  `frame-src https://www.youtube-nocookie.com`.
- **In the phone app**, the site is loaded from yosherapp.com, so the embed
  carries the referrer YouTube now requires. Capacitor's `allowNavigation` list
  governs top-level navigation, not frames, but this has not been watched on a
  phone yet: F1 is not done until a video has played inline in the Android app.

## Data model

Every table carries `tenant_id` with FORCE RLS (the two ordinary policies,
`0427`) and composite FKs `(tenant_id, x)`, all `on delete cascade`. The
first five are F1's (migration `0426`), the next four F2a's (`0428`),
`fitness_reminders` F4a's (`0430`, RLS `0431`), and F4b's columns and two
enums `0432`, and F4c's four columns `0433` (levels are jsonb on the item,
not the `fitness_progressions` table first planned). F2a's three keys from a log to the program it logged are the
column-list `ON DELETE SET NULL ("x")`, hand-written in the migration.

| Table | Purpose | Notes |
| --- | --- | --- |
| `fitness_programs` | A program: name, author, source (`imported` / `own`), notes (its rules in words), sessions a week and effort as ranges, the breathing pace (`breath_out_s`, `breath_in_s`, 1–30; F2a), `assessment` (jsonb, the side self-assessment: video, `least`, tests with `leftMeans`, notes; F4b), `archived_at`, `version` | `version` guards an edit from a second tab. One active at a time will be the UI's rule, not the table's |
| `fitness_phases` | Ordered phases (`position`) with `min_done_days` (1–365, or none) and notes | |
| `fitness_exercises` | name, purpose, cues (jsonb list), unit (`reps` / `breaths` / `rolls` / `seconds`), videos (jsonb list), notes | **`program_id` NOT NULL for now**: an exercise belongs to the program that made it. A library shared between programs is F5, and relaxing this column is where it starts |
| `fitness_phase_items` | An exercise in a phase: position, `sets_min`/`sets_max`, `target_min`/`target_max`, `per_side`, `optional`, notes | Ranges checked in the database (sets 1–20, count 1–1000, a top never below its bottom). `side_rule` (`both` / `toward` / `away`) and `side_means` (`side` / `lying` / `top_leg`), F4b: a CHECK allows a rule only on a per-side item. `progression` (jsonb: levels with their part of the video, and the mark), F4c. Alternative-of is F4 |
| `fitness_imports` | A PDF on its way to being a program: file name, pages, links, status (`drafting` / `draft` / `failed` / `saved` / `discarded`), the draft, the error, the program it became | Holds the draft json and the counts, never the book's text; the draft is dropped once saved |
| `fitness_enrollments` | Following a program: `started_on` (the person's own day), `side` (`left` / `right`, or none), `side_answers` (jsonb: each test by name and which side went further, F4b) and `side_assessed_at`, `levels` (jsonb: item id to 0-based level, F4c), `ended_at` | F2a. Made by the first session; one open per program (a partial unique index). No current phase: each session names its phase, and moving on is F3's gate |
| `fitness_sessions` | One workout: the phone's own id, its enrollment, its phase (and the phase's name, kept), `local_day`, started and finished, feel before and after (0–10), note, `revision` | F2a. `revision` only goes up, so a late older copy never undoes a newer one. A day can hold several: a split day is two or more (F2c). No morning-or-evening slot is stored; a session's part of the day is its `started_at` on the space's clock |
| `fitness_session_exercises` | An exercise as done in a session: its item and exercise, position, name, unit and per-side as they were, effort (1–10), the cues felt, `hurt` (`none` / `pinch` / `yes`) and where, skipped, finished, `level` (0–19) and `level_up` (F4c) | F2a. The three taps after an exercise live here, per exercise, not per set. `level_up` is set once and never unset, and the enrollment's level moves when it first arrives |
| `fitness_sets` | A set: its number, side, `target` (the least asked) and `count` (what was done), `done_at` | F2a. The id is the phone's, so there is no separate idempotency key. Load (weight) is F5 |
| `fitness_reminders` | A program's `morning` and `evening` reminder: `at_minute` (0–1430, in tens, on the space's clock), `enabled`, `last_handled_on` (the space's day the cron last took it) | F4a (`0430`, RLS `0431`). One row a slot (a unique index); the cron claims one by moving `last_handled_on`, so overlapping runs send it once |

## Key files & seams

- `src/db/schema/fitness.ts` — the ten tables, the enums, `FitnessVideo`,
  `FitnessAssessment`.
- `src/modules/fitness/core/` — the pure half: `youtube.ts` (links,
  timestamps, the embed URL), `program.ts` (the save's schema and rules,
  `prescription`), `draft.ts` (the `record_program` tool, the prompt,
  `normalizeDraft`, and which pages go as pictures: `pointsToPicture`,
  `pictureFits`), `editor.ts` (the editor's form, both ways), `errors.ts`.
- `src/modules/fitness/core/side.ts` — a person's side (F4b): `testPoints`,
  `assessedSide`, `savedCounts`, `sideFor`, `onlySideOf`, `sideWords`,
  `oneSideLine`, `ruleWords`, `phasesWords`, and `sideAnswersSchema`.
- `src/modules/fitness/core/levels.ts` — an exercise's levels (F4c):
  `progressionSchema`, `levelOf`, `markMade`, and their words.
  `src/modules/fitness/level-ops.ts` has `loadLevels`, `setLevel` and
  `latestTries`; `components/level-control.tsx` is the card's control;
  `levelClip` and the level on a plan item are in `program-ops.ts`.
- `src/modules/fitness/side-ops.ts` — `loadSide` and `saveSide`, on the
  program's open enrollment (F4b part 2). The screens:
  `components/side-tests.tsx` (the route `fitness/programs/[id]/side`) and
  `components/side-card.tsx` (the program page's `Your side`).
- `src/modules/fitness/core/read-again.ts` — reading a saved program's PDF
  again (F4b): `record_additions`, its prompt, `mergeAdditions`,
  `READ_AGAIN_WORDS`. `readAgain` is in `import-ops.ts`, `callAdditionsModel`
  in `draft-model.ts`, the screen in `components/read-again.tsx`.
- `src/modules/fitness/draft-model.ts` — the Claude calls: the draft, and
  reading again (F4b), the pages' pictures as image blocks.
- `src/modules/fitness/embeds.ts` — `checkVideo` and `markVideos`: YouTube's
  oEmbed answer (plays here or not, and the title).
- `src/modules/fitness/import-ops.ts` — `draftProgram` and the import's life.
- `src/modules/fitness/program-ops.ts` — `saveProgram` (by id, under
  `version`), `loadProgram`, `listPrograms`, `deleteProgram`.
- `src/modules/fitness/actions.ts` — the server actions, each behind
  `requirePersonalSpace` and the module gate.
- `src/modules/fitness/core/session.ts` — workout mode's pure half (F2a): the
  session document's schema, `nextStep` (where the session is, from what it
  holds), the changes (`beginSession`, `recordSet`, `oneMoreSet`,
  `finishExercise`, `skipExercise`, `finishSession`), `sessionSummary`.
- `src/modules/fitness/core/progress.ts` — progress and the gate (F3): done
  days per phase (`phaseDays`, `programDays`), `phaseGate`, the week
  (`mondayOf`, `weekCount`, `weeksOnTarget`), `calendarWeeks`,
  `effortWarning`, `feelOf`, and their words. `components/phase-progress.tsx`
  draws them on the program page, with the gate's two boxes.
- `src/modules/fitness/core/day.ts` — a day of a program (F2c): the ledger
  (`dayProgress`, `dayOf`), a split's aim (`aimFor`, `canHalve`), what the
  start screen says (`aimWords`), and the space's day and hour (`localDayIn`,
  `hourIn`, `partOfDay`).
- `src/modules/fitness/session-ops.ts` — `saveSession` (the database made to
  match a document), `lastSession`, `sessionCount`, `recentSessions` (a
  program's sessions on some days, full sets per item; `programSessions` for
  all of them, with each one's phase, feels and efforts) and `latestFollowed`
  (the Today card's program). `program-ops.ts` has `sessionPlan`, a phase as
  workout mode runs it.
- `src/modules/fitness/components/workout/` — the workout screen
  (`workout-screen.tsx`), `breath-pacer.tsx`, `hold-timer.tsx`,
  `confirm-count.tsx`, `feel-scale.tsx`, the phone's store
  (`session-store.ts`) and its sync (`use-session-sync.ts`),
  `use-wake-lock.ts`, `sound.ts` (the tones, the two switches and
  `coachSay`), `demo-loop.tsx` (the looping demo) and `youtube-api.ts` (the
  IFrame Player API, loaded once). `start-session-button.tsx` is the program
  page's Start/Resume/Do the rest, and `today-card.tsx` the Workouts home's
  Today card.
- `src/modules/fitness/core/reminders.ts` and `reminder-ops.ts` — workout
  reminders (F4a): the times, when one goes, what it says (pure), and the
  rows and the cron's run (`runWorkoutReminders`, behind
  `src/app/api/cron/fitness-reminders/route.ts`). `components/reminder-card.tsx`
  is the program page's card. `doorDestination` in
  `src/lib/personal-space-core.ts` is where a reminder's tap goes.
- `src/modules/fitness/core/coach.ts` — every line the coach says (F2b), and
  `sessionLines`, every line a session can say from where it is (F2d).
- `src/lib/speech/queue-policy.ts` and `voice-queue.ts` — the one voice
  (ADR 0114): the rules, pure, and the queue. Its engine (F2d) is a line's
  recording (`clips.ts`) or else `speakLine` in `say.ts`; `isVoiceBusy` and
  `subscribeVoiceBusy` are what the demo waits on.
- The recorded voice (F2d, ADR 0115): `src/lib/speech/voices.ts` (the four
  voices, the request's bounds, the answer's binary shape; pure),
  `synthesis.ts` (Deepgram, server-only), `clips.ts` (fetching ahead, the
  phone's Cache Storage, playing one), `src/lib/audio-context.ts` (the page's
  one audio context, shared with the tones), and the route
  `src/app/api/fitness/voice/route.ts`. `pickVoice` in `say.ts` picks the
  device's most natural voice for the fallback.
- `src/modules/fitness/components/` — `read-program-pdf.ts` (pdfjs on the
  device), `import-form.tsx`, `program-editor.tsx`, `program-view.tsx`,
  `video-player.tsx`, and the discard and delete buttons.
- `src/modules/fitness/FitnessModule.tsx` — the Workouts page.
- `src/app/personal/(space)/m/` — the tool's routes: `[slug]` (the front page),
  `fitness/import`, `fitness/import/[id]`, `fitness/new`,
  `fitness/programs/[id]`, `fitness/programs/[id]/edit`,
  `fitness/programs/[id]/read` (reading the PDF again),
  `fitness/programs/[id]/side` (taking the tests),
  `fitness/programs/[id]/session` (workout mode).
- `src/lib/pdf/browser.ts` — `loadPdfjs`, shared with Documents.
- `tests/fitness-core.test.ts`, `tests/fitness-session.test.ts`,
  `tests/fitness-coach.test.ts`, `tests/speech-queue.test.ts`,
  `tests/speech-voices.test.ts`, `tests/speech-say.test.ts` (`pickVoice`),
  `tests/fitness-side.test.ts`, `tests/fitness-read-again.test.ts`,
  `tests/fitness-ops.test.ts`, `tests/isolation/fitness.test.ts`.
- `docs/help/fitness/` — `overview.md` (`**Route:** /personal/m/fitness/**`),
  `import.md`, `editor.md`, `program.md`, `read-again.md`, `side.md`,
  `workout.md`.

## Decisions & gotchas

- **A done day, not a calendar day.** The gate counts days on which every
  non-optional item met its minimum across that day's sessions, in the
  personal space's own timezone.
- **The app never moves a phase on its own.** It says the gate is open.
- **Imported content is private.** No catalogue row, seed or test fixture may
  carry this program's exercises or text. A test fixture invents its own
  program (`Starter Mobility`, by `A. Coach`). The tests do use a few of the
  program's YouTube links and their titles, which are public, to test the
  link shapes the PDF really uses; no text from the book.
- **The book never reaches the server.** Only the words and links a draft
  needs are sent, with a picture of a page whose table is an image
  ([ADR 0117](../decisions/0117-a-page-whose-table-is-a-picture-is-sent-as-a-picture.md)),
  and the import row keeps the draft, not the text. The privacy line on the
  import and read-again screens says so, and it must stay true.
- **A prompt describes his program's shape, never its words** (F4b). The
  assessment instructions say how such a table reads in general; the first
  draft of them quoted his table's notation and a line of his book, and a
  comment named his tests. None of that is in the code now, and the fixtures'
  one-sided exercises are invented ones whose names are not in his PDF.
- **`0426` is hand-reordered.** Drizzle emits every foreign key before every
  index, and a composite FK onto `(tenant_id, id)` needs its unique index to
  exist first, so the five `*_tenant_id_id_idx` indexes were moved above the
  constraints (as `0379` and `0389` were). CI builds its database from zero, so
  a regenerated migration with drizzle's order would fail there first.
- **A raw `sql` count names its outer table in full.** `listPrograms` counts
  phases and exercises in correlated subqueries, and drizzle writes a column
  inside a raw fragment unqualified: a bare `tenant_id` there is ambiguous
  (42702). The subqueries say `fitness_programs.tenant_id`.
- **One video at a time is done by unmounting.** Starting a player turns the
  others back into their boxes. That needs nothing from YouTube's player API,
  and it costs a stopped video its place; F2's workout mode brings the API
  (loop, mute, speed) and can pause instead.
- **Only a row still `drafting` takes Claude's answer.** `finishImport` and
  `failImport` are guarded on the status, so a draft the person discarded as
  interrupted stays discarded however late the answer comes.
- **A session is a document the phone keeps and sends whole** (F2a,
  [ADR 0113](../decisions/0113-a-workout-session-is-a-document-the-phone-keeps-and-sends-whole.md)),
  not an event per set: the phone's own ids, a `revision` that only goes up,
  and the children made to match. The phone's store is a LIST of documents,
  so an unsent session from yesterday is never overwritten by today's.
- **A log outlives an edit, by column-list SET NULL.** The program stays
  editable after it has been done, so `fitness_sessions.phase_id` and
  `fitness_session_exercises.item_id` / `exercise_id` are
  `ON DELETE SET NULL ("x")`, hand-written in `0428` (a bare SET NULL would
  null `tenant_id` and can never run on a composite key). The schema says
  `.onDelete("set null")` and the snapshot records the same, so `db:generate`
  leaves them be. The names and units the log needs are kept on it.
  `saveSession` also stores a reference the program no longer has as null
  rather than refusing the workout.
- **A day is added up, never stored** (F2c). Its sessions, each with full
  sets per item, are the whole truth: nothing records that a day is done or
  that a session was the morning half. The phone adds the day up from the
  server's sessions and its own documents, sent or not, its copy of a session
  winning. So a split day works offline, and F3's done days will be the same
  sum.
- **Every set done counts toward the day** (the founder's call, 2026-09-27):
  12 of 15 rolls is one of the day's sets. The count stays on the log for F3
  to show a short set.
- **A day and an hour are the space's.** The pages ask for the space's today
  (`localDayIn(tenant.timezone)`), and "Morning" is the hour on the space's
  clock (`hourIn`), because the server renders these screens first and its
  own clock is not the person's. The finish adds up the session's own
  `localDay`, which the phone chose at Start.
- **Progress is worked out, never stored** (F3). Done days, the week, the
  streak, the warning and the feel all come from the sessions on each view of
  the program page or the Workouts home. So correcting a program (its minimum
  sets, its days) changes the past's arithmetic too, which is what a person
  correcting a mistake means.
- **Moving on is a session, not a switch.** The gate says the next phase is
  open and links to it. The program opens on the phase of the last workout,
  so the first session on the new phase is what moves the person on. Nothing
  locks: a phase whose gate has not opened says so above a Start that works.
- **A week runs Monday to Sunday**, for the week's count and the streak.
- **No current phase on the enrollment.** Each session names its phase; the
  program page opens on the last workout's phase. Moving on is F3's gate.
- **Timers read state through effect events.** The lint here is the React
  compiler's (errors: no setState in an effect body, no reading the clock in
  render, no ref reads in render). The pacer's timers call `useEffectEvent`
  functions, so a re-render (a save's status changing) or a corrected count
  never restarts the breath in progress, and the summary's minutes come from
  the last set, not from `now`.
- **The compiled JSX dropped a space.** `{zone} is the program's zone.`
  rendered as "3–5is" when the text ran on to a line break before the next
  expression; that sentence is one template string now. Check a rendered
  sentence, not its source.
- **Sound needs a tap.** A browser starts audio only from a user gesture, and
  a session resumed after a reload has had no Start tap, so any tap on the
  workout screen unlocks it. The same tap warms the voice up, which iOS needs
  before it will speak at all.
- **One voice, and a line knows how long it is worth saying** (F2b,
  [ADR 0114](../decisions/0114-a-workout-has-one-voice-and-a-line-knows-how-long-it-is-worth-saying.md)).
  Steps are `normal` and keyed `step`, so a newer step replaces an unsaid
  older one. "Last one." is `normal`, keyed `count`, so it cuts off a cue. A
  cue is `low` and waits its turn, or goes unsaid. Nothing is said late.
- **A cancelled line is not a silent phone.** `cancel()` makes the line it
  stops fire `error` with `interrupted` or `canceled`, and a browser refuses
  speech before the page's first tap with `not-allowed`. The tell box took any
  error as proof that the device could not speak and switched the voice off
  for the page. The queue interrupts on purpose, so only a real failure
  counts now (`isRealSpeechFailure`).
- **The coach speaks in a recorded voice** (F2d,
  [ADR 0115](../decisions/0115-the-coach-speaks-in-a-recorded-voice-fetched-ahead-and-kept-on-the-phone.md)).
  Deepgram's Aura-2, the tell box's vendor already; four voices, Arcas to
  start (his choice). A session's lines are known in advance, so they are
  fetched from the start screen and kept in the phone's Cache Storage, and
  the device says any line whose recording is not there in time. The words go
  to the vendor with its model-improvement opt-out; nothing personal does.
- **A recording has to be stopped; a device line must not be.** The queue
  interrupts a device line by speaking the next one, because stopping the
  app's voice separately races the new line (ADR 0114). A recording has
  nothing else to stop it, and a line still waiting for its recording would
  start later over the new one. So an interrupt `cut`s: it stops a recording
  or a wait, and leaves a device line to the next line's own call. And a
  recording that starts hushes the device first, in case the line it cut was
  the device's.
- **The demo waits for the coach, once** (F2d). A new exercise's demo is made
  as its screen appears, and the exercise's line is asked for in the same
  commit, before YouTube's player can be ready. So a busy voice at `onReady`
  is this exercise's line: the demo holds until the queue goes quiet (or play
  is tapped, or 20 s), then never stops for the coach again. Reading the
  voice in an effect instead would see it idle: the demo's effects run before
  the set's `announce`.
- **The wide layout belongs to one view.** Only a set with a demo spreads out
  (at `lg`, 1024 px): the demo takes the left, as wide as `(100dvh - 12rem) *
  16/9` allows but never under the phone column's 26rem, and the set a 24rem
  column on the right. The start, the three taps and the finish keep the
  phone's column, top bar included, so nothing else changes on a wide screen.
- **A reminder is the day's unfinished sets at the person's hour** (F4a,
  [ADR 0116](../decisions/0116-a-workout-reminder-is-the-days-unfinished-sets-pushed-at-the-hour-the-person-chose.md)).
  Worked out when it goes, never stored; a done day is skipped (his call); at
  most once a slot a day, claimed before it is sent, so a crash loses one
  rather than doubling it; within an hour of its time or not that day. It
  never carries a badge: the icon's count is the digest's.
- **A reminder's tap goes through the door.** The phone may be in the business
  when it is tapped, and the space's own pages refuse a business session, so
  the push opens `/personal/open?next=<the program>`.
- **The person says what they saw; the app applies the table** (F4b, his
  call). Each test is answered left, right or the same for which side went
  further, and `leftMeans` turns it into a side, so a reversed test needs no
  thought mid-assessment. A side needs the program's number of tests to agree
  and more than the other side; otherwise both sides.
- **A one-sided exercise is logged as not per side, each set with its side**
  (F4b part 2). `sessionPlan` gives it `perSide: false` and its `onlySide`, so
  a set counts once everywhere a set is counted (`fullSets`, the day, the
  summary, the server's `lastSession`) and "per side" drops from its words
  with no change to them; each set row keeps its side. No column was needed:
  the only side rides on the phone's document for `nextStep`, and the server's
  rows already say it.
- **The side is worked out on the server** from the program's own tests and
  the answers, kept by test name; the phone's result is only shown. Taking the
  tests before the first workout starts following the program.
- **An exercise keeps the sides it was started with.** One begun on both sides
  before the side was saved finishes on both, in the screen's and the coach's
  words, because a set half on each side is no set at all.
- **The person names an exercise's levels** (F4c, his call). A program shows
  them in its video, which no draft can watch, and the video's page answered
  the app with a bot check, which nothing works around. The mark is read from
  nothing either: new levels take it from the exercise's own prescription,
  which on his calf raise is the book's rule exactly.
- **A move up chosen in a workout travels in the session document** (F4c),
  like everything a workout does (ADR 0113), so it works with no signal.
  `saveSession` applies it the first time `level_up` arrives true on the row,
  when the person is still at that level; a resend, a later revision, or a
  level gone back to since never moves it again.
- **The mark needs every answer.** Effort and hurt are part of it, so a
  suggestion never shows before both are answered, and an unanswered one
  never makes a mark (an app cannot tell an easy set from a question skipped).
- **A level's set of reps starts where the set before got to.** The confirm
  starts at the target for everything else (F2's call); at a level the count
  climbs toward the mark, and tapping from 6 to 15 on every set and side
  would be the very tapping the confirm exists to spare.
- **A side rule is on the item, per phase.** The same exercise in two phases is
  two items, and a program may do it on one side in one phase only, so reading
  again asks for an entry per phase. A CHECK keeps a rule off an item not done
  per side, and the editor resets one when `Per side` is unticked.
- **Read again, never import again** (F4b). A second import would be a second
  program with none of his workouts. Reading again merges what is new into the
  program (every id kept, so the save updates the same rows) and writes
  nothing until Save, under the version it read.
- **A picture is rendered as `print`.** pdf.js continues a `display` render on
  animation frames, which a background tab never gets, so a read stalled on
  the table's page until the tab came back to the front. `print` continues on
  microtasks.
- **Claude copies what the prompt lists.** Reading again first listed a per-side
  exercise as `Name (per side)`, and every name came back with the note on it.
  A prompt's own markup is either left out of the answer by name or ignored on
  the way in; here, both.
- **The demo's player is made in a node React does not own.** The API
  replaces the element it is given with its iframe, so the demo hands it a
  `div` made in the effect, inside the box React renders empty. React never
  tries to remove a node the API has replaced.

## Open items

- **F1's last check: a video inside the Android app.** Every inline play so
  far was in a browser. Until one plays inside the app on a phone, the
  referrer and the WebView's handling of the frame are assumptions (Inline
  video, above).
- **Delete should become archive now that logs exist.** F2a logs workouts,
  and deleting a program still deletes them with it; the dialog now says how
  many. Putting a program away (`archived_at`, already a column and already
  filtered by `listPrograms`) with its history kept is the better answer, and
  it needs a place to find put-away programs again.
- **Workout mode in the Android app: built for, not yet watched.** App 1.0.8
  (2026-09-30, with the posture check's camera; [mobile-app.md](mobile-app.md))
  declares VIBRATE, so the pacer's buzz can work in the app, and carries the
  KeepAwake plugin, which `useWakeLock` now uses inside the app instead of the
  WebView's Screen Wake Lock. Neither has been felt or watched on a phone.
- **Nobody has heard the pacer or the coach on a phone.** The drives ran in a
  browser pane. The tones, their volume, the buzz and the voice are unproven
  on a real phone. In the app the end of a line is estimated from its length,
  so a long line may be cut off by the next one. A later app build can have
  the native voice report its end (`onDone`), and `speakLine` would use it
  where it is there; 1.0.8 did not take it on.
- **His production calf raise has no levels yet.** He names them in the
  editor from the video, after `0433` is on production and this is merged.
- **His production program has no self-assessment yet**, unless he has read
  the PDF again there since part 1 merged. Then `Your side` offers the tests.
- **A one-sided workout on a phone is unwatched.** The drive saw the set line
  and the start screen in a desktop pane; no one-sided set has been done
  through to its end with the pacer, and the coach's words were checked in the
  tests, not heard.
- **Reading a PDF on a phone is unwatched.** The drives read it in a desktop
  browser; a phone's pdf.js and a 1,100 px canvas for the picture are
  assumptions.
- **No reminder has reached a phone yet** (F4a). The cron and the sender
  were driven on dev, where no phone is registered. Production has his phone
  and FCM's credentials: the first evening after the merge is the test.
- **A reminder counts only what has reached the server.** A morning done with
  no signal and not yet sent makes the evening's say more is left.
- **iPhone reminders** wait on APNs, as the digest's pushes do.
- **The recorded voice on a phone is unheard** (F2d). It plays through Web
  Audio. Inside the app's WebView that is untried, and on an iPhone with the
  ringer switch off Web Audio may be silent where speech was not
  (`navigator.audioSession` could change that, at the price of pausing the
  person's music). The drive was in a desktop browser.
- **No per-space budget for the recorded voice.** Each new line costs about
  $0.03 per 1,000 characters, bounded by the route's 40 lines of 300
  characters a request and by the phone keeping every recording. Before
  Workouts opens to everyone, a daily character budget per space (a table)
  would bound a runaway client.
- **The demo inside the Android app is unwatched.** A WebView can refuse even
  a muted video until a tap (`mediaPlaybackRequiresUserGesture`). The demo
  then says so and waits for play, but nobody has seen which way the app
  goes.
- **Made-for-kids videos.** YouTube's developer policies ask an API client to
  look up each embedded video's made-for-kids status (a Data API call) and
  turn tracking off for those. This page tracks nothing of its own and uses
  the privacy-enhanced player. The lookup is not built. A program of
  children's exercises is when it matters.
- **An unsent workout goes up while a session, a program's page or the
  Workouts home's Today card is open.** The card only shows once a program
  has a workout on the server, so a very first workout finished without
  signal waits for the program page.
- **A phone in another timezone from the space.** The day is the space's, so
  near midnight a session the phone dated to its own day can fall on the
  other side of the space's. Nobody travels with it yet.
- **Progress counts only what has reached the server.** A workout still on
  the phone joins the done days once sent. The Start button and the Today
  card's day line already count it.
- **The program page reads the program's whole history** (the newest 2,000
  sessions) on each view. Page it, or keep running totals, if it is ever slow.
- **F2 is built; Workouts is still `coming_soon`.** Making it `available`
  opens the Personal space door to every business user, and it wants the
  health-data privacy policy first (P1). The founder's call.
- **Scanned PDFs are refused** (`NO_TEXT`). A picture of a page is sent only
  for a table its words point to (ADR 0117); reading a whole scanned program
  would need OCR, or every page as a picture. Nobody has asked.
- **A save is one statement per row.** Fine next to the database; from a
  laptop to Neon a fifteen-exercise program took several seconds to save on
  the drive. Batch the inserts if a program ever feels slow in production.
- Apple Health / Google Fit: writing a session as a workout. Not before F3.
- A trainer or physio who wants to see the log (the PDF points at the author's
  coaches) is a read-only share of a personal space, and ADR 0111 has no
  answer for it yet.
