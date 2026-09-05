# 0028 — A pack's block on the website is data the site draws

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 9b)
- **Affects:** Marketing (the `block` section, `src/lib/site-blocks/`,
  the page editor, the renderer), every pack that wants a place on a
  tenant's website (Retail first, `src/packs/retail/site-blocks.ts`),
  `docs/extension-model.md` P5
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md) (a
  page is typed sections, never markup), [0024](0024-a-look-is-a-preset-and-its-fonts-are-the-platforms.md)
  (a visitor's browser asks no third party for anything), the P5
  precedents (`production/core/handler.ts` and `src/packs/run-handlers.ts`;
  `src/lib/basis-lens/registry.ts` with `packs/inventory/basis-lens.ts`)

## Context

Prices and what has run out belong on a small business's website, and
both live in packs: a price is a row on `(channel, item)` in Retail, a
balance is Inventory's. The site is a core module and must not learn that
either pack exists; a pack must not learn the shape of a page. The two
have to meet somewhere, and the same place has to serve the shop block
(`retail` slice 6) when it comes, so it was worth deciding once.

Four ways were on the table.

1. **The pack ships a React renderer and an editor component.** The site
   would import a map of components by kind. That drags every pack's UI
   into the public page's bundle and the editor's, lets a pack put its own
   markup on a public origin the site is responsible for, and lets the
   block look like a widget dropped on the page rather than a section of
   it.
2. **Pack-owned section kinds in the content model.** The discriminated
   union would grow a member per pack, so the content model, its tests
   and the assistant's slot map would change every time a pack added a
   block, and a page saved by a tenant whose pack is off would hold a
   kind the site no longer knew.
3. **An embed.** The pack serves a page the site frames. That is a request
   from the visitor's browser to something other than the page's own
   origin, which ADR 0024 closed, and it has none of the site's look.
4. **A declared slot: the pack answers data, the site draws it.**

## Decision

The site names a slot and a pack fills it with data. `src/lib/site-blocks/`
holds the slot: types only in `types.ts`; `registry.ts`, the one file in
the chain that names a pack; `resolve.ts`, which the site calls. A
provider is a kind (`pack.block`), a label and a hint, a list of editor
FIELDS described in data (a select with options, a switch), a pure
`parseConfig`, and a `load` that answers ROWS: a name, a word or two, an
amount, and whether it is to be had. One section kind, `block`, carries
the kind and the config; the editor draws a provider's fields from their
descriptions and the renderer draws its rows in the site's own look. Both
happen only while the pack is switched on for the tenant, read inside the
page's own transaction; a block whose pack is off is not offered, is not
saved, and draws nothing.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A pack ships React for the page and the editor | Pack UI in the public bundle and the editor's; pack markup on a public origin; a widget's look, not a section's. |
| A section kind per pack in the union | The content model, its tests and the assistant's slot map change per pack; a saved page can hold a kind nobody serves. |
| An embed the site frames | A third-party request from the visitor's browser (ADR 0024) and no share of the look. |
| Ungated, like the basis lens | A price list is a thing the business shows the public; a business that turned Retail off has stopped showing it. The basis lens is the opposite case: a recorded election outlives the toggle. |

## Consequences

- A pack puts a list on the website in one server-only file with no
  component, and the site gains it with no change: Retail's price list is
  about sixty lines plus a pure presenter. The shop block is the next
  provider on the list.
- Every block reads as part of the page: the site's fonts, tone, spacing
  and background presets apply, and the section's heading, note and empty
  line are the owner's.
- The view model is deliberately narrow: rows. A block that needs a
  visitor to act (a cart, a pickup window) needs a client island, and the
  way to add one is for the SITE to own the island and a provider to name
  it from a list the site keeps, never to ship script. That is the shop
  block's first job and a change to this slot, not a departure from it.
- Freshness is the page cache's: a price changed in Retail reaches the
  site within the ISR window; a save or a publish redraws at once.
- The cost: a pack cannot draw anything the row shape does not say, and a
  block's editor controls are limited to what the field descriptions can
  express (a select, a switch). Both are meant to grow by adding a kind of
  field or a kind of view to the slot, where every pack gets it.

## Notes

The gate is the difference from the basis lens and worth remembering: a
slot that publishes to strangers is gated on the pack being on; a slot
that applies a recorded decision is not.
