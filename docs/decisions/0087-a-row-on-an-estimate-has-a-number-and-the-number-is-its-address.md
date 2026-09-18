# 0087. A row on an estimate has a number, and the number is its address

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the founder, on the estimate editor's redesign — *"every line and group should be able to be reordered. drag and drop style. Also number them. A quick way to reorder them is if a group is say #10 and I want it to be right after #2 I would change the 10 to 3 and it would rearrange it."*

## Context

An estimate has always been an **ordered** document, and the order has always
mattered. `buildPayload` emits each item's lines beneath it and the loose ones
last; `saveLines` turns that emitted order into `sort_order`; the proposal, the
brochure's *What is included* page and the schedule of values all read the rows
in it. A takeoff that reads out of order reads as somebody else's takeoff.

Until now there was **no way to change it**. An estimator who typed the
foundation lines after the framing lines, or who wanted `Sitework` at the top
of a proposal it was written at the bottom of, had one option: delete the rows
and type them again lower down — which loses each row's id, and with the id its
cost code, its client wording and its "keep this one off the proposal". Silent
data loss dressed up as a workaround.

Drag-and-drop is the obvious answer and it is not, on its own, a sufficient
one. Eighty lines in a scrolling panel is exactly the case a drag is worst at:
the target is off-screen, the auto-scroll fights the pinned headers, and on a
phone the gesture competes with the page. The founder named the thing that
actually works on a long document, and it is how every estimating and takeoff
package that predates the mouse worked: **you type the number you want it to
be.**

## Decision

**EVERY ROW CARRIES A NUMBER, AND THE NUMBER IS AN EDITABLE ADDRESS.**

- Items are `1`, `2`, `3` — their order on the estimate and on the proposal.
- A line is `<item>.<place>`: `2.1`, `2.2`. On an estimate with no items at
  all, a line is a bare `1`, `2`, `3`, because there is no section to name.
- **The loose pile is the section after the last item.** Three items make
  *Not in an item* section `4`, and its lines `4.1`, `4.2`. It is numbered on
  purpose: it makes `4.1` an address like any other, which is the keyboard's
  way of taking a line OUT of an item.

Typing over the number and committing it (Enter, or leaving the box) moves the
row there:

- `3` — third in the section it is already in.
- `3.2` — item 3, second line. **A line crosses into another item by its
  number**, which is the ability the redesign otherwise removed when the `Item`
  select came off the visible row.
- A number past the end lands last; a number below 1 lands first. Clamped, not
  refused, because "put it at the bottom" is what somebody typing `99` means.
- Anything the grammar cannot read — `2.0`, `abc`, `1.2.3` — puts the old
  number back and moves nothing. The same rule the entry bar keeps (ADR 0081):
  **refuse what you cannot read, never guess.** A row that quietly went
  somewhere nobody asked for is the expensive kind of wrong on a document that
  gets sent.
- An item takes a bare integer only. `2.1` is not somewhere an item can be.

**AND IT DRAGS.** A grip on every row, dnd-kit, `arrayMove` semantics — a row
takes the slot it was dropped on. A line dropped on a row in another item joins
that item; a line dropped on a section's *Add a line here* strip joins it at
the end, which is how a line reaches an item that has none yet.

**BOTH GO THROUGH ONE PURE FUNCTION.** `estimate-order.ts` holds the whole
arithmetic — `placeLine`, `dragTo`, `dropInSection`, `parseAddress` — and knows
nothing about React, dnd-kit or the database. Twenty-six tests, because the
screen cannot prove this: a row that lands one place off looks exactly like a
row that landed, and the wrong `sort_order` reaches the client's proposal.

**THE LIST THAT COMES BACK IS ALWAYS IN VISUAL ORDER.** Every function
normalises before it returns, so the draft array, the screen and `buildPayload`
cannot disagree. A function that returned "the same array with two elements
swapped" would put the screen and `sort_order` out of step the first time a
line crossed into another item — the bug would be invisible until somebody
opened the proposal.

**NO SCHEMA, NO ACTION, NO PAYLOAD CHANGE.** `sort_order` is already `(i + 1) *
10` over the order the payload arrives in. Reordering the drafts is therefore
already persisted, by autosave, through the writer that was already there. The
only new column on screen is the number itself.

**EVERY DRAFT ROW GAINS A STABLE `key`** — its id once it has one, a local key
until then. React's key, dnd-kit's id and "the row Ctrl+D copies" were all the
row's **index** before this, and an index is the one thing reordering changes.
It also fixes a latent bug: an unsaved row was keyed `new-${i}`, so it was
re-keyed by any change to the array above it.

## Consequences

- An estimator can restructure a bid without retyping it, and the proposal
  reads in the order the job is built in.
- The number column costs ~80px of the left gutter on every row, which is why
  the grip, the number and the expand chevron share one cell.
- The number is **not** stored and is **not** on the proposal. It is the row's
  position rendered, so it renumbers the moment anything moves. An estimate
  whose items should print numbered is a proposal decision, not this one.
- `sort_order` still has gaps of ten. Nothing depends on them being contiguous,
  and nothing should start to.
- The loose pile now renders whenever the estimate has any item, even with no
  loose lines in it — it has to, or there would be nowhere to drop a line
  coming out of an item, and no way to add a loose line at all once the header
  bar's old *Add line* button was replaced by the per-section ones.

## Alternatives rejected

**Drag alone.** What the handoff asked for, and not enough on the document this
screen exists for: eighty lines is the case a drag is worst at, and it is
unreachable from the keyboard in the way the rest of the grid is (ADR 0081's
↑↓, Enter and Ctrl+D).

**A sort-order column you type an arbitrary integer into.** What a lot of line-
of-business software does, and it makes the user do the arithmetic: to put
something between 20 and 30 you have to know the neighbours are 20 and 30.
Positions renumber themselves; sort keys do not.

**Up/down arrows on each row.** Fine for five rows, useless for eighty — moving
a line from 71 to 3 is sixty-eight clicks.

**Storing an explicit position on the row and reordering server-side.** A
second writer to rows this component already owns, which ADR 0082 is explicit
about: the estimate is held in the editor's state and a second writer is how
the two come to disagree. Autosave already persists the order.
