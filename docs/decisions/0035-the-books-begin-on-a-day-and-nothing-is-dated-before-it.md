# 0035 — The books begin on a day, and nothing is dated before it

- **Date:** 2026-09-08
- **Status:** Accepted
- **Affects:** accounting module — `entities.books_start_on`, `assertPeriodOpen`, the CSV import and the Plaid sync, the Close page, the setup card

## Context

A business converting to Yosher from a shoebox does not re-key its history.
The onboarding plan ([docs/modules/onboarding.md](../modules/onboarding.md))
settles that: pick a start date, enter balances as of that date, leave the past
where it was. For the pilot farm the date is 2026-01-01, and its bank
statements go back further than that.

Nothing in the software knew the date. `accounting_settings` carried the
fiscal year and the basis, each company carried the date its books are closed
THROUGH, and no column said where they begin. So a statement reaching back
into 2025 imported every line, the review queue filled with history nobody
wanted in the books, and a bank rule set to post automatically would have
posted it. The upper bound of the books had a lock; the lower bound had
nothing.

There was also no screen on which to set anything of the kind: the fiscal year
is read by every report and written by nothing.

## Decision

Each company's books **begin on a day**, `entities.books_start_on`, beside the
day they are closed through. It is set by an owner on the Close page, the page
whose job is the two ends of the period, and it may be set or moved earlier at
any time, but never to a day after money already recorded and never after the
close date.

**Nothing may be dated before it.** `assertPeriodOpen`, the one check every
posting and every date edit already goes through, refuses a date before the
start the way it refuses a date inside a closed period. Opening balances are
dated ON the day, which is allowed; that is what the day is for.

**An import drops the earlier lines rather than carrying them in.** The CSV
import and the Plaid sync leave out rows dated before the company's start and
say how many, so a statement that reaches back a year imports cleanly and the
review queue holds only what the books can take.

**The setup card asks for it first.** Under [ADR 0033](0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)
a step is a prerequisite the data proves missing, and a null start date is
exactly that: a fact about the business the module needs, not advice.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Rely on the owner to trim the statement before importing | The pilot's statements are a year of one mixed account; trimming by hand is the overwhelm the plan exists to remove, and one forgotten line posts 2025 into 2026's books |
| Import the earlier lines and mark them excluded | They would sit on the Excluded (or Personal) tab forever, count against the register, and could be restored into the books by one click. Rows the books can never take should not be rows |
| One tenant-wide date on `accounting_settings`, "beside the fiscal year" as the plan first said | The close date moved off `accounting_settings` for a reason (ADR 0010 slice 4): companies inside one tenant start and close on different days. A second company formed mid-year begins its books when it begins, and the lock and the start belong to the same row |
| A settings screen for the accounting settings | None exists, and building one for one date would put the two ends of the period on two different pages. The Close page already owns the upper bound |
| Refuse at the import only, not at posting | A journal, an invoice, a bill and a quick add can all be dated by hand. The single check every one of them passes through is the only place the rule cannot be walked around |

## Consequences

What it buys:

- **A statement can be imported whole.** The lines before the start are
  dropped and counted; nothing about them has to be decided.
- **History cannot leak in.** Any path that posts — by hand, by rule, by
  recurring template — is refused at the one check they share.
- **The opening position has a date to stand on** (slice 5): balances on the
  first day, nothing before it.

What it costs, honestly:

- **A date set wrong is a refusal the owner has to understand.** The message
  is static, so it says what the rule is for and the Close page shows the date;
  moving the date earlier is always allowed.
- **Rows imported before the date was set stay.** Setting the date later than
  existing entries is refused, but unposted feed rows from before it remain in
  the queue and are refused one by one at posting. They can be excluded by
  hand; nothing sweeps them, deliberately, because deleting imported rows is a
  different decision.
- **The setup card gains a row every existing tenant will see** until an owner
  sets the date. That is the point.

## Notes

The date is per company because the lock is. If a tenant-wide default is ever
wanted, it belongs on the default company, which the setup card already reads.
