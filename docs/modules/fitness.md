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

### 2026-09-27 — The plan (`claude/personal-space-plan`)

No code. The plan, written from the founder's own program: Conor Harris,
*Beginner Body Restoration*, a 59-page PDF he bought. He asked for two things
beyond "make it easier to start and track": **the videos inline**, not a trip
out to YouTube, and **a tool that is really useful and fun to use during a
workout.** Slice 1 is his program running; the builder for your own workouts
comes after (his decision, [personal-space.md](personal-space.md)).

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

- **Upload the PDF** into the personal space. The server reads it with pdfjs
  page by page: the text AND the link annotations. Documents' extracted text is
  not enough: it drops the annotations, and every video URL in this PDF is an
  annotation (29 distinct YouTube videos and four playlists). A core module may
  not import another module, so the page-and-links reader is a small
  `src/lib/pdf/` helper that Documents can move onto later.
- **Claude drafts the program** through `getClaude()`, from the pages and their
  links, into a zod-validated draft: program, phases, items, exercises, cues,
  video per exercise. The PDF's headings are letter-spaced
  (`E X E R C I S E`), which a model reads and a regex does not.
- **The draft is never the program.** The person reviews it on a screen laid
  out like the program (phase by phase), fixes a range or a unit, and saves.
  Nothing is written to the program tables before that. The same rule the tell
  box lives by (ADR 0054: draft, never send).
- **The program page**: phases in order, each exercise with its purpose, its
  cues, its sets and its video, playing in the page.
- **Hand entry** is the same review screen started empty. It is F5's builder in
  its first form, and it is what a person with a program on paper uses.

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

### F3 — progress and the gate

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
  author's, on YouTube. They play through the YouTube IFrame Player API from
  `youtube-nocookie.com`, which is what the author published them for;
  downloading and serving them ourselves would be copying them. The API gives
  loop, start and end (the demo segment), mute, speed, and `playsinline` so an
  iPhone does not force full screen.
- **An exercise's video** is `{ provider, id, start_s, end_s }`. The import
  fills provider and id from the PDF's link; start and end are the person's to
  set ("loop 0:42–1:10").
- **A video the uploader has not allowed to be embedded** plays nowhere but
  YouTube. The import asks YouTube's oEmbed endpoint at save time, and such an
  exercise gets an "Open in YouTube" button instead of a dead player.
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

Planned, F1–F3. Every table carries `tenant_id` with FORCE RLS, composite FKs
`(tenant_id, x)`.

| Table | Purpose | Notes |
| --- | --- | --- |
| `fitness_exercises` | The library: name, purpose, cues (jsonb list), unit, `per_side`, equipment, video | Shared by every program in the space |
| `fitness_programs` | A program: name, author, source (`imported` / `own`), rules (weekly target, effort range) | One active at a time is the UI's rule, not the table's |
| `fitness_phases` | Ordered phases with `min_done_days` | |
| `fitness_phase_items` | An exercise in a phase: position, sets and target ranges, `optional`, alternative-of, side rule | |
| `fitness_progressions` | A ladder of exercises on an item with its advance rule | F4 |
| `fitness_imports` | The draft from a PDF, waiting for review | Holds the draft json, not the book's text |
| `fitness_enrollments` | Following a program: started on, current phase, side | |
| `fitness_sessions` | A session: local day, slot, started/finished, feel before/after, note | A day can hold several |
| `fitness_sets` | A logged set: item, exercise, side, count, load (F5), effort, cues felt, pain, idempotency key | Written from the device's queue |

## Key files & seams

Nothing built. Planned: `src/modules/fitness/` (renderer, workout mode,
actions), `src/lib/pdf/` (page text + link annotations), `src/db/schema/fitness.ts`,
`tests/isolation/fitness.test.ts`, `docs/help/fitness/overview.md` with
`**Route:** /dashboard/m/fitness/**`.

## Decisions & gotchas

- **A done day, not a calendar day.** The gate counts days on which every
  non-optional item met its minimum across that day's sessions, in the
  personal space's own timezone.
- **The app never moves a phase on its own.** It says the gate is open.
- **Imported content is private.** No catalogue row, seed or test fixture may
  carry this program's exercises or text. A test fixture invents its own
  program.

## Open items

- Whether each set's count should be entered or only confirmed. Workout mode
  counts breaths itself; a person who did 7 instead of 8 needs one tap to say
  so.
- Apple Health / Google Fit: writing a session as a workout. Not before F3.
- A trainer or physio who wants to see the log (the PDF points at the author's
  coaches) is a read-only share of a personal space, and ADR 0111 has no
  answer for it yet.
