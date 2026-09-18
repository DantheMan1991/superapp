# 0088. The page column is 100rem and a sentence is 80ch, and those are two different numbers

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the founder, looking at the app on a 3,440px monitor — *"On a wide screen there is a lot of wasted real estate."*

## Context

The shell has always put every standard page in one centred column,
`max-w-6xl` — 72rem, 1,152px. On a laptop that is the whole usable width and
nobody notices it. On the ultrawide the founder actually works on it is 1,152px
of product between two 1,000px margins: a third of the screen, and the two
thirds either side are grey.

Two escapes already existed and neither is the answer here.
`ModuleDefinition.layout: "full"` hands a module the viewport (Mail uses it,
for a list beside a detail pane) and `fullWidthPaths` does the same for one
screen inside an ordinary module (Marketing's page editor). Both are for the
shape that genuinely needs the whole monitor. They do not help the other 138
pages, which are lists, forms and detail screens.

The reason the clamp was there is real: **a page that simply fills the monitor
gets worse, not better.** Measured on the live app at 2,400px with the clamp
removed:

- the estimate editor's description column became **1,136px** — one text input
  a thousand pixels wide, with the money columns marooned at the far right;
- a jobs list row put its first cell and its status chip a head-turn apart;
- the dashboard's explanatory paragraph ran **219 characters to the line**, and
  at 1,152px it was already 164.

That last one is the finding that shaped this decision. The prose was ALREADY
too long before anything changed. The clamp was doing two jobs — bounding the
page and bounding the sentence — and it was only ever the right number for one
of them.

## Decision

**TWO TOKENS, BECAUSE THEY ARE TWO DIFFERENT QUESTIONS.**

- **`--container-content: 100rem`** (1,600px) — how wide a PAGE gets. The
  shell's column, `max-w-content`. Chosen because it is roughly twice the old
  column on the screens that were starved and still short enough that a table
  row reads across without moving your head. It is a **cap, not full bleed**:
  at some width a row of a table stops being a row and becomes a journey, and
  nothing about a 3,440px monitor makes a 3,200px table readable.
- **`--container-measure: 80ch`** (~742px at 14px) — how wide a SENTENCE gets,
  wherever it appears. **In `ch`, so it scales with the type**: a 12px note
  gets a narrower box and the same character count. A measure in pixels is a
  measure for one font size only.

**THE SENTENCE CAP IS A RULE, NOT 398 CALL SITES.**

```css
[data-app-main] p { max-width: var(--container-measure); }
[data-app-main] p.text-center { margin-inline: auto; }
```

A static scan found 398 uncapped explanatory paragraphs across 188 files.
Editing them is a week of churn, a merge conflict with every open branch, and a
rule nobody can enforce afterwards. Almost none of them wanted to be a layout
row — of 1,207 paragraphs in the app tree only 56 are flex rows or right-aligned
figures, and every one of those sits in a container far narrower than the cap,
so the cap never reaches them. **A paragraph that genuinely is a layout row says
`max-w-none`**, which is also how any future one opts out.

The second rule is for the "nothing here yet" placeholders: centred text in a
capped box has to keep the box centred, or it sits off to the left of the panel
it fills. It is the one place this couples to a Tailwind class name, and that is
worth it for 39 call sites.

Scoped to `[data-app-main]` so a dialog, the public marketing site and the
printed proposal are untouched — each of those sets its own measure, and the
marketing site keeps `max-w-6xl` on purpose.

**FORM CONTROLS ARE NOT CAPPED IN CSS.** The same blanket rule for `input` and
`textarea` was written and thrown away: the estimate editor's description cell
is *meant* to be 1,136px, and so is a search bar, and so is a mail composer.
There is no width that is right for both a domain name and a takeoff line. The
five controls the instrument found over 900px were capped at their call sites
instead.

## Consequences

- Every list, table and detail screen in the product gains ~450px of usable
  width, and the estimate editor's container queries take it straight to a
  seven-column grid with a 591px description.
- Running text is **shorter** than it was before this change, not longer.
- `max-w-content` and `max-w-measure` are Tailwind v4 utilities generated from
  the tokens. **Drop or rename a token and the class silently stops existing** —
  no error, no failing build, and the page quietly un-clamps.
  `tests/layout-width.test.ts` is the guard, and it was proved by breaking both
  tokens and watching two assertions fail.
- The per-module and per-path full-width escapes are unchanged and still right
  for the list-beside-detail shape.
- 100rem is a judgement, not a law. The founder chose it over full bleed; if an
  ultrawide still reads as empty, the token is one line.

## How it was checked

An instrument, not a tour of 138 screens. A same-origin iframe pinned at
2,400px loads each route in turn and reports, per page, every form control over
900px and every paragraph over 95 characters a line — the character count
measured from Geist's real advance width (0.663em), not guessed. 89 static
routes, the module homes and 15 harvested detail pages came back clean apart
from five controls, which were fixed. Two of the flagged items were false
positives worth writing down: a `<li>` that is a flex row with `ml-auto`, and a
`<p>` acting as a totals row, are full-width on purpose.

## Alternatives rejected

**Full bleed, no cap.** Uses every pixel, and makes a table row a journey. The
founder was offered it and chose the cap.

**Raise the clamp and fix the pages by hand.** 398 paragraphs in 188 files, and
the 399th lands the week after.

**Cap the measure on `.prose` only.** The product's explanatory text is not
`.prose`; it is a `<p className="text-sm text-muted-foreground">` under a
heading, 398 times.

**Per-page widths.** The thing people notice about a shell is that pages line
up. One column, one number.
