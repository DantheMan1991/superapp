# 0066. A lien waiver is a record with a kind and a through date, and the gap is derived from the payment

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's lien waiver slice (construction plan slice 11a, `compliance`) as the forcing case

## Context

Slice 5c tracked retainage held from subcontractors and posted their
applications as bills (ADR 0061), and its own open-items list said what a
general contractor's bookkeeper asks for next: **lien waivers** — the
document a subcontractor or supplier signs to give up its right to a lien on
the property in exchange for a payment. The owner and the bank want one from
everybody paid before they fund the next draw; a payment made without one is
the classic way a job ends up with a lien on it and the money paid twice.

Three questions were open: **whether the pack produces the waiver or
records it**, **what the record must hold to be useful in every state and
for every kind of business**, and **how "somebody has been paid without
one" is known**.

## Decision

**A lien waiver is a RECORD, never a form.** The words on a waiver are the
state's — a dozen states mandate the exact text, the rest use whatever the
business's lawyer wrote — and a business in Canada signs a statutory
declaration instead; a pack that carried one state's form would be the
narrowing the platform's standing rule forbids, and one that carried all of
them would be a law library nobody maintains. What every one of them has in
common is what `job_lien_waivers` keeps: WHO gives it (the claimant — any
party; usually the subcontractor, sometimes their supplier), on WHICH job
and under which of our orders, of which KIND, THROUGH which date, for HOW
MUCH, and whether the signed copy has been RECEIVED. The signed copy itself
is a Documents attachment on the row, as a daily log's photos are.

**The four kinds are the vocabulary every American form uses**: conditional
or unconditional, progress or final. A conditional waiver is given with the
application and takes effect when the payment clears; an unconditional one
is given after the money arrived, and is the one the bank wants to see. A
business whose state has no conditional form never records one; the list is
closed (a CHECK) because the gap rule below reads it.

**The gap is derived, never stored.** "Paid, and no unconditional waiver on
file" is computed at read time from the subcontractor's billed applications
— whose bill, read through Accounting's own verb, says whether money went
out — against the waivers received on the order. A waiver covers an
application when it names it, when it is a final one, or when its through
date is on or after the application's period end; only a received waiver
counts. A billed application not yet paid with no waiver at all is the
softer gap. Nothing on the row says "outstanding": a waiver that arrives
closes the gap by existing, which is the rule the platform's notifications
follow (derived obligations, not stored events).

**The chase is Work, linked to the order.** One click on a gap raises a Work
item — *Lien waiver from Pleasant Valley Feed Mill: unconditional through
2026-10-31 (SC-24109-1)* — linked to the commitment, not to the job's punch
list, which is what still needs fixing on site. Work raised where it lives;
no task engine of the pack's own.

**Recording a waiver is a `member` chore**, as the daily log is. The decision
it protects — paying — is Accounting's and an owner's.

## Consequences

- The order's page gains a Lien waivers panel: what is on file through
  when, each gap in a sentence with *Ask for it* beside it, and the record
  dialog; every billed application says whether a waiver covers it. The
  job's Ordered panel says who has been paid with no unconditional waiver on
  file, and the Billed column carries the coverage under each order.
- A waiver on a purchase order is recorded the same way — suppliers have
  lien rights too — but the gap rule reads subcontractor applications only,
  because a purchase order is billed with ordinary bills the pack cannot
  tie to it.
- The signed copy is a photo, through the gallery every pack shares. A PDF
  that arrived by email is a Documents file the row cannot yet point at:
  attaching an existing document to a record has a verb and no picker, and
  is the first open item.
- Generating the waiver to send — the tenant's own state form from
  Documents' templates, filled with the row's facts — is the second open
  item. The facts are here; the template is the business's.
- Certificates of insurance and W-9s, the rest of construction plan slice
  11, are a party-level record with an expiry, not a per-payment one, and
  wait for their own slice.

## Alternatives considered

- **Generating the waiver from a form the pack ships.** Rejected: the text
  is the state's or the lawyer's, and a pack must never carry one business's
  or one state's paperwork. The tenant's template through Documents is the
  door, later.
- **A stored "waiver outstanding" flag on the application**, set at payment
  and cleared on receipt. Rejected: two facts that can disagree, and a bill
  paid in Accounting could not set it without Accounting learning about the
  pack. Derived from the bill's status at read time, it cannot be stale.
- **Attaching the waiver to the bill in Accounting** instead of to a row of
  the pack's. Rejected: a waiver is a construction document with a kind, a
  through date and a claimant that is not always the vendor; the bill is
  the payment, not the waiver.
- **An open taxonomy of kinds**, for states with other words. Rejected: the
  gap rule needs to know which kind stands on its own once given, and every
  form's words map onto conditional or not, progress or final. A profile
  may relabel; it does not need to restructure.
