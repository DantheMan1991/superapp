# Fitness — build log archive

> The oldest entries of [fitness.md](fitness.md)'s build log, moved here on
> 2026-09-27 and 2026-09-29 so the dossier stays readable. Nothing was edited: they are exactly
> as written, newest first. Where an entry says "see Decisions" or
> "below, Open items", it means those sections of [fitness.md](fitness.md),
> which is still the file to read first.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

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

### 2026-09-27 — F1: the program, imported (`claude/fitness-f1`)

Migrations `0426` (five tables, three enums; hand-reordered, see Decisions)
and `0427` (their RLS), applied to the dev branch and to production before
the merge (production on the founder's word, ADR 0014: additive only), and
the catalogue row seeded on both. Workouts ships **`coming_soon`**: the founder chose
"just me until workout mode", so it is in his personal space (a superadmin's
space previews a `coming_soon` personal tool) and nobody else's, and the
`Personal space` door stays shut to everyone but superadmins.

- **The personal plumbing P0 left for the first tool**: the
  `/personal/m/[slug]` route, the rail, `Your tools` on the home, and the
  preview. [personal-space.md](personal-space.md) has them.
- **The PDF is read on the device** (`read-program-pdf.ts`): pdfjs takes each
  page's text and its link annotations, and only those are sent. His PDF is
  19.3 MB and a server action takes 4 MB; and a book somebody bought does not
  need uploading to be read. `loadPdfjs` moved from Documents'
  `pdf-canvas.tsx` into `src/lib/pdf/browser.ts`, which both now use. Refused
  on the device before anything is sent, and asked again on the server before
  any row or Claude call: over 150 pages, over 300,000 characters, or under
  200 characters (a scan, `NO_TEXT`). [ADR 0112](../decisions/0112-a-program-pdf-is-read-on-the-device-and-only-its-words-and-links-are-sent.md)
  records the decision. A dropped connection mid-draft says so and points at
  `Drafts`, where the draft may still arrive.
- **Claude drafts it** (`draft-model.ts`): `claude-opus-5`, adaptive
  thinking, streamed, a forced `record_program` tool with
  `eager_input_streaming`, and a server-side fallback to `claude-opus-4-8` on
  a refusal. The stop reason is checked before the tool input is used;
  `normalizeDraft` holds the answer loosely (a string for a number, a "to"
  below its "from", a playlist, a duplicate video) and `programInputSchema`
  has the last word. One draft at a time per space: a second press inside
  five minutes is `BUSY`, not a second bill.
- **An import is a row from the moment drafting starts** (`fitness_imports`),
  so closing the tab mid-read loses nothing: the draft waits under `Drafts`.
  The row keeps the draft and the counts, never the book's text, and drops the
  draft once it is saved. A row still `drafting` after the five minutes was
  interrupted (the page's `maxDuration` is 300 s) and reads as failed, with a
  discard (`settleImport`); the drive's write-up found that without it such a
  row sat on the page for ever with no button.
- **The review is the editor** (`program-editor.tsx`): one screen for a draft
  (`Review the draft`), a program by hand (`Build a program`) and an edit.
  Nothing touches the program tables until `Save program`.
- **A save keeps every row's id** (`saveProgram`): it diffs by id under the
  program's `version`, updating what it kept, inserting what is new and
  deleting what was dropped. Workout mode will log sets against a phase item
  and an exercise, and a save that re-created the program would orphan every
  log the day somebody fixed a typo. An id the program does not own is
  `STALE`, never an insert.
- **Videos play in the page** (`video-player.tsx`): a click-to-play box, then
  YouTube's player from `youtube-nocookie.com`. oEmbed is asked about every
  video when a program is drafted, and about any video a save brings that
  nobody has asked about (`markVideos`). One video plays at a time: starting
  one turns every other back into its box.
- **A second video is named by the book or by YouTube, never by a guess.**
  The first real draft called four of the release sequence's five videos
  `Alternative`; they are five different rolls. `normalizeDraft` no longer
  invents the word, and an unnamed second video takes its YouTube title from
  the same oEmbed answer (`Inner Foot Roll`, `Outer Foot Roll`). The editor
  shows no name box on the first video, which is shown under the exercise's
  own name.
- **The program page** (`program-view.tsx`): the rules as badges, the phases
  as chips (`?phase=`), and each exercise with its video, prescription
  (`2 × 8 breaths per side`), purpose, `Doing it right` and notes, and its
  other videos in boxes under their names.

**Driven** on the dev branch, in the founder's personal space, with his own
PDF (a copy served from `public/` for the drive and deleted before the
commit): 59 pages and 40 links read on the device, drafted in about a minute
into 4 phases and 15 exercises, every exercise's own video found and the dead
overview link not used. Discarded the first draft, imported again after the
label fix, saved it, played the first two videos inline (desktop, and at
375 px with a phone's user agent), edited a phase's notes and saved, and had a
second tab's save of the old version refused with the STALE sentence. The
drive also found the two demos talking over each other, a `Start 0:00`
placeholder cut off at phone width, and `1 pages` and `0.0 MB` for a
one-page file; all fixed and driven again, as were an interrupted draft
(planted on dev, shown as interrupted, discarded from the page) and a
blank PDF (refused on the device, with no request sent).

Not yet watched: a video playing inside the Android app (below, Open items).

Tests: `tests/fitness-core.test.ts` (links, timestamps, the draft's
normalizing and naming, the editor's form, the save's rules, the oEmbed
bookkeeping), `tests/fitness-ops.test.ts` (the save by id, a stale version,
drafting with a fake model, `BUSY`, `NO_TEXT`/`TOO_LONG` before any row, an
interrupted draft, the preview), `tests/isolation/fitness.test.ts` (the five
tables between two spaces, and the composite keys refusing a row hung off
another space's program).

### 2026-09-27 — The plan (`claude/personal-space-plan`)

No code. The plan, written from the founder's own program: Conor Harris,
*Beginner Body Restoration*, a 59-page PDF he bought. He asked for two things
beyond "make it easier to start and track": **the videos inline**, not a trip
out to YouTube, and **a tool that is really useful and fun to use during a
workout.** Slice 1 is his program running; the builder for your own workouts
comes after (his decision, [personal-space.md](personal-space.md)).

Checked the same day: YouTube's oEmbed endpoint answers 200 for 28 of the 29
distinct videos the PDF links, so every one of them can play inline. The 29th
answers 404 (the video is gone); it is linked only from a phase overview page.
