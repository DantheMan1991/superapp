# 0080. An estimate line carries the client's words beside the estimator's, and a line kept off the proposal collapses the item that holds it

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, from the estimate review: "clients don't care about cost codes so i wouldn't show it to them. there needs to be an item title or something to show instead"

## Context

[ADR 0079](0079-an-estimate-groups-its-lines-into-the-items-the-client-sees-and-a-group-priced-fixed-is-the-price-not-a-cost-to-mark-up.md)
gave the estimate the noun the client buys — an item, named in the client's
words — and that answered most of the founder's complaint. Three things it
did not answer, all of them the same question asked at a different grain:

**The line's own words.** An estimator types `Tile — mud set, Schluter, mtl
only, per AJ quote 8/14`. That is a good line: it says where the price came
from and what the scope excludes, and in six months it is why the number
was what it was. It is also unreadable to a homeowner, and on a proposal
that shows lines — a takeoff, a unit-price bid, or any estimate whose
items are left to add up — it is what the client reads.

**The line nobody should see.** Contingency. Supervision. An allowance
carry. Cleanup labour a builder prices but will not itemise. Today the
only way to keep one off the proposal is to fold it into another line's
cost, which makes that line's unit cost a lie.

**The cost code's number.** `09 30 00 · Tiling` is what the `codes`
presentation prints. The number is an accounting key; a homeowner reading
it learns nothing and wonders what it is. But the `codes` presentation
exists precisely for the commercial client who *does* expect a CSI
breakdown, so the number cannot simply go.

The hard part is the second one, and it is not the hiding — it is the
arithmetic. **Money that stops printing has to still add up.** The
proposal's cent-perfect property (ADR 0070: the rows add to the total)
and the schedule of values' (a G703 must total the contract sum) are both
broken by a row that quietly disappears.

## Decision

**A LINE CARRIES A SECOND DESCRIPTION, AND A BLANK ONE MEANS "USE THE
FIRST".** `client_description` on `job_estimate_lines`. Every place a
LINE's words reach the client takes it when it is there and the
estimator's when it is not: the proposal's line rows, and — because a pay
application is an ordinary invoice the owner receives (ADR 0058) — **the
schedule of values**, so the continuation sheet the owner certifies reads
in the words the contract was signed in. An ITEM needs none: its name is
already the client's (ADR 0079).

**A LINE MAY BE KEPT OFF THE PROPOSAL, AND ONLY INSIDE AN ITEM.**
`client_visible`, true by default. A hidden line's money counts
everywhere it counted before — the item's price, the estimate's cost, the
total, the margin, the budget — it simply is not a row. **Hiding is
refused on a loose line**, by a CHECK (`client_visible or group_id is not
null`), by the op, and by the editor not offering it, because hidden money
must have somewhere to hide: a hidden loose line on a line-by-line
proposal is money with no row, and the page stops adding up. An item is
that somewhere.

**AND THE ITEM THAT HOLDS IT COLLAPSES.** One predicate, `itemCollapses`,
in the pure module, true when an item is **priced by hand** or **hides any
of its lines**. Where it is true the item prints as a single row at its
price instead of a heading over its lines — in the proposal's takeoff
shape and in the schedule of values written line by line, the two places
that would otherwise print a partial build-up that does not sum. ADR 0079
already made this choice for the fixed price ("typing a price is itself the
statement that the build-up is not the client's"); hiding a line is the
same statement about the same item, so it takes the same rule rather than a
second one. **That is the whole of the arithmetic**: no share to spread, no
catch-all row, nothing to reconcile.

**Hiding is about not itemising, not about concealment.** A hidden line's
money still lands in its cost code's sum, so the `codes` presentation can
show an amount that is only a hidden line's. That is the honest limit and
it is written in the guide: a business that wants the money untraceable
too prices the item by hand.

**THE COST CODE'S NUMBER IS OFF BY DEFAULT.** `show_code_numbers` on
`job_estimates`, false. The `codes` presentation prints `Tiling`; ticked,
it prints `09 30 00 · Tiling` for the commercial client who wants the CSI
breakdown. False is the default because the number is an internal key and
most clients are not reading a schedule. It is a printing choice, so — like
the presentation itself — it stays free on an accepted estimate.

## Consequences

- Two columns on `job_estimate_lines` (`client_description` bounded at 300
  like the description it stands in for, `client_visible` with its CHECK)
  and one on `job_estimates` (`show_code_numbers`). Columns on existing
  tables, so **no RLS migration** — the 0347 and 0358 precedent.
- `EstimateLineFigures` gains `clientVisible`, optional and defaulting to
  visible, so every existing caller and every pinned line is unchanged.
- `scheduleRows` gains no argument: `detail` and `line` both ask
  `itemCollapses`. The by-item shape and the `groups` presentation are
  untouched — an item was already one row there.
- The editor gets **one** switch, *Client wording*, which reveals the
  second description and the show-to-the-client tick per line. Off by
  default: writing the client's words is a pass of its own, and the table
  is already wider than its box. A hidden line is marked in the row
  whether the switch is on or off, because a line you cannot see is a line
  you will forget.
- **Not built, on purpose:** a client-facing name on the cost code itself
  (that is a rename of `09 30 00` for every job the business will ever run,
  and ADR 0079 rejected it for the same reason); hiding a whole item; and
  a client-facing unit — `cy` is `cy` to everybody.

## Alternatives considered

- **One description, rewritten for the client when the estimate is sent.**
  Rejected: it destroys the note that says where the price came from, which
  is the thing a builder reads the estimate again for.
- **Hiding allowed on a loose line, with the money spread over the visible
  rows.** Rejected: it silently changes what every other row says it
  costs, which is the same lie as folding it into a neighbour's unit cost.
- **Hiding allowed on a loose line, with a catch-all row.** Rejected: a
  proposal line reading *Other, $4,200* invites exactly the question the
  builder was avoiding.
- **A second predicate for hiding, separate from the fixed price.**
  Rejected: two ways for an item to collapse is two things to keep in step,
  and the statement they make is identical.
- **The cost code number on by default, with a tick to hide it.** Rejected:
  the founder's complaint was that clients see the codes at all; the
  default should be the common case.
