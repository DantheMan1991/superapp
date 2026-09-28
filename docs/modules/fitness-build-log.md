# Fitness — build log archive

> The oldest entries of [fitness.md](fitness.md)'s build log, moved here on
> 2026-09-27 so the dossier stays readable. Nothing was edited: they are exactly
> as written, newest first. Where an entry says "see Decisions" or
> "below, Open items", it means those sections of [fitness.md](fitness.md),
> which is still the file to read first.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

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
