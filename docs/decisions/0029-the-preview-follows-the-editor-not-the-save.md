# 0029 — The preview follows the editor, not the save

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 13)
- **Affects:** Marketing (the page editor's preview, the draft route,
  `src/lib/sites/preview.ts`, `src/components/site/live-draft.tsx`, the
  member route `/api/marketing/sites/live`)
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md)
  (one rendering of a section in the product), [0027](0027-the-assistant-proposes-words-and-the-owner-saves-them.md)
  (nothing is saved but by the owner's Save)

## Context

The editor's preview was the draft route in a frame, reloaded after each
save, so what the owner saw was exactly what the renderer draws — and
nothing else until they pressed Save. The founder said that does not work:
an edit should show at once. Three ways to get there.

1. **Save on every change.** The preview stays as it is and the editor
   saves as the owner types. Every keystroke becomes a version in a history
   that keeps thirty, and a page is saved that nobody meant to save, which
   ADR 0027 just refused for the assistant. A separate "scratch" column
   avoids the versions and keeps the round trip: a change shows a second
   or two later, after a write.
2. **Render the page inside the editor.** A second mounting of the
   renderer in the editor's own document, fed the editor's state. No frame,
   so no round trip — and no device widths either: the renderer's phone
   and tablet layouts are the browser's breakpoints, which a 390-pixel
   column inside a wide page does not trigger, and the dashboard's styles
   and the site's share one document.
3. **Keep the frame; send it the draft.** The draft route, in the frame,
   redraws with what the editor sends it.

## Decision

The frame stays and the editor sends it the draft. The draft route, asked
for `?live=1`, renders the saved draft as before and then hands the page to
a client component (`LiveDraft`) that listens for the editor's
`yosher:site-draft` message and redraws the same renderer with the page as
it stands: title, path, sections, and the photos the editor holds. The
editor sends it a moment after every edit and again whenever the frame
says it is ready. Live data a section needs that the page did not load —
a pack block just added, the events calendar — is read from a member
route that makes the same two reads the draft route makes, for sections
that are not saved yet. Nothing is saved by looking; Save still keeps the
page, and the frame still reloads after it so what is kept is what is
shown.

The shape the frame believes is checked (strings where strings go, a
section a kind the renderer draws, at most the page's maximum), the
content model's limits are not: a headline being typed is blank for a
moment and the preview shows that rather than stopping. The renderer draws
what it is given and turns anything unsafe into nothing, as it does for a
stored row, so a draft that could not be saved can still be seen.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Save on every change | A version per keystroke, a page saved by nobody, and a second's lag per edit. |
| A scratch column autosaved | Still a write and a round trip per edit; a second copy of the draft to keep straight. |
| The renderer mounted in the editor's document | No device widths (breakpoints are the browser's, not the column's), and two stylesheets in one document. |
| Parse the draft through the content model before drawing | The preview would freeze on a blank required field mid-edit; the shape check keeps the frame safe without that. |

## Consequences

- Every edit shows at once, at the device width chosen, in the one
  renderer. There is still one rendering of a section in the product; only
  where its words come from changed.
- The draft route grew one client component that imports the renderer,
  so the renderer now has to stay free of server-only imports. It was, and
  `live-draft.tsx` says so at the top.
- A member route answers what unsaved sections would show live; it reads
  only, through the same functions the page does, and answers nothing a
  member could not see on the draft page.
- The cost: the frame draws twice on load (the saved draft, then the
  editor's), and a photo uploaded mid-edit shows only once the editor has
  its size, which it has as soon as the upload registers.

## Notes

The `yosher:site-draft` message is the fourth in the preview protocol
(`src/lib/sites/preview.ts`); every message is checked there before it is
believed, on both sides, and only from the other window on this origin.
