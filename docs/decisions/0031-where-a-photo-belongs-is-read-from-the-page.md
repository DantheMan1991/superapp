# 0031 — Where a photo belongs is read from the page, never stored; the template says what to take

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 18)
- **Affects:** Marketing (`src/lib/sites/shots.ts`, the shot list screen,
  `placePhotoAction`), the industry layer (`SiteTemplate.shots`,
  `TemplatePicture.shot`), `docs/extension-model.md`
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md) (a
  page is typed sections, so the code knows what each section can carry),
  [0023](0023-photos-are-one-derivative-in-the-sites-library.md) (a photo
  is a library row a section refers to), [0030](0030-a-site-template-is-data-an-industry-contributes.md)
  (an industry contributes data, never components)

## Context

The founder looked at his own Shop page: three tinted tiles with an
initial each, no photos, and no way of knowing the tiles were meant to
carry them. The pages know where a photo belongs, because every section
kind is typed and its photo fields are named; what was missing was the
pages saying so, in a form a person can act on, ideally from a phone
standing in the field. Three shapes were on the table.

1. **A stored checklist.** A table of "photos wanted" written when the
   site is built and ticked off as photos land. It drifts the moment a
   section is added, moved or removed, needs a migration, a sweep to keep
   it honest, and a second UI to manage it, and it still could not know
   what a good photo for a farm's beef tile looks like.
2. **Placeholders in the renderer.** A dashed "photo goes here" wherever a
   section has none, on the draft preview. It shows the where and not the
   what, one page at a time, and the owner has to open every page to find
   out how many are missing. It is also the first step down a road where
   the public renderer grows owner-facing chrome.
3. **A list read from the pages, with the words from the template.** A
   pure function over the draft lists every spot a photo can go, what it
   holds (a photo, one of the platform's drawn stand-ins, nothing) and its
   shape; the industry's template says what to take there in its own
   terms, and the core says it in neutral ones where the template is
   silent. One action puts a photo into a spot by saving the page the way
   the editor does.

## Decision

The third. `pageSpots` in `src/lib/sites/shots.ts` is the list; nothing
about it is stored. A spot is addressed by a key (`"<section>:<where>"`)
that `placePhoto` applies to the content as it is NOW and refuses, with
the reason, when the page has changed underneath it. The industry's notes
live on its template as data (`shots` by role, `shot` on a picture slot),
matched by role and by slot, with a check that the section at a slot is
still of the kind the template put there; an owner's edit falls back to
the role's words, never to a sentence about the wrong section. The
core's own notes (`GENERIC_SHOTS`) are true of any business, and a test
keeps them free of any industry's words.

The screen is built for a phone: a file input with `capture="environment"`
is the camera, offered where the device reports touch points, and the
plain upload and the library stand beside it everywhere. Placing a photo
is `placePhotoAction`: owner-only through the module's one gate, the page
and the photo read under RLS, the save through `savePageDraft` so a
version is kept, an audit row with identifiers only.

## Consequences

- The list is right by construction: a section saved in the editor is on
  it at once, a moved section keeps its spot, a deleted one is gone. No
  migration, no sweep, no second source of truth.
- The stand-ins are known by the name their file carries (`starter-`), the
  same name `starter-pictures.ts` reuses them by; a renamed convention
  breaks both, which is why the prefix is one exported constant.
- A template's notes are per role, so a new section kind that carries a
  photo needs a role and a generic note before an industry can speak to
  it; the type makes the omission a compile error.
- The draft preview still draws no placeholder where a photo is missing.
  If one is ever wanted it is a `mode === "draft"` notice like the map's,
  never anything on the public page.
- The camera is offered on a guess (`navigator.maxTouchPoints`). A touch
  laptop sees a `Take a photo` button that opens a file window; the upload
  button beside it is the same path, so nothing is lost.
