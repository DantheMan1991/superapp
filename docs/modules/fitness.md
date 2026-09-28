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

### 2026-09-27 — F3: progress and the gate (`claude/fitness-f3`)

No migration and no seed. The founder approved the screens from a mockup
(the program page's progress, the gate opening, the Today card's line) with
two calls of his own: **the streak counts weeks on target**, and **a phase
whose gate has not opened warns but can still be started**.

- **Done days** (`core/progress.ts`): a day whose sessions together did every
  exercise's minimum for the phase, the same `dayProgress` a split day uses.
  Counted per phase from every session of the program (`programSessions`,
  the newest 2,000).
- **The phase bar** on the program page: `6 of 14 done days`, `Phase 2: … opens
  at 14`, a bar, and a line saying what a done day is.
- **This week**: done days, Monday to Sunday, against the program's sessions a
  week (`1 of 3–4 sessions`).
- **The last four weeks**: a square a day (done, some sets, nothing, still to
  come, today ringed), and `3 weeks in a row on target`. It counts weeks, not
  days (his call): the program asks for 3–4 a week, so a daily streak would
  break on every rest day. The week going on never breaks it.
- **The effort warning**, in the program's terms: `1 exercise at 7/10 this
  week. The program says stay at 3–5.` It counts exercises, not sets as the
  plan said, because effort is given once per exercise.
- **How you felt**: the phase's average before and after, and a line for each
  over the last 14 sessions, drawn as inline SVG with no chart library.
- **The gate**: when the phase's done days are reached, `Phase 2: … is open`
  with what is new in it (by name, since each phase's exercises are rows of
  their own), the first new exercise's video, `Move on to …`, and `Or keep
  going here. It never moves you on by itself.` Nothing is stored. The program
  opens on the phase of the last workout, so the first session on the next
  phase is the move.
- **A phase whose gate has not opened** says `Opens after 14 done days of …
  (6 so far). The program says not to skip a phase.` above a Start that still
  works (his call).
- **The Today card** adds `6 of 14 done days · This week: 1 of 3–4 sessions`,
  and `Phase 2: … is open` with `Move on` once its phase's gate opens.
- It is worked out on the server from what has reached it, so a workout still
  on the phone counts once it is sent.
- Guides: `program.md` (Your progress, the gate, how to move on) and
  `overview.md` (the Today card's lines). Two icons registered for guides:
  `arrow-right` and `triangle-alert`.

**Driven** on a production build against the dev branch, on the founder's
program:

- The Today card for phase 2 read `1 of 14 done days · This week: 1 of 3–4
  sessions`.
- At 375 px, phase 1's page showed `1 of 14 done days` with `Phase 2: Weeks
  3-4 opens at 14` and `This week 1 of 3–4 sessions`. Its calendar marked
  today done. The effort warning read `1 exercise at 7/10 this week`, from the
  7/10 given in F2a's drive, and `How you felt` read 2 sessions, 4 before →
  6.5 after. No sideways scroll.
- Phase 2's page said `Opens after 14 done days of Phase 1: Weeks 1-2 (1 so
  far). …` above its progress and a Start that still worked.
- With phase 1's days set to 1 for the drive (restored to 14), phase 1's page
  showed `Phase 2: Weeks 3-4 is open`: its four exercises, all new, the first
  one's video, and `Move on to Phase 2: Weeks 3-4` linking to `?phase=2`.
  Phase 2's warning went away.
- With phase 2's days set to 1 (restored), the Today card showed `Phase 3:
  Weeks 5-6 is open` with `Move on` linking to `?phase=3`.
- The drive found three wording bugs, all fixed: `4 of them new` when all are
  new (now `all new`), `1 days before moving on`, and `1 of 1 done days`.
- The app window was minimized for part of the drive, so the page's text was
  read instead of taking screenshots.

Tests: `tests/fitness-progress.test.ts` (new, pure): done and partial days, a
program's done day across phases, the gate and its words, the Monday week and
this week's count, weeks on target (the week going on never breaks it), the
four-week calendar, the effort warning in the program's terms, the feel's
averages and series, what the next phase brings. `tests/fitness-ops.test.ts`
(db): `programSessions` with each session's phase, feels and efforts.
`tests/fitness-day.test.ts`: the session's new fields.

### 2026-09-27 — F2c: split days, and a Today card (`claude/fitness-f2c`)

No migration and no seed. The founder approved the screens from a mockup
(the split choice, the evening pick-up, the Today card) and the rule that
**every set done counts toward the day, however short it came up**. With this,
F2 (workout mode) is built.

- **A day is a ledger** (`core/day.ts`): the sets each exercise needs (its
  minimum), the sets done across the day's sessions, and what is left. The
  day is done when every exercise that is not optional has had its minimum.
  That is the done day F3's gate will count.
- **A set is a full set** (`fullSets`): one of "1 × 15 rolls per side" is both
  sides. The session's `Session done` count and the program page's `Last
  workout` count this way now. F2a counted each side as a set, so a drive's
  "7 sets" is 6.
- **"Half now, the rest later today"** at the start does the first half of
  every exercise's sets, rounded up (1 of 2, 2 of 3). A session later that day
  starts as `The rest of today`: the day so far with when each session was
  (`Evening · 4 sets · 2 minutes`), and only what is left (`1 more set`),
  passing over the exercises the day already has (`done today`). Once the day
  is done, the start offers `Start another session`, which does everything
  again and counts too. The choice only shows when halving changes something.
- **The session carries its own aim** (`SessionDoc.aim`, the phone's alone,
  like `plannedSets`): per item, the sets it does and the most "one more set"
  may reach, so the morning and the evening together stay within the
  program's maximum for the day. A document from before has none and aims at
  each minimum, as before.
- **The finish says how the day stands**: `That is every set today asks for.`
  or `Still to do today: 4 sets. Start again later today and it picks up
  here.` The coach's first-set intro says the session's share ("1 set of 8
  breaths").
- **The program page's Start** reads `Do the rest of today` after a session
  earlier today, with `Today: Evening · 4 sets. 4 sets left.`, or `Start
  another session` with `Today's sets are done: …`. `Last workout` steps
  aside when its workout was today on the phase on screen.
