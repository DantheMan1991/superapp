# 0041 — A tenant is a workspace; a client is a party in the operator tenant

- **Date:** 2026-09-09
- **Status:** Accepted — 2026-09-09, with slice 0 of
  [back-office.md](../modules/back-office.md)
- **Affects:** Layer 0 (`tenants`, `audits`, `tenant_notes`, `subscriptions`,
  the console at `/admin`), the health check (`src/lib/interview.ts`), CRM (a
  declared slot it fills), Accounting (the operator's own books),
  `docs/security.md` §6, the sentence about `audits` in AGENTS.md
- **Builds on:** [0002](0002-monolith-with-module-seams.md),
  [0004](0004-capability-packs-and-industry-profiles.md),
  [0021](0021-a-website-enquiry-lands-as-a-party.md)

## Context

Yosher is about to take paying clients, and the founder asked for "a much
more full-blown CRM on the back end". The back end holds a small one, built in
July before any module existed:

- `tenants` is documented as *"a business in the CRM — the record that spans
  the whole lifecycle"* ([platform.ts](../../src/db/schema/platform.ts));
  `status = 'prospect'` with a null `clerk_org_id` is a business with no
  workspace.
- The health check promotes a stranger who leaves an email into a `tenants`
  row, a `subscriptions` row and an `audits` row, all under `withSystem`
  (`promoteSession` in [interview.ts](../../src/lib/interview.ts)).
- `tenant_notes` is *"admin CRM notes about a client"*, and `audits.status`
  runs `open → report_ready → won | lost` — a deal's outcome, on a platform
  table.
- `/admin` calls itself *"your whole book of business — prospects through
  paying clients"*.

Since then the platform has shipped a CRM (the party spine, pipelines, deals,
activity, follow-ups, saved views, reports, automations), Accounting,
Documents, Mail, Work, Scheduling and Marketing — and the business that sells
them has never run on any of it. The day anyone opens the CRM, the same
prospect has two homes. A "full-blown CRM on the back end" would be a third:
outside RLS, under the god view, maintained forever, paid for by nobody.

The neutrality test ([extension-model.md §3](../extension-model.md)) cuts the
other way as well. Clients, engagements, retainers, discovery calls and
onboarding projects are what a bookkeeping firm, a law practice and a
consultancy also have. The agency's own needs are not Yosher-shaped.

## Decision

**Yosher is a tenant of its own platform — the operator tenant — and a client
is a party in it.** The relationship (people, stage, deals, notes, mail,
papers, money) lives in the operator tenant through the ordinary modules. The
platform holds only the workspace: `tenants`, `memberships`,
`tenant_modules`, `subscriptions`, `retainers`, `audit_log`.

1. **The operator tenant is named in data.** `tenants.is_operator`, with a
   partial unique index so a database holds at most one. Not an env var: dev
   and prod each name their own, the isolation suite can mint one, and the
   deploy sets nothing (the lesson of [0014](0014-migrations-are-applied-before-the-merge.md)).
2. **A `tenants` row exists only for a workspace.** `status = 'prospect'` and
   the null-`clerk_org_id` row are retired. A prospect is a party with a deal
   on the operator's pipeline.
3. **One soft pointer, one direction.** `tenants.operator_party_id` names the
   party the workspace was provisioned for. It is written once, at conversion,
   by an audited superadmin action in `/admin`. The CRM never writes `tenants`.
4. **`/admin` is an operations console.** It provisions, switches on, watches
   and supports. It renders no CRM; it links to the party. Where it must read
   the operator's rows — a party's name beside a workspace — it reads through
   `withTenant(operatorTenantId, …)` and the shared party door: narrower than
   `withSystem`, and never CRM's internals.
5. **The health check lands the way the enquiry does** ([0021](0021-a-website-enquiry-lands-as-a-party.md)):
   as `staff` with no user, inside the operator tenant, through the shared
   party and Work doors — plus a declared slot, `src/lib/leads/`, that CRM
   fills to open the deal and put the assessment on the timeline. The
   Discovery record (`audits`) becomes a tenant-scoped row of the operator
   tenant attached to the party; its outcome belongs to the deal.
6. **The agency's tailoring is Layer 2 and industry-blind:** a
   `professional-services` pack and an `agency` profile. Nothing is named
   `yosher`. The one verb only the platform's owner can perform — *a won deal
   provisions a workspace* — is Layer 0 and lives in `/admin`.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Build the CRM out at `/admin` | A second CRM, outside RLS, under `withSystem`, duplicating eleven merged slices. Nobody else pays for it, and the one the founder uses every day would be the worse one. |
| Keep prospects as `tenants` rows and mirror them into the CRM | Two writers of one fact. The day a salesperson moves a deal, either the console's status or the CRM's is stale — and the schema comment already had to explain which row is "really" the record. |
| Name the operator tenant in an env var | A different id per database, unseedable in tests, and one more value the deploy does not set. A flag with a partial unique index is a fact the database proves. |
| `/admin` embeds the operator tenant's CRM panels | Layer 0 importing Layer 1 to draw a party; every CRM change becomes a console change. Link out; the org switch costs one click. |
| A `yosher` pack or profile | Fails the neutrality test in the other direction: engagements, retainers and discovery are any services business's. A pack that knows it is Yosher is the fork [0004](0004-capability-packs-and-industry-profiles.md) exists to prevent. |
| A real FK from `tenants.operator_party_id` to `parties` | `parties` is keyed `(tenant_id, id)` and this pointer crosses tenants by design; a constraint would need the operator's id inside the platform row. Soft pointer, resolved under the operator's context, null when gone — the `site_enquiries.party_id` precedent. |
| Let the health check write a deal directly from `src/lib` | `createDeal` adopts the record, finds the default pipeline's opening stage and writes the first stage event; doing that raw from a lib is the last-write-wins bug the party door's header warns about, and importing CRM from a lib inverts the graph the registries keep straight. A slot CRM fills, the way `attention-sources` and `site-blocks` are filled. |

## Consequences

**Buys.** One CRM and one set of books, used by the business that sells them.
Every gap the founder hits is a gap the first client would have hit — and
Scheduling and Work, which nobody has clicked since they merged, get a real
user. Prospects live where the pipeline is. The console gets smaller and
sharper.

**Costs.**

- An org switch between the console and the workspace.
- The health check becomes the second public write into a tenant that does
  not name its tenant by a slug — the flag names it, which is stronger, and
  `security.md` §6 gains the row.
- `audits` moves under tenant RLS: its isolation test changes, the console
  reads it through the operator's context rather than `withSystem`, and the
  AGENTS.md sentence calling it "platform-level data with a superadmin-only
  RLS policy" stops being true in that slice.
- The operator tenant must be guarded against the console's own buttons —
  it cannot be paused, churned, stripped of modules, billed by itself or given
  a retainer with itself.
- Two migrations before the first lead lands in the CRM, not one.
- **The operator tenant is an ordinary tenant to the isolation suite.** If
  `tests/isolation/` ever grows an exception for it, the boundary has leaked.

## Notes

- **The retainer meter stays at Layer 0.** It is two-sided — Yosher writes the
  hours, the client reads the meter — and RLS lets neither tenant read the
  other's rows. Whatever the `professional-services` pack does for
  engagements, the client-facing meter is a platform projection of it. That is
  deferred, not decided; [retainer-hours.md](../modules/retainer-hours.md)'s
  "not a sellable module" is the sentence that changes when it is.
- **What would make us revisit:** a second operator — a white-label reseller
  running their own clients. Then `is_operator` becomes an `operator_tenant_id`
  on every tenant and the pointer's home does not change.
- The lesson underneath: **a table that was the only place for something
  keeps the job after a better place ships, until somebody notices.**
  `tenants` was the CRM for two months after the CRM merged.
