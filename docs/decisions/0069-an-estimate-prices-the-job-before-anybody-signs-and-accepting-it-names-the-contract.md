# 0069. An estimate prices the job before anybody signs: cost and price are two numbers on every line, and accepting it names the contract

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** founder, with the `jobs` pack's estimating slice (construction plan slice 10) as the forcing case

## Context

Every builder prices the job before anybody signs, and the shape of that
pricing is the most varied thing in the trade. A custom builder types a
takeoff by cost code — 120 cubic yards of concrete at $185, forty thousand
dollars of framing labour — marks each line up, and adds overhead and
profit below the lines. A remodeler prices the whole thing as a lump sum
with a margin. An excavator bids by the unit — $12 a cubic yard, quantities
to be measured — and the unit price *is* the number the client sees. A
production builder's price is the plan's price and the estimate is a cost
check against it. Some mark up every line, some mark up nothing and take
their profit below, some do both; some call it "ten and ten", some call it
"overhead and profit", some call it "margin". Every one of them wants two
figures at the end: **what it will cost** and **what they will charge**,
and the gap between.

Then the client says yes, and the estimate becomes three other things the
pack already has: the **contract's value** (slice 1), the **budget** by
cost code (slice 3), and the **schedule of values** the job bills against
(slice 5). Today each of those is typed again, by hand, from the estimate
in the spreadsheet.

The plan called this slice 10 — "takeoff, assemblies, unit costs, bid" —
and noted it "wants units of measure settled and a cost code set to
estimate into", both of which the pack now has (ADR 0064's thousandths and
rounding; the cost code set a project is charted on).

Three questions were open: **what an estimate line carries**, **where
overhead and profit sit**, and **what accepting an estimate does**.

## Decision

**COST AND PRICE ARE TWO NUMBERS ON EVERY LINE.** An estimate line is a
quantity of a unit at a **unit cost** — a blank quantity is one, a lump
sum — and it sells at a **markup** on that cost, the line's own rate or the
estimate's default, *unless a price per unit is typed*, which is how a
unit-price bid is written and which wins over any markup. The extended
figures — the line's cost and its price — are never stored; they are
computed wherever they are shown, the change order's and the schedule of
values' rule, so a line typed as 320 sf at $4.20 and a line typed as
$1,344.00 agree to the cent, and so does a line marked up whole and a line
marked up by the unit (the markup is applied to the *extended* cost, once,
which is what keeps that true).

**OVERHEAD SITS ON THE SUBTOTAL; PROFIT ON THE SUBTOTAL PLUS OVERHEAD.**
Below the lines the estimate carries two rates, each a percentage up to
1,000%, each rounded once: overhead on the lines' price, profit on the
lines' price plus overhead — the trade's "ten and ten". A business that
marks up its lines and stops leaves both at zero and gets the subtotal
back; a business that sells at cost and takes its margin below leaves the
markup at zero. Both are the same estimate. Nothing in the pack says which
is right, and the margin — total less cost, and its percentage — is shown
either way, because that is the number the owner actually reads.

**ACCEPTING AN ESTIMATE NAMES THE CONTRACT, AND FIXES THE ESTIMATE.** The
client's yes is recorded by an owner against a contract on the job: the
estimate's total becomes that contract's value (through the existing verb,
so a *signed* contract's value is refused the same way it is refused from
the form — the price of a signed agreement moves by change order, ADR
0058's rule — and, by the same verb's one exception, a signed contract with
no value recorded yet takes the estimate's total as entry, not revision:
the cost-plus agreement on the dev job, worth nothing on paper, accepted
its estimate that way), the estimate keeps `contract_id`, and from then its rates and
lines are shown and not sent. A revision is a new estimate, and the old one
is marked superseded. The other two things the estimate becomes are
separate, deliberate acts, each an owner's: **Use as budget** writes each
code's cost as that code's original budget (slice 3's `setBudgetLines`, one
line per code, lines with no code left out and said so); **Use as schedule
of values** writes one schedule line per estimate line at its *price* onto
a chosen contract (slice 5's `saveSovLines`, which refuses to remove a line
an application has billed against) — **with overhead and profit spread
across the lines in proportion**, so the schedule totals the estimate's
total, the contract sum an accepted estimate set: a G703 requires the
schedule to total the contract sum, every application is measured against
it, and a schedule short by the overhead and profit would under-bill every
draw. A line sold by the unit keeps its unit and quantity with its unit
price raised by the same share, so a unit-price contract bills by the
quantity (ADR 0064); the cents the rounding leaves land on the last line
priced as a sum. A builder who wants overhead or fee as a line of its own
on the schedule types it as a line of the estimate. Neither is automatic on accept: a builder who
budgets at cost and bills by a different schedule — a lump sum spread over
milestones, say — must not have the estimate's lines forced onto them.

**Writing an estimate is a member's chore; making it money is an owner's
act.** The estimator is rarely the owner. Create, edit, send, decline and
supersede are member-wide; accept, use as budget and use as schedule are
owner verbs, the same split as selections (draw up and record: anybody;
raise the difference: owners).

## Consequences

- Two tables: `job_estimates` (number unique per job, title, status
  draft / sent / accepted / declined / superseded, the three rates in ppm
  capped at 1,000% by CHECK, sent / decided / valid-until dates, the
  contract it became) and `job_estimate_lines` (cost code, description,
  unit, quantity in thousandths, unit cost, an optional line markup, an
  optional unit price, all floored at zero by CHECK). Nothing stores an
  extended figure or a total.
- The arithmetic is one pure module, `estimate-math.ts`, pinned in the
  pure suite with the same four lines the ops test uses, so the page, the
  list, the budget and the schedule cannot disagree.
- Several estimates on one job is ordinary and expected — a bid revised,
  a design phase priced before the build — which is why the number is
  unique per job and not per tenant, and why the job's page lists them
  rather than showing one.
- **Not built, on purpose, until something asks for it:** assemblies (a
  named bundle of lines a builder drops in — "interior door, prehung"
  with its hardware, casing and labour), a tenant-level unit cost book,
  a takeoff from the drawings, and the proposal as a printed document.
  Each is a real thing the trade has; each is a slice of its own, and the
  first two want a settled feel for what lines look like across a few
  real estimates before they are shaped.
- An estimate does not reach the books. It is a bid; the contract, the
  budget and the schedule it becomes are what post.

## Alternatives considered

- **Store the extended figures and totals on the rows.** Rejected: two
  copies of a number is how one drifts, and the change order and the
  schedule already keep the other rule.
- **Overhead and profit on cost rather than on price.** Both conventions
  exist in the trade. Rejected as the default because "ten and ten" — the
  spoken convention — is on the marked-up price, and a business that
  wants the other reading marks up its lines instead; the two rates were
  kept rather than one "margin" for the same reason.
- **Accept writes the budget and the schedule too.** Rejected: it would
  have forced the estimate's shape onto the billing of every job. The
  three acts are three buttons, each saying what it will replace.
- **One estimate per job, revised in place.** Rejected: an accepted
  estimate is the record of what was agreed, and a revision that
  overwrote it would lose the number the contract was signed at.
