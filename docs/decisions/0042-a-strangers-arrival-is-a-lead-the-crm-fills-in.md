# 0042 — A stranger's arrival is a lead the CRM fills in

- **Date:** 2026-09-09
- **Status:** Accepted (built 2026-09-09, back-office slice 2)
- **Affects:** the three public doors that write into a tenant — the site's
  enquiry form (`src/lib/sites/enquiries.ts`), its booking form
  (`src/lib/sites/bookings.ts`) and the health check (`src/lib/interview.ts`) —
  CRM (`src/modules/crm/leads.ts`), the lint contract list, `docs/extension-model.md` §4
- **Builds on:** [0021](0021-a-website-enquiry-lands-as-a-party.md),
  [0041](0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md)

## Context

ADR 0021 settled how a stranger's message lands: as a party, a follow-up and
an email, written as `staff` inside the tenant through the shared doors. It
also left one thing in the door's own hands — *"a CRM record with `source =
'website'` — only when CRM is switched on, because the table is CRM's"* —
which the enquiry did by inserting into `crm_party_details` directly, and
the booking form copied. Two files outside the CRM naming a CRM table, and a
third about to.

The third was the health check. When it stops minting a prospect workspace
(ADR 0041) and lands in the operator tenant instead, it wants more than a
record: a lead that has just spent twenty minutes describing its business and
asked to be contacted is a **deal** at the top of the pipeline, with the
contact joined to the business and a note on the timeline. Opening a deal
correctly means `createDeal` — adopt the record, find the default pipeline's
opening stage, write the first stage event — and doing that raw from a lib is
exactly the last-write-wins bug the party door's header warns about. A lib
importing `@/modules/crm` to do it properly inverts the graph every registry
under `src/lib/` keeps straight.

## Decision

**The door names a slot; the CRM fills it.** `src/lib/leads/` holds the
contract (`types.ts`), the resolver (`resolve.ts`), and the one file that
knows which module answers (`registry.ts`). A door that has just written the
party calls `landLead(tx, ctx, lead)` inside its own transaction with
`{ partyId, contactPartyId?, source, proposition? }`, and the CRM decides
what that means: the record with its source; the person's place at the
business; when there is a `proposition`, a deal in the opening stage titled
with it and a note on the timeline. A plain message carries no proposition
and lands as a record and nothing more — the enquiry and the booking are
unchanged in behaviour and no longer name a CRM table.

Three rules the filler keeps:

1. **It never fails the arrival.** No default pipeline yet is a deal not
   opened, not a message lost.
2. **It never lets a database error escape.** Inside a transaction that
   poisons everything after it, so anything that could meet a constraint —
   an affiliation that already exists, a second primary company — is looked
   up before it is written, or not written at all.
3. **The source is a word, not a kind.** `website`, `health-check`,
   `referral` sit beside each other in an open column; nothing branches on
   them.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Keep the raw `crm_party_details` insert in each door | Three copies of CRM's business in three files that are not CRM's; the day the record gains a required field, three doors break. |
| Import CRM's ops from the door | A lib importing a module. The registries exist so that exactly one file per slot knows an implementation, and `eslint.config.mjs` enforces it for the contract files. |
| A general event bus ("party.created") every module may subscribe to | Nothing else wants the event, and an event bus is the kind of machinery that gets a second subscriber the week after it ships. A slot with one filler and a named shape is the house pattern (attention-sources, site-blocks, setup-sources); a bus would be the first of its kind. |
| Let the health check open the deal itself, after the transaction | Then the lead exists before the deal, and a crash between them is a lead the pipeline never sees. Inside the transaction, or not at all. |

## Consequences

**Buys.** One door for a stranger's arrival, filled by the module that owns
the meaning. The health check lands as a deal without knowing what a deal is.
The eighth declared extension point, and the first whose caller is a public
door with nobody at the keyboard.

**Costs.** The filler runs as `staff` with an empty user id; a deal's first
stage event and a note say nobody moved them, the way the enquiry's follow-up
already does. A second arrival with a proposition from the same business
opens a second deal — by design (two conversations are two leads), guarded
in the health check by the session claim rather than here.

## Notes

- **What would make us revisit:** a second filler. If Work, say, wanted to
  raise a follow-up from the slot rather than have each door call the Work
  verbs itself, the resolver already runs every enabled filler in turn — the
  door would just stop calling Work directly.
- The lesson underneath: a door that "only inserts one row" of another
  module's table is already that module's code, living in the wrong file.
