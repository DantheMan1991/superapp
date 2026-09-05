# 0027 — The assistant proposes words into slots the code chose, and the owner saves them

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 12)
- **Affects:** Marketing (the page editor's three assistant controls,
  `src/modules/marketing/assistant.ts`, `assistant-actions.ts`,
  `ai/assistant-prompt.ts`), `docs/security.md` trust boundaries; the shape
  any later "assistant in a screen" should copy
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md) (a
  page is typed sections; the model writes into fixed slots and the code
  assembles), [0006](0006-agents-act-by-delegation.md) (an
  agent acts through a member's delegation, never as its own principal)

## Context

Slice 1 let the assistant write a whole site once, from the brand kit and
the business's details, into slots the code chose. Slice 12 puts it inside
the editor: rewrite one section, write a page from a sentence, describe a
photo. The obvious build was a chat beside the page that edits it — "make
the hero warmer", "add a section about tours", "fix the photo captions" —
with the model deciding what to change, where, and saving as it goes.
Three things argued against it.

1. **Who saves.** A page's words are how the business looks to its
   customers, which is why every write in this module is owner-only
   (`gate.ts`). A model that writes rows is a writer the owner did not
   read; ADR 0006 says an agent acts by delegation, and the plainest
   delegation is "show me, and I press Save".
2. **What the model may touch.** A section carries words, but also a
   photo, an icon, a link, a rule (a booking's days and hours), and a look.
   A free-form edit can change any of them; a `javascript:` link, a wrong
   calendar rule or a swapped photo is a worse mistake than a dull sentence,
   and one the owner would not think to check after asking for warmer words.
3. **What leaves the platform.** A chat that edits the page needs the whole
   page in its context, and the site around it, on every turn. The facts a
   public page already prints are the business's own; a visitor's message,
   a booking, a draft nobody has published are not.

## Decision

The assistant proposes; the owner saves. Each of the three controls sends
the model a brief (the business's name, tagline, kind, address and hours:
what its own public page says) plus one thing — the words of one section by
slot with a length for each, one sentence about a page, or one photo's
pixels — and receives words back through one forced tool. The code puts
those words into the slots it chose (`applyWords`, `assemblePageBlocks`),
parses the result through the content model, and hands it to the editor's
own state, where it is unsaved until the owner presses Save like any other
edit. Nothing about a section but its words is sent, and nothing but its
words can change; a page from a sentence is blocks from a fixed list of
kinds with the code's defaults for everything the model did not write; a
photo's description is made from the pixels alone.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A chat beside the page that edits it and saves | The model becomes a writer the owner did not read, with the whole page and site in context on every turn; the owner cannot see what changed besides what they asked for. |
| The model returns a whole section, or whole page content, as JSON | It would then choose photos, links, icons, rules and the look, which are not words; one bad field costs the whole answer; and the schema it has to match is the content model's, which changes every slice. |
| Apply and save on the server, then revalidate | Saves are the owner's; a save the assistant made is a version in history nobody pressed, and a mistake goes live on the next Publish. |
| Send the section with its photo so the rewrite can describe it | The description is its own control, from the pixels alone; a rewrite that also renames a photo changes something the owner did not ask about. |

## Consequences

- Every answer is the owner's to read first, and every mistake is undone by
  not saving. The controls say so ("Read it, then save").
- The shape is one function per control, each pure until the model call
  and injectable in tests, and the model never sees a row id, a visitor, a
  session or a file path.
- A press is a model call; the valve is per tenant per hour
  (`site_assistant` in `public_access_attempts`), so a stuck button cannot
  run a bill.
- The cost: no conversation. The assistant does not remember the last
  press, cannot be asked "no, shorter" without the owner typing it into the
  instruction box, and cannot add a section to a page it did not write. A
  conversational assistant, if wanted, is a later layer over these three
  doors, not a replacement for them.

## Notes

The three doors are the pattern for the assistant in any other screen: a
brief of facts the tenant already publishes, one bounded input, one forced
tool, a validator, and the screen's own unsaved state. Revisit if a client
asks for the conversation and is willing to have it save.
