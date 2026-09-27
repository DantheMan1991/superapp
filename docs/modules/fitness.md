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
  author's, on YouTube. They play in YouTube's own embedded player from
  `youtube-nocookie.com`, which is what the author published them for;
  downloading and serving them ourselves would be copying them. F1 embeds the
  plain player behind a click-to-play picture (`video-player.tsx`), with
  `playsinline` so an iPhone does not force full screen and the clip's start
  and end in the URL. Workout mode (F2) moves to the IFrame Player API, which
  adds loop, mute and speed.
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
five are built (F1, migration `0426`); the rest are planned.

| Table | Purpose | Notes |
| --- | --- | --- |
| `fitness_programs` | A program: name, author, source (`imported` / `own`), notes (its rules in words), sessions a week and effort as ranges, `archived_at`, `version` | `version` guards an edit from a second tab. One active at a time will be the UI's rule, not the table's |
| `fitness_phases` | Ordered phases (`position`) with `min_done_days` (1–365, or none) and notes | |
| `fitness_exercises` | name, purpose, cues (jsonb list), unit (`reps` / `breaths` / `rolls` / `seconds`), videos (jsonb list), notes | **`program_id` NOT NULL for now**: an exercise belongs to the program that made it. A library shared between programs is F5, and relaxing this column is where it starts |
| `fitness_phase_items` | An exercise in a phase: position, `sets_min`/`sets_max`, `target_min`/`target_max`, `per_side`, `optional`, notes | Ranges checked in the database (sets 1–20, count 1–1000, a top never below its bottom). Alternative-of and the side rule are F4 |
| `fitness_imports` | A PDF on its way to being a program: file name, pages, links, status (`drafting` / `draft` / `failed` / `saved` / `discarded`), the draft, the error, the program it became | Holds the draft json and the counts, never the book's text; the draft is dropped once saved |
| `fitness_progressions` | A ladder of exercises on an item with its advance rule | F4 |
| `fitness_enrollments` | Following a program: started on, current phase, side | F2/F3 |
| `fitness_sessions` | A session: local day, slot, started/finished, feel before/after, note | F2. A day can hold several |
| `fitness_sets` | A logged set: item, exercise, side, count, load (F5), effort, cues felt, pain, idempotency key | F2. Written from the device's queue |

## Key files & seams

- `src/db/schema/fitness.ts` — the five tables, the enums, `FitnessVideo`.
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
- `src/modules/fitness/actions.ts` — the four server actions, each behind
  `requirePersonalSpace` and the module gate.
- `src/modules/fitness/components/` — `read-program-pdf.ts` (pdfjs on the
  device), `import-form.tsx`, `program-editor.tsx`, `program-view.tsx`,
  `video-player.tsx`, and the discard and delete buttons.
- `src/modules/fitness/FitnessModule.tsx` — the Workouts page.
- `src/app/personal/(space)/m/` — the tool's routes: `[slug]` (the front page),
  `fitness/import`, `fitness/import/[id]`, `fitness/new`,
  `fitness/programs/[id]`, `fitness/programs/[id]/edit`.
- `src/lib/pdf/browser.ts` — `loadPdfjs`, shared with Documents.
- `tests/fitness-core.test.ts`, `tests/fitness-ops.test.ts`,
  `tests/isolation/fitness.test.ts`.
- `docs/help/fitness/` — `overview.md` (`**Route:** /personal/m/fitness/**`),
  `import.md`, `editor.md`, `program.md`.

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

## Open items

- **F1's last check: a video inside the Android app.** Every inline play so
  far was in a browser. Until one plays inside the app on a phone, the
  referrer and the WebView's handling of the frame are assumptions (Inline
  video, above).
- **Delete becomes archive when logs exist.** F1 deletes a program outright,
  and every row under it cascades. Once F2 logs sets against its items, the
  edit screen's `Delete program` must put the program away (`archived_at`,
  already a column and already filtered by `listPrograms`) instead.
- **Scanned PDFs are refused** (`NO_TEXT`). Reading pictures of pages would
  need OCR; nobody has asked.
- **A save is one statement per row.** Fine next to the database; from a
  laptop to Neon a fifteen-exercise program took several seconds to save on
  the drive. Batch the inserts if a program ever feels slow in production.
- Whether each set's count should be entered or only confirmed. Workout mode
  counts breaths itself; a person who did 7 instead of 8 needs one tap to say
  so.
- Apple Health / Google Fit: writing a session as a workout. Not before F3.
- A trainer or physio who wants to see the log (the PDF points at the author's
  coaches) is a read-only share of a personal space, and ADR 0111 has no
  answer for it yet.
