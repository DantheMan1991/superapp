# 0070. A proposal is the estimate printed at its price, and its words are fixed with the money

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** founder, with the `jobs` pack's proposal slice (construction plan slice 10b) as the forcing case

## Context

Slice 10 ([ADR 0069](0069-an-estimate-prices-the-job-before-anybody-signs-and-accepting-it-names-the-contract.md))
gave the pack an estimate — cost and price on every line, overhead and
profit below — and left the client with nothing to hold. Every builder
sends a proposal: the price, what it covers, what it does not, the terms,
a line to sign. Until this slice that document was typed again outside the
product from the estimate inside it, which is the state the estimate was
built to end.

Three questions were open: **what the client sees of the arithmetic**,
**where the proposal's words live**, and **whether an accepted proposal can
still change**.

## Decision

**THE PROPOSAL SHOWS PRICES, NEVER COST.** Every line prints at its price
with the estimate's overhead and profit spread into it — the same spread
the schedule of values takes (`scheduleFromEstimate`), so the lines add up
to the total the contract will be signed at, and a line sold by the unit
prints its raised unit price and bills the same way later. The unit cost,
the markup, the overhead, the profit and the margin appear nowhere on the
page; a pure test scans the model for the words. A builder who wants a fee
or "general conditions" as a line the client sees types it as a line of
the estimate, ADR 0069's rule.

**THREE WAYS TO SHOW THE PRICE, the business's choice per estimate.** Line
by line, for a takeoff or a unit-price bid where the client expects the
quantities; by cost code, the summary a custom-home client reads; or one
sum, a remodeler's lump price. The total is the same in all three. When
unit prices cannot add to the total to the cent (an estimate sold entirely
by the unit, ADR 0069's rounding case) a *Rounding* line carries the cents,
so the rows on the page add up.

**THE WORDS LIVE ON THE ESTIMATE AND ARE FIXED WITH THE MONEY.** Scope,
exclusions and terms are three texts on `job_estimates`, edited beside the
lines. They are the agreement, so once the estimate is accepted they are
refused with the rates and the lines (`ESTIMATE_ACCEPTED`); the
presentation is a printing choice and stays free, as the title and the
notes do. A new estimate starts with the **terms of the newest estimate the
business wrote**, because terms are mostly boilerplate and a tenant-level
settings screen for one paragraph would be a heavier thing than the habit
it replaces; terms given blank stay blank.

**RENDERED ON REQUEST, NEVER STORED**, the certificate's rule (ADR 0063): a
draft's proposal changes whenever the draft does, and an accepted one
cannot change. A draft prints under DRAFT with *Not yet sent* as its date;
a declined or superseded one under that word. The client is the contract's
counterparty once the estimate names a contract, else the job's client
party; the only postal address the product keeps is the customer's in
Accounting, so a party never billed prints as a name alone.

## Consequences

- Four columns on `job_estimates`: `presentation` (CHECK lines / codes /
  sum), `scope`, `exclusions`, `terms`. No new table, no RLS migration.
- Three files mirroring the certificate's split: `proposal-model.ts` (pure,
  every word and figure, table-tested), `proposal-pdf.tsx` (layout only),
  `proposal.ts` (rows to input, brand, bytes), and a GET route
  `/api/jobs/estimates/[id]/pdf` behind the same gates. Any member may
  print.
- The editor grows a Proposal block — how the price is shown, the three
  texts, *Print proposal* — and the estimates list a *Proposal* button per
  row.
- **Not built, on purpose:** sending the proposal from the product (Mail's
  seam is there when somebody asks), the client accepting it on a screen
  of their own, a tenant-level terms library, and the assemblies, unit
  cost book and takeoff that were already 10b+.

## Alternatives considered

- **Print overhead and profit as their own lines.** Rejected as the
  default: a residential client is not shown the builder's margin, and a
  business that wants a fee line types one.
- **Terms in the tenant's module settings.** Rejected for now: one text
  box on a settings screen nobody else needs, for a paragraph that the
  last estimate already holds.
- **Store the rendered PDF on the estimate.** Rejected: a file drifts from
  the row it was made from, and an accepted estimate's row cannot change.
