# 0078. A bond is recorded on the job, and a job counts once against the surety's line

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, with the `jobs` pack's bonding slice as the forcing case

## Context

Row 13 of the construction plan was `warranty`, `bonding` and
`certified-payroll`. Warranty shipped as
[ADR 0076](0076-a-warranty-claim-is-the-record-of-a-call-its-work-is-a-work-item-the-period-is-the-jobs-and-a-claim-outside-it-is-said-never-refused.md);
the plan's own note parks certified payroll as something that "may not
belong in software at all". Bonding is the half left, and the half any
contractor who touches public, institutional or developer work lives
with.

The record itself is the easy part. The question that actually costs a
contractor money is **can I bid this one** — which needs the single-job
and aggregate limits from the surety's letter against the work already on
hand, and neither number is anywhere in the books. The WIP schedule
already exists because the surety asks for it
([ADR 0059](0059-work-in-progress-is-a-snapshot-and-a-self-reversing-entry.md)),
so the pack already holds one half of the arithmetic.

Open questions: **what a bond hangs off**, **where the limits live**,
**what counts as used**, and **what the pack does with a bond's kind**.

## Decision

**A BOND HANGS OFF THE JOB AND NAMES A CONTRACT WHEN THERE IS ONE.** A
performance or payment bond is against a contract; a BID bond exists
before any contract does, which is its whole purpose. Rather than two
nullable parents and a CHECK to keep them honest, `job_bonds.project_id`
is required and `contract_id` is set when there is one. Always
representable, and the capacity arithmetic reads the job's backlog
either way.

**A JOB COUNTS ONCE, HOWEVER MANY BONDS IT CARRIES.** Performance and
payment bonds are almost always issued as a pair on the same contract,
and a surety backs the WORK, not the pieces of paper. Summing per bond
would report twice the capacity used on every properly bonded job —
which is the one number this screen exists to get right. The bonds are
folded per job before the arithmetic sees them, and the pure test says
so in its name.

**USED IS BACKLOG, NOT CONTRACT VALUE.** What a surety is exposed to is
what is left to build: the contract sum less what has been billed,
floored at nothing. A job billed to the end ties up nothing even while
its bond is technically open. Both figures already exist per project
(`projectValues`, `billedByProject`), so nothing new is stored.

**A BOND TIES UP THE LINE FROM THE DAY IT IS ASKED FOR.** `requested`,
`active` and `expiring` all hold capacity; `released`, `expired` and
`void` let it go. Asking for a bond means the job is going ahead, and a
contractor who waited for the paper to arrive before counting it would
bid over their line. Releasing is what gives it back, which is the
reason the status exists at all.

**THE LIMITS ARE A ROW PER COMPANY, NOT A CONFIG VALUE.** They are
numbers an owner types and changes when the surety's letter changes, and
nothing tenant-facing writes `tenant_modules.config`. They hang off the
ENTITY, because a surety underwrites a legal entity — the same axis the
WIP schedule is picked on. Either limit may be blank: a business that
knows its aggregate and was never given a single-job number is the
common case, and half a line is worth more than none.

**THE KIND IS AN OPEN TAXONOMY.** Bid, performance, payment and
maintenance are what everybody writes; a residential developer posts a
subdivision bond with the municipality and a supplier may want a supply
bond. A format check, five suggestions, and no branch — the same rule a
contract's kind and a party document's kind follow. The only thing the
pack does with a bond is read its expiry and count its job once.

**THE PREMIUM IS RECORDED, NEVER POSTED.** The surety's invoice is an
ordinary bill in Accounting. The bond keeps what it cost and the cost
code it belongs on, so the job cost report shows it beside everything
else once the bill is coded. No account is invented in anybody's chart.

## Consequences

- Owner-only throughout: a bond is a term of the agreement the way a
  contract's value is, and the line is what the surety will back.
- A Bonds panel on the job's Contracts tab, where the contract value the
  penal sum relates to already is — no twelfth tab on the job page — and
  a Bonding page across jobs with the capacity, what is tying it up, and
  the bonds worth a look.
- A cancelled job ties up nothing: the exposure went with it.
- `wouldFit` and `fitSentence` answer the bid question in one line, and
  say `unknown` rather than yes when no limit has been recorded.
- Not built, on purpose: a bond as a printed document, attaching the
  surety's paper to the row (Documents' attachments are the seam),
  bonding capacity as a percentage of working capital, the surety's rate
  schedule, and consent of surety. Subcontractor bonds — a bond the
  business requires FROM a sub — are the party-document slice's job
  (ADR 0068 already lists a bond as a kind).

## Alternatives considered

- **Count the contract value, not the backlog.** Simpler, and wrong: a
  finished-but-unreleased bond would hold capacity the surety no longer
  has at risk, and a contractor would under-bid their own line.
- **Count each bond.** Doubles every properly bonded job. The most
  plausible bug in the slice, which is why it has its own invariant and
  its own test.
- **Put the limits in `tenant_modules.config`,** as the required
  party-document list is. Nothing tenant-facing writes that, so the
  founder could not set his own numbers and the screen would be inert.
- **Hang a bond off the contract.** A bid bond has no contract, and that
  is precisely when a contractor most wants to know what is left.
- **A CHECK list of bond kinds.** It would encode one country's surety
  market in a pack that is meant to speak no industry's dialect.
