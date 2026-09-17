# 0081. An estimate line can be typed as one sentence, and the grammar that reads it is pure, learns its units, and refuses what it cannot read

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, from the estimate review: "think speed when it comes to building the estimate. how can we make it extremly fast and yet have all of the info we need"

## Context

The estimate had the right model after [ADR 0079](0079-an-estimate-groups-its-lines-into-the-items-the-client-sees-and-a-group-priced-fixed-is-the-price-not-a-cost-to-mark-up.md)
and [ADR 0080](0080-an-estimate-line-carries-the-clients-words-beside-the-estimators-and-a-line-kept-off-the-proposal-collapses-the-item-that-holds-it.md)
and was still slow to fill in. A line is nine cells, most of them empty on
most lines, and reaching them means the mouse: a cost code select, a
description, a quantity, a unit, a unit cost, a markup, a unit price. A
two-hundred-line takeoff is eighteen hundred interactions.

Where the time actually goes, in the order it costs: typing lines that are
near-copies of the line above; mousing between cells; retyping what is
already in a spreadsheet or a supplier's email; and — separately, and worse
— one Save button at the bottom of a form that holds every line in one
piece of state.

Two questions were open: **what a fast way in looks like**, and **whether
the platform's existing paste machinery is it**.

## Decision

**A LINE CAN BE TYPED AS ONE SENTENCE.** One field under the table; Enter
commits it and the cursor never leaves. The grammar:

| Typed | Read as |
| --- | --- |
| `320 sf tile @ 4.20` | 320 sf of *tile* at $4.20 |
| `tile labour 320 sf @ 3.50` | the same, said the other way round |
| `120 cy concrete 185` | the `@` is optional; a trailing number is the price |
| `plumbing rough 12000` | a lump sum of $12,000 |
| `plumbing rough` | the description now, the money later |
| `Tile→320→sf→4.20` | a spreadsheet row, tabs and all |

**ONE PURE FUNCTION, THREE DOORS.** `estimate-parse.ts` — the entry bar
commits one sentence, the paste box runs a block through the same function,
and the day a phone hears *"kitchen tile, three hundred and twenty square
feet, four twenty a foot"* it is the same function a third time. That is why
the grammar is a pure module with a table test and not a handler in a
component: the voice slice is a second *door*, never a second pipeline,
which is the rule the tell sources already set.

**IT LEARNS THE UNITS AND NOTHING IS CONFIGURED.** `320 sf tile` has a unit
and `2 coats paint` does not, and no rule about the shape of words can tell
them apart. So the parser is given the units it should KNOW: `COMMON_UNITS`
— the trade's own abbreviations — unioned with **every unit this business
has already typed on an estimate** (`unitsInUse`) and every unit typed on
the estimate open in front of you. A business that writes `bdl` is
understood the first time, and a word off both lists simply reads as part of
the description. The unit column stays free text; this is a hint to a
parser, never a validation of anything.

**A SENTENCE IT CANNOT READ IS REFUSED, NEVER GUESSED.** `null`, not a line
with a zero in it. `tile @ four twenty` is a typo and a silent $0.00 on a
bid is the expensive kind of wrong, so the entry bar says it could not read
that and leaves the text where it is; the paste preview marks the row and
says it will be left out. A sentence with no description is refused for the
same reason — `320 sf @ 4.20` is a quantity and a price for nothing.

**PASTING IS THE SAME GRAMMAR, NOT A PASTE TARGET.** The platform's
paste-target framework (ADR 0036) was the obvious candidate and is the wrong
tool here, for two reasons. A target is described per TENANT — `describe(tx,
ctx)` — with no way to say *which estimate*, because it exists to move a
business in: vendors, items, animals, things that have no container. An
estimate line is a row inside a document you already have open. And a
target's `save` writes one row through the module's own verb, which for an
estimate line is `updateEstimate` over the whole lines array. Forcing it
would have meant an "Estimate" choice column repeated on every row of a
forty-line quote. So the paste box on the estimate is a textarea, the pure
parser per line, and a preview that shows every row before anything is
added. **The model-driven route stays available** for the day somebody wants
to paste a supplier's PDF quote and have it read — that is a different
thing, and it can be a target then.

**CTRL+D COPIES THE ROW THE CURSOR IS IN**, without its id, directly
beneath. Most lines in a takeoff are near-copies of the line above, and this
is the cheapest interaction in the slice.

**THE ITEM A TYPED LINE LANDS IN STAYS WHERE IT WAS PUT.** One select beside
the entry bar rather than one bar per item, defaulting to none and holding
its choice, because a builder types an item's lines together. It disappears
when the estimate has no items, like the row's own item column.

## Consequences

- One new pure module, `estimate-parse.ts` (`parseEstimateLine`,
  `parseEstimateLines`, `COMMON_UNITS`, `unitsFor`), pinned by a table test
  including every refusal.
- One new read, `unitsInUse`, and one prop threaded to the editor. Nothing
  about the schema changes: **this slice has no migration.**
- The editor gains the bar, the paste dialog, the Ctrl+D handler and a
  focused-row state. It still saves in one piece — **per-row saving and
  keyboard grid navigation are E3b**, deliberately a slice of their own
  because they change the concurrency model (`STALE_VERSION`) rather than
  adding a way in.
- **A bug fixed on the way past, and it was one word.** This screen scrolled
  the whole PAGE sideways by 276px (`documentElement.scrollWidth` 1220
  against a 944 client width). The cause is not the table's width: the row
  buttons carry `sr-only` labels, Tailwind makes those `position: absolute`,
  and with no positioned ancestor their containing block is the page — so
  they sit at their static x past 1,200px and stretch the document, and
  `overflow-x-auto` never clips them because it is not their containing
  block. `relative` on the wrapper fixes it and the table still scrolls in
  its own box. Eight other screens have the same combination, including the
  invoice, bill and journal editors; they are their own task.
- **Not built, on purpose:** `@assembly 320` (E6 — the grammar has the room
  and the `@` is already spoken for as the price separator, so a leading one
  is free when the time comes); a cost code in the sentence; and the price
  memory that would fill the cost in from the last time that description was
  priced, which is E4 and wants a few real estimates typed first.

## Alternatives considered

- **Use the paste-target framework.** Rejected above: no way to name the
  estimate, and a one-row-per-verb `save` an estimate line does not have.
- **A strict column format for the paste box** (`description, qty, unit,
  cost`). Rejected: the same grammar reads a spreadsheet row already,
  because a tab means the same as a space, and one grammar is one thing to
  learn and one thing to test.
- **Guess at what a sentence meant** — nearest unit, zero for an unreadable
  price. Rejected: see the refusal rule. A bid is a number somebody signs.
- **A unit list the tenant configures.** Rejected: a settings screen for a
  list the estimates already contain.
- **A duplicate button on every row** instead of Ctrl+D. Rejected for now:
  the table is the widest thing on the screen and the slice is about
  keystrokes, so the hint under the bar says what the shortcut is.
