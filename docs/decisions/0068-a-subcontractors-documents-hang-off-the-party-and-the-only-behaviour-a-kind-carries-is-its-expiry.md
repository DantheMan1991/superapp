# 0068. A subcontractor's documents hang off the party, and the only behaviour a kind carries is its expiry

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** founder, with the `jobs` pack's compliance slice (construction plan slice 11b) as the forcing case

## Context

Slice 11a tracked lien waivers, a document per payment. The rest of the
plan's row 11 is the paperwork a general contractor collects from a
subcontractor before it pays, or before it lets them on site: a certificate
of insurance that runs out on a date, a W-9 that does not, a licence in
some states, a signed master agreement, a safety plan, a bond. The
insurer's audit asks for the certificates every year and charges premium
on any sub whose certificate was missing; the accountant asks for the
W-9s every January.

Three questions were open: **whether the record is per job or per
party**, **what the pack knows about the kinds**, and **what "in good
standing" means**.

## Decision

**A document hangs off the PARTY.** A framer's insurance covers every job
he is on; asking for the certificate on each is how a GC ends up with four
copies and one expiry nobody watched. `job_party_documents` names the
party, and the page that reads it — Subcontractors — lists every party
with an issued or closed order on a job that is not complete or
cancelled, with the jobs beside the name. A draft order names nobody the
business owes.

**The kind is the business's; the only behaviour a kind carries is its
expiry.** What is required differs by state, by insurer and by lawyer, so
`kind` is an open taxonomy with a format check, as a contract's kind is;
the pack suggests three and labels them, and spells anything else from its
slug. Which kinds are REQUIRED is a tenant config value
(`requiredPartyDocuments`) with a default of a certificate of insurance and
a W-9 — a value, never a branch. The one thing the pack does with a kind is
read `expires_on`: a document past its date is as good as missing, one
within thirty days is worth a sentence, and one with no date never runs
out.

**Standing is derived, never stored.** For each required kind, the
received document that runs longest — no expiry beats any date — and its
state against today: missing, expired, expiring, ok. A party is in good
standing when nothing required is missing or expired; expiring still
stands. Requested and void documents are not on file. A bill paid in
Accounting changes nothing here, and nothing here stops a payment: the
page says, and the order's page says in a line, and the person decides.

**The chase is Work, linked to the party** — *Certificate of insurance
from Pleasant Valley Feed Mill* — not to any one job, because the document
is not any one job's. Recording one is a member's chore; the scanned page
is a Documents attachment on the row.

## Consequences

- The Subcontractors page is the insurance audit's own view: one row per
  party on a live job, a column per required kind with its state and
  expiry, everything else on file beside, and a badge. Every order's page
  carries the party's standing in one line with the link.
- A business that requires more than the default records the kinds it
  wants (a safety plan, a bond) under *Other*, and sets its required list
  in the pack config to make them count. No profile carries a state's
  rules.
- The certificate is a photo of the page until the Documents picker lands
  — the same limit as a waiver, and the next PR.
- Nothing blocks. A business that wants an issued order or an approved
  bill refused while a sub is out of standing wants a setting, and nobody
  has asked; the page in red is the first step and the honest one.
- Per-coverage tracking — general liability, workers' compensation and
  auto as three rows with three limits — is three documents of the same
  kind with different titles, which the model already allows; a
  per-coverage required list is the day a business asks.

## Alternatives considered

- **Per job**, on the commitment. Rejected: the copies multiply and the
  expiry hides; the audit is per party.
- **A closed list of kinds** with behaviour per kind. Rejected: the list
  is the business's and the state's, and the only behaviour any of them
  has is a date.
- **Blocking payment or issue** on a missing certificate. Rejected for
  now: a control nobody asked for, in the path of money, with the page
  already saying it in red.
- **A vendor-level record in Accounting.** Rejected: the certificate is a
  construction document with an expiry and a required list; Accounting's
  vendor knows terms and a tax id, and should stay industry-blind.
