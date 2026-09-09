# 0038 — An asset owned before the books began arrives as two entries, and its old months are marked posted by the key that already exists

- **Date:** 2026-09-09
- **Status:** Accepted
- **Affects:** assets pack — `getAssetOpeningState`, `recordAssetOpening`, the asset page's depreciation panel; accounting's `postedToDateCents` reading

## Context

A business converting to Yosher picks a day its books begin (ADR 0035) and
records what was open on it (ADR 0037). The third thing on the balance sheet
that day is what it already owns: a tractor bought in 2024, a barn built in
2015. The onboarding plan's third gap named the obstacle precisely —
`postedToDateCents` reads only entries with `source = depreciation` and
`sourceId = the asset`, so an opening journal line to accumulated depreciation
is invisible to the asset page, which then shows full book value and offers to
post six years of depreciation that the old books already took.

Two things have to reach the ledger, and they are different in kind. The
COST has never been in these books at all — `createAsset` posts nothing, and
the bill that bought it was paid years ago in somebody else's ledger. The
DEPRECIATION ALREADY TAKEN is a figure the old books hold, on a convention
this app may not model.

## Decision

**Two entries, both dated on the day the books begin.**

    Dr  Cost sits in              cost           source `opening_balance`
        Cr  Opening Balance Equity

    Dr  Opening Balance Equity    already taken  source `depreciation`
        Cr  Accumulated depreciation

**The split is load-bearing, not cosmetic.** `postedToDateCents` sums the
positive lines of an asset's `depreciation` entries. A cost debit inside such
an entry would be read as depreciation taken and would double the accumulated
figure. Putting the cost under `opening_balance` also makes it the same shape
as a register's opening balance, which is the only other thing in the product
that puts a starting figure on the books, and keeps the depreciation entry's
positive line meaning exactly what it has always meant.

**The old months are marked posted by `catchUpKey`, which already exists.**
The depreciation entry's idempotency key is
`depreciation:<asset>:through:<period>`, and `periodsCoveredByKey` already
reads that as "every scheduled period up to and including this one" —
the mechanism a catch-up entry uses when periods are stranded behind a close.
So the next `postDepreciation` starts at the first month the new books own,
with no new column, no new concept, and nothing to keep in step. The period is
the last one whose month ENDED before the start day, so books beginning
mid-month leave that month to the new books.

**The figure is the person's, not the schedule's.** The schedule's own
accumulated-through figure is offered as the starting value and shown beside
the field, and where the two disagree the asset finishes that much above or
below its salvage value. The guide says so plainly rather than silently
adjusting either the entry or the schedule.

**Four things must be true first, and each is named before the button is
pressed**: the company has a start day, the asset has a cost, it has an
account for that cost to sit in, and it was acquired before the day. The same
sentence is used by the page and by the action, from one function in the
pack's vocabulary.

## Alternatives considered

- **One entry with three legs** (Dr cost, Cr accumulated, Cr OBE). Simplest to
  read, and wrong: whichever source it carried, `postedToDateCents` would
  either miss the depreciation or count the cost as depreciation.
- **A column on `assets` for depreciation already taken.** A second source of
  truth that must agree with the ledger for ever — the bug class the pack's own
  header calls out, and the reason accumulated depreciation is not stored.
- **Refuse a figure that differs from the schedule.** Exact, and useless to
  any business whose accountant used a convention this app does not model
  (half-year, MACRS). The plan's whole premise is that history is not re-keyed.
- **Rebuild the remaining schedule from the person's figure** so the total
  still lands on cost − salvage. Tempting, but it makes a typed figure silently
  rewrite the schedule the ledger has already posted against elsewhere, and the
  discrepancy is better shown than smoothed.
- **Let the Opening page list assets and record them there.** The asset page
  already holds the cost, the account and the schedule, and this is one act per
  asset rather than a list. The Opening page points at it in a sentence.

## Consequences

- No migration. Both entries are ordinary ledger entries.
- The cost entry's key is `opening:asset:<id>`, unique per asset for ever. The
  ledger's unique index is not freed by a void, so a second recording is
  refused with "This is already on the books. A correction is a journal entry."
  That is also the answer when depreciation has already been posted, because an
  opening figure laid on top would double-count.
- An asset that is never depreciated still gets its cost onto the balance
  sheet: the second entry is simply not written.
- Depreciation dated on the start day sits in the first period the new books
  own. If that period is already closed, `postEntry` refuses, and the refusal
  is the ledger's own — the same as every other backdated entry.
