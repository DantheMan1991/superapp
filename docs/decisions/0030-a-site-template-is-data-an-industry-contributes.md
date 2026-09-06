# 0030 — A site template is data an industry contributes; the core assembles it and the writer fills the words

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 15)
- **Affects:** Marketing (`src/lib/site-templates/`, `site-generate.ts`,
  the build and rewrite actions, the starter pictures), the industry layer
  (`src/industries/<slug>/site-template.ts`), `docs/extension-model.md`
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md) (a
  page is typed sections; the writer fills slots the code chose),
  [0009](0009-packs-are-modules-profiles-install-them.md) (a profile is a
  manifest, never components), [0028](0028-a-packs-block-is-data-the-site-draws.md)
  (a registry may know several things exist; no module may)

## Context

Every site started as the same three pages with words true of any small
business, and the founder asked for an elite website for the homestead
farm industry: right visually, right for search, easy to move around,
good at selling, and with room for every industry to have its own. The
site builder is a core tool and must stay industry-blind; an industry
profile is a manifest and must ship no component. So the question was
what shape an industry's website could take that both rules allow.

Three shapes were on the table.

1. **A component per industry.** A React page tree the industry ships and
   the site renders. It breaks the manifest rule at once, drags industry
   UI into the public bundle, and every template becomes a second renderer
   with its own bugs, its own look and no editor.
2. **A prompt per industry.** Keep the three fixed pages and tell the
   writer more about farms. Cheap, and it changes nothing a visitor sees:
   the pages, the sections, the frame and the pictures stay the general
   ones, and a farm site is still a brochure with a contact form.
3. **Data the core assembles.** A template is pages of typed sections
   carrying starter words, a frame, a look and picture slots; the core
   assembles it against what the tenant has switched on, the platform
   draws the pictures, and the writer fills every word slot from the
   brief.

## Decision

A site template is data an industry contributes. `src/lib/site-templates/`
holds the slot: `types.ts` (a template is pages of `Section`s with starter
words, each section optionally conditional on Scheduling or on hours, a
frame of header button and footer columns, a look the template suggests,
and picture slots naming a platform scene), `core.ts` (`assembleTemplate`
applies the conditions, fills `{name}` and `{what}`, keeps a pack's block
only when the tenant's catalogue offers it with every setting chosen, and
parses every page through the content model; `templateSlots` and
`applySiteWords` are the writer's two halves), `registry.ts` (the one file
that names an industry), `general.ts` (the platform's own template, what
every site was). An industry's template lives beside its profile
(`src/industries/homestead-farm/site-template.ts`), data like the profile.
The build picks the template by `tenants.industry`, applies the frame to
the new site and the look to a kit whose owner has chosen none of it,
writes the words through one forced tool over every slot, and puts the
platform's starter scenes, drawn in the brand's colours, into the slots
that asked for them as ordinary library photos the owner replaces in a
click.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A component per industry | Breaks the manifest rule; industry UI in the public bundle; a second renderer per template with no editor. |
| A prompt per industry over the fixed three pages | Changes only the words; the pages, frame, pictures and structure stay generic, which is what the founder called not top notch. |
| Templates as rows in a table | Nothing a tenant edits; a template is code-reviewed data that changes with the content model, and a row would drift from the schema it has to satisfy. |
| Stock photographs shipped with a template | A licence per photo the platform has to hold and a farm that is not this farm on every site; the drawn scenes are the brand's own and carry none. |
| Applying the template's look to a kit the owner already shaped | A default the profile suggests must never overwrite a choice (the `display.currencySymbol` rule); it lands only where every look field is unset. |

## Consequences

- An industry gets a website by writing one data file; the editor, the
  renderer, the writer, the SEO pack and the live blocks all come for
  free, because a template is nothing but sections the site already draws.
- The writer sees every slot with its starter and its length, so a
  template's structure is fixed and its words are the business's; a bad
  answer for one section keeps that section's starter and costs nothing
  else. Without a key the starter words are the site, and they read.
- The general template is what a business with no profile gets, and what
  every existing site was built with; nothing about an existing site
  changed.
- The cost: a template can only be made of the section kinds the site
  has, and a section the industry wants that the site lacks is a section
  to add to the site for everyone (as the price list was), never a
  component the industry ships. Starter words are the template author's
  to keep true of the industry as a kind, never of one business.

## Notes

The slice count on a template's pages, the frame and the look are all
things a template author can get wrong quietly; `tests/site-templates.test.ts`
assembles every template on the registry and parses every page, so a
template that would not save cannot ship.