- **A Today card on the Workouts home** (`components/today-card.tsx`): the
  program last followed, on its last workout's phase. It lists today's
  sessions, says what is left and of which exercises, and has one button:
  `Start today's session`, `Do the rest` or `Resume`. Once every set is done
  it says `Every set done today.` and asks nothing. It sends unsent workouts
  while the page is open.
- **Where the day comes from**: the pages load the program's sessions from
  the space's yesterday to tomorrow (`recentSessions`, full sets per item),
  and the phone adds its own documents, sent or not, the phone's copy winning
  (`dayOf`). So a morning done without signal is already counted.
- **"Morning" is read on the space's clock** (`hourIn`), never the device's:
  these screens are rendered on the server first, and a device clock there is
  the server's.
- Guides: `workout.md` (the start screen on a split day, `How much now?`, the
  finish's line, a how-to for splitting a day), `program.md` (the Start
  button's labels, `Last workout`), `overview.md` (the Today card).

**Driven** on a production build against the dev branch, on the founder's
program, with the breathing pace set to 1 s and 1 s for speed and cleared
after. Phase 1 already had four sessions today from the earlier drives, which
showed the done day: the Today card listed them with `Every set done today.`,
the program page read `Start another session` with `Today's sets are done:
Afternoon · 6 sets, …`, and the start screen said `Today's sets are done`
with no split choice. On phase 2, a fresh day: `How much now?` with `All of
it` chosen, and `Half now, the rest later today` turning every row to `1 of 2
sets`. The half session ran `Set 1 of 1` on each exercise, per side where
asked, and finished with `Still to do today: 4 sets.` (4 exercises, 4 sets).
The program page then read `Do the rest of today` with `Today: Evening · 4
sets. 4 sets left.`, and the Today card `Evening · 4 sets`, the four
exercises left and `Do the rest`, as in the mockup. That opened `The rest of
today` with the evening, `1 more set` on each and no split choice; its finish
said `That is every set today asks for.`, and the program page `Start another
session` with `Today's sets are done: Evening · 4 sets, Evening · 4 sets.`. At
375 px, the Today card and the split choice fit with no sideways scroll. No
hydration error from the server's render of "Evening". The drive left two
phase 2 sessions on dev, so the program opens on phase 2 there.

Tests: `tests/fitness-day.test.ts` (new, pure: a full set, a morning half and
an evening that picks up, the day's maximum, another session after a done
day, a session from before split days, the server's and the phone's copies,
what the start screen says, the space's day and hour; the evening test was
checked to fail with the skip taken out), `tests/fitness-session.test.ts` (a
per-side set counted once), `tests/fitness-coach.test.ts` (the share said),
`tests/fitness-ops.test.ts` (db: `recentSessions` on the days asked for with
full sets per item, one side not yet a set, `lastSession` in full sets,
`latestFollowed`).

### 2026-09-27 — F2b: the coach's voice and the looping demo (`claude/fitness-f2b`)

No migration and no seed: everything F2b adds lives on the phone.

- **The demo loops above the count** (`components/workout/demo-loop.tsx`).
  The exercise's clip starts by itself, muted, and goes round between the
  video's `Start` and `End` (or from `Start` to the video's end) at 0.5×,
  0.75× or 1×, remembered per device. Under it: pause and play, the speeds,
  and `With sound`, which plays the clip once from its start at 1× with the
  author talking and then goes back to the loop. A set beginning to run does
  the same, so the demo never talks over the count. It is YouTube's player
  driven by the IFrame Player API (`youtube-api.ts`), inside YouTube's terms
  for an API client (Inline video, below). The loop is the page's own, a check
  every 250 ms that seeks back a quarter of a second before the end. A video
  that may not be embedded, is gone or will not play says why, with `Open in
  YouTube`, and a page that cannot load the API gets F1's player. The exercise
  screen is now one per exercise, so the demo keeps playing from set to set.
