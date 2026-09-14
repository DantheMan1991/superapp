# 0061. A subcontractor's application is an ordinary bill, and retainage held is a negative line to a payable

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's retainage-from-subcontractors slice as the forcing case

## Context

[ADR 0058](0058-a-pay-application-is-an-ordinary-invoice.md) made the
business's own pay application an ordinary invoice with retainage as a
negative line to `1230 Retainage Receivable`. The other direction was left
open: a subcontractor bills the business the same way, an application against
the subcontract with retainage held back, and the construction profile seeded
`2120 Retainage Payable` for it on the first day — an account nothing posted
to through six slices.

Two questions were open: **what the subcontractor's schedule of values is**,
and **whether their application is a second kind of document** on the
payables side.

## Decision

**The subcontract's lines are the schedule.** A subcontract is written as
lines — a cost code and an amount each — when the order is placed
(`job_commitment_lines`). An application carries one line per subcontract
line with the G703's three figures (previous, this period, stored), and the
arithmetic is `payApplicationTotals`, unchanged. Nothing has to be set up
that the order did not already say.

**An approved application is an ordinary bill**, made through Accounting's
own verbs — `createBillDraft` → `approveBill` — with a line per subcontract
line for the work this period to `5100 Subcontractor Expense`, tagged with
the job AND the line's cost code, and a **negative line to `2120 Retainage
Payable`** for what is held back this period. The entry is Dr expense (gross)
· Cr Retainage Payable (held) · Cr AP (net). `job_sub_applications.bill_id`
is the link, RESTRICT, and the CHECK `(status = 'draft') = (bill_id is null)`
makes "billed but no bill" unrepresentable. The subcontractor's own reference
becomes the bill number.

**Releasing what was held is the same line running the other way**: a later
application at a lower rate — the final at 0% — computes less retainage to
date than the last one held, the line to `2120` is positive, and the bill
pays it out. No second feature.

**Subcontracts only.** A purchase order is billed with an ordinary bill in
Accounting; retainage, lien waivers and certified payroll attach to bought
labour, not to bought material, which is why `job_commitments.kind` is a
CHECK list of two. The verb refuses a purchase order (`NOT_SUBCONTRACT`); the
database does not know the difference, and the ops test proves the refusal.

**One editor for both sides of the table.** The pay-application editor takes
a `mode`; the certificate, the rows and the totals are the same, and only the
verbs and three words differ. `5100` stays in the general chart — the agency
profile leans on it for freelancers — so a business with no construction
profile can still bill a subcontractor.

## Consequences

- Retainage held from subcontractors is a balance in `2120` that the balance
  sheet carries and the commitment page shows per subcontract; releasing it
  is a bill the bookkeeper pays like any other.
- Every subcontractor bill lands on the job cost report's `Spent` column by
  code, and on the next cost-plus application, because its lines carry the
  job and the code. The three readings of the same tags still agree.
- A subcontract line that has been billed against cannot be replaced:
  `updateCommitment` replaces lines on edit, and the RESTRICT turns "edit the
  lines of a billed subcontract" into a refusal rather than a silent loss of
  what was certified. Changing a billed subcontract is an open item, and a
  change order's payable-side twin.
- The pack never reads Accounting's bill tables: `loadBill`, `voidBill` and a
  new Accounting verb, `ensureVendorForParty` (the twin of
  `ensureCustomerForParty`), are the whole seam.

## Alternatives considered

- **A "retainage %" on any bill in Accounting.** Rejected: it teaches a core
  module a trade-shaped concept, the general chart has no `2120`, and it
  would still need a schedule to certify against. The pack owns the document
  and Accounting owns the ledger, the split ADR 0058 drew.
- **A separate subcontractor-billing ledger** reconciled to AP. Rejected for
  ADR 0007's reason: one ledger and lenses over it.
- **A second editor.** Rejected: the certificate is the same on both sides
  of the table, and two forms would drift.