- **The coach's voice** (`core/coach.ts`): the screen, said at the moments it
  cannot be seen. As a set appears it says the exercise, what to do and the
  side to start on the first time ("Side-lying pullback. 2 sets of 5 to 8
  breaths, each side. Right side first."), then "Now the left side." or "Set 2
  of 3. Right side.". Reps and rolls get their cue with it. In a breath set it
  says the cue as the middle breath starts and "Last one." as the last one
  does. In a hold, the cue halfway, and "Ten seconds left." in one of 30 s or
  more. "Exercise done." as the check appears. Not the count breath by breath:
  the tones already mark every turn.
- **One voice** ([ADR 0114](../decisions/0114-a-workout-has-one-voice-and-a-line-knows-how-long-it-is-worth-saying.md);
  `src/lib/speech/queue-policy.ts`, `voice-queue.ts`). Every line carries a
  priority, an optional key and a freshness. A higher line interrupts, a newer
  line with the same key replaces, and a stale line is dropped, never said
  late. Workout mode speaks through `coachSay` (`sound.ts`), which honours the
  two switches in the top bar: the megaphone (the coach's voice, shown only
  while the phone can speak) and the speaker, which now silences everything.
  The founder's posture tool speaks through the same `coachSay`, with
  `priority: "high"`.
- **The speech engine learned when a line ends** (`speakLine` in say.ts):
  the browser says so; the app's voice answers before it speaks, so there the
  end is estimated from the line's length.
- **Fixed for the tell box as well:** an utterance stopped by the next one
  (`interrupted`, `canceled`) or refused before the page's first tap
  (`not-allowed`) no longer counts as proof that the device cannot speak. That
  proof switched the voice off for the rest of the page. And a line overtaken
  by a newer one before it began (the same tick, or while the voices were
  still loading) was said after it; it is dropped now.
- **F1's player is never under 200 px tall.** YouTube's terms ask it of every
  embedded player, and a phone's width made the 16:9 box 193 px.
- Guides: `workout.md` (the demo, the voice, the two switches, the how-to) and
  `editor.md` (`Start` and `End` bound the loop).

**Driven** on a production build against the dev branch, in the founder's
space, on his imported program. For speed, the breathing pace was set to 2 s
and 2 s, and exercise 3's video was given a 0:05–0:15 clip; both were cleared
after. A recorder on the page's speech engine logged every line, when it
started and when it ended.

- A whole session of four exercises and seven sets, in the Windows voice at
  rate 0.95. The rolls said their intros with their cues, the second one per
  side: "Sidelying Half-Rolling in 90/90. 1 set of 15 rolls, each side. Right
  side first. Low back stays relaxed the whole time." then "Now the left side.
  No pinching felt in the hip.". The first intro took 8.6 s to say. In the
  breath exercise, the first cue came 21 s after Start (the countdown and four
  breaths), "Last one." at 33 s, and "Set 2 of 2." as the next set counted
  down. Set 2 had its own cue, then "Last one.", then "Exercise done." as the
  check appeared.
- The warm-up line, cut off by the first real one, reported `interrupted` and
  did not silence the device (the fix).
- The voice switch off: nothing said for 30 s, through the end of a set and
  the next set's start. Back on, then all sound off: "Last one." was cut off
  0.4 s in, and the voice switch stayed, so the phone was not taken for a
  silent one.
- Skipping three exercises in a row: each intro cut off the one before, the
  newest step being the true one.
- The demo: the privacy-enhanced player, muted, 416 × 234 px in a desktop
  pane. 0.5× applied, was remembered, and carried to the next exercise. `With
  sound` unmuted it and played from the clip's start at 1×, with the speeds
  grayed out, and at the video's end it went back to the muted 0.5× loop. The
  muted loop came round at a video's end. Exercise 3's clip went round 0:05 →
  0:15 → 0:05. `With sound` kept playing through a countdown, then went back
  to the muted loop the moment the set ran. One player stayed across both
  sides of an exercise. Scrolled fully out of sight (a 375 × 420 view), it
  paused; scrolled back, it played.
- The browser pane refuses a video that starts by itself, even muted. The
  demo said `This phone waits for a tap before it plays a video. Tap play.`,
  and play started it.
- Finish saved: `Session saved`, then `Last workout: today · Phase 1: Weeks
  1-2 · 7 sets · felt 4 before, 6 after`.
- **Two bugs the drive found, fixed.** The chosen speed did not show on the
  dark screen: the outline button's dark-mode fill beat the highlight, so the
  chosen speed now takes the primary look. And at 375 px, with the voice
  switch added, "Exercise 4 of 4" and "Kept on this phone" each wrapped onto
  two lines; the save status now sits under where you are. Both were
  re-checked at 375 px on a new build, with a second, short session run
  through to its finish.
- The last change (a line overtaken before it began is dropped) was driven on
  its own build. Each intro was still cut off by the next, the voice switch
  stayed, and a double tap on Skip skipped one exercise, not two.

Tests: `tests/speech-queue.test.ts` (the voice's rules, the length estimate,
which speech errors mean a silent device), `tests/fitness-coach.test.ts`
(every line the coach says, set by set), `tests/fitness-core.test.ts` (the
demo's player parameters and when the loop goes round).

### 2026-09-27 — F2a: workout mode, the session (`claude/fitness-f2`)

Migrations `0428` (four tables, two enums, the breathing pace on programs;
hand-reordered, with three column-list SET NULL keys, see Decisions) and
`0429` (their RLS), applied to the dev branch and to production before the
merge (production on the founder's word, ADR 0014: additive only). No seed:
the catalogue did not change. The founder approved the screens from a mockup
and the slice order F2a → F2b (coach voice, looping demo) → F2c (split days).

- **`Start today's session`** under a phase on the program page runs that
  phase full screen and dark (`/personal/m/fitness/programs/[id]/session`):
  a feel check (0–10), one exercise at a time, three taps after each, and a
  finish with the feel after. The program page opens on the phase of the last
  workout, says `Last workout: today · … · felt 4 before, 7 after`, and turns
  the button into `Resume today's session` while one is open on the phone.
- **The pacer** counts breaths at the program's own pace: a new breathing pace
  on the program, which the importer fills from the book and the editor
  changes (5 s and 5 s when empty). A circle shrinks on the breath out and
  grows on the breath in, a tone marks each turn, and the set finishes itself
  at the top of the range with a chime and a buzz; `Finish set` works from the
  bottom of it, `One didn't count` takes a breath back, and it pauses. Holds
  count down. Reps and rolls confirm the target (his call). The first set of
  an exercise waits for Start; every later set and side counts down five
  seconds and starts itself.
- **After each exercise**: effort 1–10 with the program's zone outlined and a
  word when it is exceeded, the exercise's own checks to tick, and `Anything
  hurt?` with where; `One more set` up to the program's maximum.
- **Kept on the phone, sent whole** ([ADR 0113](../decisions/0113-a-workout-session-is-a-document-the-phone-keeps-and-sends-whole.md)):
  the session is a document in the phone's storage, changed by pure functions
  (`core/session.ts`) and sent after every change to `saveSessionAction`,
  which makes the database match it. No signal: the top says `Kept on this
  phone`, and it goes up on its own when the phone comes back, or the next
  time the program page is open. A session left open closes the next day at
  its last set.
- **The screen stays on** (Screen Wake Lock) while a session is open.
- **A log outlives an edit**: a session keeps its phase's name and each
  exercise its name, unit and per-side, and their keys to the program set null
  when an edit removes what they logged. Deleting the program still deletes
  its workouts, and the delete dialog now says how many.
- **Seams for the founder's posture tool**, which he is building himself: the
  exercise screen's top slot (the video today), the enrollment's `side`, and
  F2b's one voice.

**Driven** on the dev branch in the founder's space, on his imported program,
with the breathing pace set to 1 s and 1 s for speed and cleared after: a
whole session of four exercises and seven sets. It covered rolls confirmed
and one taken off, both sides of a per-side exercise, the pacer running two
sets of 8 by itself, a 5–8 set stopped at 5 with a pause and a breath taken
back, effort 7 above the zone with its warning, and a pinch with where. A
reload mid-exercise landed on the same side. A set done with the network
failing showed `Kept on this phone` (revision 11 on the phone, 10 sent) and
went up on its own when the network came back. Finish saved and returned to
the program with `Last workout: today · Phase 1: Weeks 1-2 · 7 sets · felt 4
before, 7 after`, and the rows read back from the dev database matched. The
drive found three bugs, all fixed: "3–5is the program's zone" (the compiled
JSX dropped a space), sound never unlocked after a reload (any tap now
unlocks it), and `Kept on this phone` lingering after a send had got through.

Tests: `tests/fitness-session.test.ts` (pure: a session walked from Start to
Finish, a double tap refused, one more set, skipping, resuming from storage,
the schema), `tests/fitness-core.test.ts` (the pace through the draft and the
form), `tests/fitness-ops.test.ts` (a session sent whole again and again, a
late older copy ignored, a set taken back, an id from another program's
session and a day ahead refused, a log outliving the edit of its exercise
and its phase, deleting the program), `tests/isolation/fitness.test.ts` (the
four tables between two spaces).

Older entries (F1 and the plan) are in [fitness-build-log.md](fitness-build-log.md).

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
| A five-test self-assessment says which side you are "lateralized" to, and changes four exercises in phases 2–4 to one side | The person's side on the enrolment, and a side rule on the item (`both`, `toward`, `away`). Until the assessment is done, both sides, which is the program's own default |
| Calf raise progression: "move on once you can do 2 sets of 15 perfect reps" | A progression ladder on the item with an advance rule, and a nudge when the log meets it |
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
  plugin is a new app build, [mobile-app.md](mobile-app.md)).
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
  the tell box and wrong for a pacer, a cue and (later) the founder's posture
  feedback all wanting to speak in the same minute.
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

His posture tool (camera, feedback) is his to build, in parallel. F2 builds
nothing camera-related and leaves three seams for it: the exercise screen's
top **stage** (the looping demo today, a camera view during a set later),
the one **voice** (built in F2b: `coachSay({ text, priority: "high", key:
"posture" })` cuts in on a cue or a count, replaces its own unsaid last
correction, and goes unsaid when more than two seconds late), and the
enrollment's **side**, where a left-or-right assessment lands.

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

- **The self-assessment**: the five tests as a short flow with the author's
  video, the answer (left, right or none) saved on the enrolment, and the four
  affected exercises switched to one side, each saying why.
- **Progressions**: the calf raise shows which level you are on and says "you
  did 2 × 15 twice, try level 2" when the log says so. You decide.
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
`0427`) and composite FKs `(tenant_id, x)`, all `on delete cascade`. The first
first five are F1's (migration `0426`), the next four F2a's (`0428`); the
rest are planned. F2a's three keys from a log to the program it logged are the
column-list `ON DELETE SET NULL ("x")`, hand-written in the migration.

| Table | Purpose | Notes |
| --- | --- | --- |
| `fitness_programs` | A program: name, author, source (`imported` / `own`), notes (its rules in words), sessions a week and effort as ranges, the breathing pace (`breath_out_s`, `breath_in_s`, 1–30; F2a), `archived_at`, `version` | `version` guards an edit from a second tab. One active at a time will be the UI's rule, not the table's |
| `fitness_phases` | Ordered phases (`position`) with `min_done_days` (1–365, or none) and notes | |
| `fitness_exercises` | name, purpose, cues (jsonb list), unit (`reps` / `breaths` / `rolls` / `seconds`), videos (jsonb list), notes | **`program_id` NOT NULL for now**: an exercise belongs to the program that made it. A library shared between programs is F5, and relaxing this column is where it starts |
| `fitness_phase_items` | An exercise in a phase: position, `sets_min`/`sets_max`, `target_min`/`target_max`, `per_side`, `optional`, notes | Ranges checked in the database (sets 1–20, count 1–1000, a top never below its bottom). Alternative-of and the side rule are F4 |
| `fitness_imports` | A PDF on its way to being a program: file name, pages, links, status (`drafting` / `draft` / `failed` / `saved` / `discarded`), the draft, the error, the program it became | Holds the draft json and the counts, never the book's text; the draft is dropped once saved |
| `fitness_enrollments` | Following a program: `started_on` (the person's own day), `side` (`left` / `right`, or none), `ended_at` | F2a. Made by the first session; one open per program (a partial unique index). No current phase: each session names its phase, and moving on is F3's gate |
| `fitness_sessions` | One workout: the phone's own id, its enrollment, its phase (and the phase's name, kept), `local_day`, started and finished, feel before and after (0–10), note, `revision` | F2a. `revision` only goes up, so a late older copy never undoes a newer one. A day can hold several: a split day is two or more (F2c). No morning-or-evening slot is stored; a session's part of the day is its `started_at` on the space's clock |
| `fitness_session_exercises` | An exercise as done in a session: its item and exercise, position, name, unit and per-side as they were, effort (1–10), the cues felt, `hurt` (`none` / `pinch` / `yes`) and where, skipped, finished | F2a. The three taps after an exercise live here, per exercise, not per set |
| `fitness_sets` | A set: its number, side, `target` (the least asked) and `count` (what was done), `done_at` | F2a. The id is the phone's, so there is no separate idempotency key. Load (weight) is F5 |
| `fitness_progressions` | A ladder of exercises on an item with its advance rule | F4 |

## Key files & seams

- `src/db/schema/fitness.ts` — the nine tables, the enums, `FitnessVideo`.
- `src/modules/fitness/core/` — the pure half: `youtube.ts` (links,
  timestamps, the embed URL), `program.ts` (the save's schema and rules,
  `prescription`), `draft.ts` (the `record_program` tool, the prompt,
  `normalizeDraft`), `editor.ts` (the editor's form, both ways), `errors.ts`.
- `src/modules/fitness/draft-model.ts` — the one Claude call.
- `src/modules/fitness/embeds.ts` — `checkVideo` and `markVideos`: YouTube's
  oEmbed answer (plays here or not, and the title).
- `src/modules/fitness/import-ops.ts` — `draftProgram` and the import's life.
- `src/modules/fitness/program-ops.ts` — `saveProgram` (by id, under
  `version`), `loadProgram`, `listPrograms`, `deleteProgram`.
- `src/modules/fitness/actions.ts` — the five server actions, each behind
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
- `src/modules/fitness/core/coach.ts` — every line the coach says (F2b).
- `src/lib/speech/queue-policy.ts` and `voice-queue.ts` — the one voice
  (ADR 0114): the rules, pure, and the queue that feeds `speakLine` in
  `say.ts`.
- `src/modules/fitness/components/` — `read-program-pdf.ts` (pdfjs on the
  device), `import-form.tsx`, `program-editor.tsx`, `program-view.tsx`,
  `video-player.tsx`, and the discard and delete buttons.
- `src/modules/fitness/FitnessModule.tsx` — the Workouts page.
- `src/app/personal/(space)/m/` — the tool's routes: `[slug]` (the front page),
  `fitness/import`, `fitness/import/[id]`, `fitness/new`,
  `fitness/programs/[id]`, `fitness/programs/[id]/edit`,
  `fitness/programs/[id]/session` (workout mode).
- `src/lib/pdf/browser.ts` — `loadPdfjs`, shared with Documents.
- `tests/fitness-core.test.ts`, `tests/fitness-session.test.ts`,
  `tests/fitness-coach.test.ts`, `tests/speech-queue.test.ts`,
  `tests/fitness-ops.test.ts`, `tests/isolation/fitness.test.ts`.
- `docs/help/fitness/` — `overview.md` (`**Route:** /personal/m/fitness/**`),
  `import.md`, `editor.md`, `program.md`, `workout.md`.

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
  needs are sent, and the import row keeps the draft, not the text. The
  privacy line on the import screen says so, and it must stay true.
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
- **Workout mode in the Android app.** The pacer's buzz needs the VIBRATE
  permission, which the app does not have: the phone's browser buzzes, the app
  will not until a new build, best made together with the CAMERA permission
  the founder's posture tool needs. Screen Wake Lock inside the app's WebView
  has not been watched either.
- **Nobody has heard the pacer or the coach on a phone.** The drives ran in a
  browser pane. The tones, their volume, the buzz and the voice are unproven
  on a real phone. In the app the end of a line is estimated from its length,
  so a long line may be cut off by the next one. The build that adds VIBRATE
  and CAMERA can have the native voice report its end (`onDone`), and
  `speakLine` would use it where it is there.
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
- **Scanned PDFs are refused** (`NO_TEXT`). Reading pictures of pages would
  need OCR; nobody has asked.
- **A save is one statement per row.** Fine next to the database; from a
  laptop to Neon a fifteen-exercise program took several seconds to save on
  the drive. Batch the inserts if a program ever feels slow in production.
- Apple Health / Google Fit: writing a session as a workout. Not before F3.
- A trainer or physio who wants to see the log (the PDF points at the author's
  coaches) is a read-only share of a personal space, and ADR 0111 has no
  answer for it yet.
