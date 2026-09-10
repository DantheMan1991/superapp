# Back office — running Yosher on Yosher

> The business that operates the platform runs on it: Yosher is a tenant of
> its own platform (the operator tenant), its clients are parties in that
> tenant's CRM, its money is in that tenant's books, and the console at
> `/admin` shrinks to what only a superadmin can do — provision a workspace,
> switch features on, watch, support. Plan and slice order below; the decision
> under it is [ADR 0041](../decisions/0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md).
> Status: partial — slices 0–1 built 2026-09-09 (the operator tenant exists; a client is a party); slices 2–7 planned below · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area. Every PR that
changes it MUST add an entry here (rule in AGENTS.md).

### 2026-09-09 — Slice 1: a client is a party (`claude/back-office-1-a-client-is-a-party`)

- **`tenants.operator_party_id`** (migration 0287): the one pointer from a
  workspace to its party in the operator's CRM. Soft — `parties` is keyed
  `(tenant_id, id)` and the pointer crosses tenants — written once by the
  console and by nothing in any module. `tests/isolation/operator.test.ts` now
  proves a member cannot write it from inside or outside, beside the flag.
- **`ensureOperatorParty` / `readOperatorParty`**
  (`src/app/admin/relationship.ts`). Under the OPERATOR's context as an owner
  — never `withSystem` — an organization party named for the business, its
  contact email as a contact point, a CRM record with `source = 'platform'`
  when CRM is on, and every console note as a `note` activity by its original
  author through CRM's own `logActivity`; then, under `withSystem`, the
  pointer, guarded so a second click cannot link a workspace to two parties.
  Idempotent: a linked workspace answers with its party and writes nothing.
  `readOperatorParty` reads the name back as `staff` and answers null for a
  party that is gone — the first place the console reads a tenant's rows
  through RLS rather than the god view.
- **Console.** The tenant page's Notes card is a **Relationship** card: the
  party's name and *Open in CRM*, or *Create its party in the CRM* with the
  legacy notes listed beneath until it exists. The operator's own page has no
  such card. The Clients list says how many workspaces have no party yet and
  offers *Create parties for N workspaces* — the backfill. Console notes
  stopped being written (`addTenantNote` and its form are gone); the rows
  stay until slice 3's DROP.
- **One click into the CRM.** The record route reads the ACTIVE organization,
  so *Open in CRM* first makes the operator active (Clerk's `setActive`, the
  sidebar switcher's own call) and then navigates; without that, a click from
  inside a client's organization was a 404. This was an Open item; closed.
- **Three departures from the plan as written.** The backfill is a **console
  action, not a script**: every door it needs — the party subsystem, CRM's
  ops, `logAudit` — is `server-only`, which a tsx script cannot load.
  Prospect rows are **left out of the backfill** on purpose (a party for
  `butt-fuck` would be junk in the operator's CRM; slice 3 decides which
  prospects are real) — the per-workspace button still works on one. And
  **`getOperatorTenant()` arrived here**, not in slice 2: the console needed
  the operator's id and Clerk org id for the read and the hop.
- **Tests must not assume an empty database.** Once the founder names the dev
  branch's operator, a test that minted its own would hit the unique index.
  `obtainOperator` in `tests/isolation/_shared.ts` takes the named one when it
  exists and mints one otherwise, and each test deletes exactly what it
  created — a party inside a real operator, never the operator.
  `tests/operator-relationship.test.ts` (db-backed) covers create /
  idempotence / refusal of the operator itself / read-back and null. On this
  run the dev branch had no operator yet, so both files took the minted path
  with CRM on.
- **Not driven in a browser** — another session's `next dev` held the
  directory again. Lint, `tsc`, pure and the three db-backed files against
  the dev branch are green. What to try by hand after merge: *Create parties
  for N workspaces* on `/admin` (or the per-workspace button on only the
  ones you want — the test workspaces are workspaces too), then *Open in CRM*
  from a tenant page; it should land on the record inside Yosher App.
- **Carried from slice 0:** Clerk auto-suffixes the slug of an organization
  created through its API (`yosher-app-1789009231912500266`; `test-1784…`
  before it) and the console shows the slug nowhere, so the operator script's
  argument is not the name. Slice 3's provisioning from a party should hand
  Clerk an explicit, deduped `slugify(name)`.

### 2026-09-09 — Slice 0: the operator tenant exists (`claude/back-office-plan`)

- **`tenants.is_operator`** (migration 0286) with the partial unique index
  `tenants_operator_idx WHERE is_operator = true` — at most one per database,
  proved by the index. `tenants` stays SELECT-only for members, so the flag is
  out of any member's reach. `tests/isolation/operator.test.ts` proves that
  from inside the operator and from outside it, proves the index refuses a
  second operator, and re-proves ordinary isolation with the operator as one
  half of the pair. It must never grow an exception (security.md S13).
- **`npm run db:operator-tenant -- <slug> [--dev] [--unset]`**
  (`scripts/operator-tenant.ts`) names the operator: refuses a prospect row
  (no Clerk organization behind it), refuses a second operator by name, sets
  `status` to `active`, and writes `tenant.operator_set` /
  `tenant.operator_cleared` to the audit log in the same transaction. Not
  through `logAudit`, which is `server-only`. The script points
  `DATABASE_URL` at the chosen database BEFORE it loads `src/db` — the trap
  a dotenv script walks into otherwise is reading production.
- **The guard is one pure predicate, `operatorRefusal(tenant, act)`**
  (`src/lib/operator-guard.ts`), import-free so the client components that
  draw a control and the server actions that refuse the press call the same
  function. Four acts, four sentences: `status`, `moduleOff`, `retainer`,
  `billing`.
- **What the console does with it.** The Clients list shows the row with an
  `Operator` badge and counts it in nothing — not Clients, Active, Paying or
  MRR. On the tenant page: the badge in the header; the status select is not
  drawn (the sentence stands in its place) and `setTenantStatus` refuses in
  the transaction it would have written; a switched-on feature's off-switch
  is disabled and `toggleModule` refuses before the dependency walk; the
  Retainer card is the sentence, and `setRetainerAllotment`, `startTimer`
  and `logManualTime` refuse; the Subscription card is the sentence.
  `/admin/retainers` leaves the operator out of its table.
- **What the operator's own workspace does with it.** `/dashboard/billing`
  says it is not billed and offers no plan, no portal and no Stripe read;
  `/dashboard/hours` says it has no retainer and offers no hour block. Both
  guides carry the line.
- **Two departures from the plan as written.** `getOperatorTenantId()` is
  NOT built: nothing in slice 0 calls it, and the health check (slice 2) is
  its first caller. And the status select refuses every change rather than
  only `paused` and `churned` — simpler, and the script sets the one value
  the row should hold.
- **Not driven in a browser** — Next 16 refuses a second `next dev` in a
  directory where one is already running, and another session's server held
  this one; the console is behind superadmin sign-in besides. Lint, `tsc`, the pure suite and the two
  isolation files against the dev branch are green. What to try by hand once
  the script has run: the Yosher row on `/admin`, its tenant page, and the
  operator's own Billing and Hours pages.

### 2026-09-09 — The plan (`claude/back-office-plan`)

- Grounded in the code as it stands (every seam below was read, not assumed),
  written before any slice. ADR 0041 records the decision and what it rules
  out; this file records the order and what each slice touches.

## The plan (proposed 2026-09-09)

### What is true today

- **`tenants` is doing two jobs.** Its own comment says *"a business in the
  CRM — the record that spans the whole lifecycle"*
  ([platform.ts](../../src/db/schema/platform.ts)). `status = 'prospect'` +
  null `clerk_org_id` is a business with no workspace; `tenant_notes` is
  *"admin CRM notes about a client"*; `audits.status` ends in `won | lost`.
  All of it predates the CRM and was right when written.
- **The health check mints a workspace for a stranger.** `promoteSession`
  ([interview.ts](../../src/lib/interview.ts)) writes a prospect `tenants`
  row, a `subscriptions` row and an `audits` row under `withSystem`. Compare
  the site enquiry ([enquiries.ts](../../src/lib/sites/enquiries.ts), ADR
  0021), which lands a stranger's message *inside a tenant* as `staff`
  through the shared doors — a party, a contact point, a CRM record when CRM
  is on, a follow-up in Work, an audit row, then an email. That is the shape
  the health check should have; it only lacked a tenant to land in.
- **The console** ([admin/layout.tsx](../../src/app/admin/layout.tsx)):
  Clients (the `tenants` list with an MRR stat), Retainers, Discovery
  (`/admin/audits`, the copilot over `audits`), Modules, Build docs, Audit
  log. The tenant page carries Discovery, Modules, Industry profile,
  Vocabulary, Retainer, Notes, Prospect (a convert form), Subscription,
  Ledger integrity, People, Recent activity.
- **Provisioning** is `createClientBusiness` and `convertProspectToClient`
  ([admin/actions.ts](../../src/app/admin/actions.ts)): a Clerk organization
  via `organizations.createOrganization`, `upsertTenantFromOrg`, an
  `org:admin` invitation to the owner's email. This part is right and stays;
  it just starts from a party instead of a form.
- **The CRM already has everything the sales motion needs**: parties with
  contact points, `crm_party_details` with an open `source`, pipelines with a
  default (`ensureDefaultPipeline` — "Sales", stages New / In progress / Won /
  Lost), deals with stage events, activities (`note | call | meeting`),
  follow-ups through Work's shared verbs, saved views, reports, automations.
- **Accounting has no estimate or quote.** Invoices, credit memos, recurring
  entries — nothing a business sends before the customer says yes. That is a
  core gap (a plumber, a dentist and a bookkeeper all quote), noted in Open
  items and not solved here.
- **Nothing posts the platform's own revenue anywhere.** `subscriptions` and
  `retainer_purchases` are written from Stripe's verified webhook and read by
  the console; no ledger sees them.
- **Nobody has run the business on the product.** Per the founder's notes,
  Scheduling and Work have never been clicked by a user since they merged.

### Readiness or dogfood first — not a fork

The founder asked which comes first. Once the seam is drawn they are the same
work for the first four slices: the relationship loop (a lead lands as a
party, a deal is won, a workspace is provisioned from it) IS the conversion
path a real client goes through, and it IS the dogfood (Yosher's prospects in
Yosher's CRM). Building readiness first would mean building the conversion
path against a `tenants` row that is about to stop being the record; building
dogfood first without the seam would mean two homes for every prospect.

What is left after that is genuinely readiness, and it orders itself:
**support access** (slice 4) is the one thing a live client needs from you on
day one that nothing else covers; **the money loop** (slice 5) can lag, because
Stripe collects regardless and the posting is idempotent on Stripe's ids, so a
late slice backfills; **health signals** (slice 6) need clients to signal.
The **pack and profile** (slice 7) are the productising step and come last —
they are worth more once a fortnight of running the agency inside the product
has said what an engagement actually is.

### The three rules every slice keeps

1. **The CRM never writes `tenants`.** Conversion is one audited superadmin
   action in `/admin`, from a party. Direction: platform → relationship
   (a provisioning event may leave a note on the party); relationship →
   platform only through that action.
2. **The console links out, never embeds.** `/admin` reads the operator's rows
   through `withTenant(operatorTenantId, …)` and the shared party door when it
   must show a name; it never imports CRM. Layer 0 importing Layer 1 to draw a
   party is how the boundary rots.
3. **The operator tenant is ordinary.** Same RLS, same policies, same
   isolation suite, no exception. What is special about it is a flag the
   console reads to refuse its own buttons.

### Slice order

Each slice is one PR. A slice with a migration follows ADR 0014 to the
letter: `db:migrate -- --dev`, `db:migrate`, `db:verify-rls -- --dev`,
`db:verify-rls`, then merge. Every slice adds an entry to this build log and
touches the docs it names.

#### Slice 0 — The operator tenant exists — BUILT 2026-09-09

**What.** `tenants.is_operator boolean NOT NULL DEFAULT false` and a partial
unique index `WHERE is_operator` — at most one per database. A one-time
script, `scripts/operator-tenant.ts` (the `create-app-role.ts` shape: run by
hand, under `withSystem`, audited as `tenant.operator_set`), rather than a
console button: moving the flag is not a routine act. The lookup,
`getOperatorTenant()`, arrived with its first caller — slice 1's console
read — rather than here.

**The guard.** A pure predicate the console's actions call before acting on
the operator row: the status select is not drawn and the action refuses
any change; the module toggle refuses to switch a feature off; `/admin/retainers` and the
retainer card leave it out (a retainer with itself); the MRR stat and the
Subscription card leave it out; the operator's own `/dashboard/billing` says
it is the operator and offers no plan, and `/dashboard/hours` no hour block.
`markTenantChurned` from the Clerk webhook is left alone — a deleted organization is a fact, not a button.

**By hand, once.** Create the Yosher organization on the production Clerk
instance, be its owner, run the script on dev and on prod, switch on
Accounting, CRM, Documents, Mail, Work, Scheduling and Marketing through the
existing toggles. The books begin on a day (ADR 0035); the Sales pipeline
makes itself on the first visit to the board.

**Tests.** `tests/isolation/operator.test.ts`: a second operator is refused by
the index; members cannot write the flag (already true — `tenants` is
SELECT-only for members — and now proven for this column). Unit tests for the
guard predicate. **Docs.** This file; `architecture.md` §4 gets the operator
tenant beside the god view; `security.md` §3 gets the "ordinary tenant"
invariant.

#### Slice 1 — A client is a party — BUILT 2026-09-09

**What.** `tenants.operator_party_id uuid` — nullable, no FK (`parties` is
keyed `(tenant_id, id)`; the pointer crosses tenants by design, like
`site_enquiries.party_id`). A backfill — a console action, not a script;
the build log says why — that, for every workspace, creates an organization
party in the operator tenant through the shared door (`createParty`,
`addContactPoint` from `contact_email`) with a CRM record
`source = 'platform'`, moves each `tenant_notes` row onto the party as a
`note` activity, and writes the pointer. Run from the Clients page.

**The console.** The tenant page's Notes card becomes a Relationship card:
the party's display name (read via `withTenant(operatorTenantId, …, { role:
"staff" })` after `requireSuperAdmin()` — the first time the console reads a
tenant's rows through RLS instead of the god view, which is narrower, not
wider) and one link, *Open in CRM*, to `/dashboard/m/crm/records/<id>`. The
link works when the founder's active organization is the operator's; the
console header says which organization is active and links to the switcher.
`tenant_notes` stops being written; its DROP is slice 3's second migration,
after this one has deployed and been read.

**Tests.** Isolation: the column is SELECT-only like its neighbours. Unit:
the name resolver answers null for a pointer whose party is gone. **Docs.**
This file; `crm.md` gets a paragraph on the operator's records.

#### Slice 2 — Discovery comes home, and a lead lands as a lead

**The slot.** `src/lib/leads/` — `types.ts`, `registry.ts`, `resolve.ts`,
under the same lint rule as the other registries (only `registry.ts` may
import a module). A `LandedLead` is `{ partyId, source, proposition? }`,
where `proposition` is `{ title, summary }` — present when the visitor asked
about buying something, absent for a plain message. CRM fills it
(`src/modules/crm/leads.ts`): adopt the record with the source; when there is
a proposition, `createDeal` on the default pipeline at its opening stage
titled with it, and a `note` activity carrying the summary. `resolve.ts`
checks the feature is switched on and runs the filler inside the caller's
transaction. **The enquiry moves onto the slot** with no proposition, so its
behaviour is unchanged and there is one door for a stranger's arrival.

**The health check.** `promoteSession` stops writing `tenants` and
`subscriptions`. It resolves the operator tenant by the flag (no slug: the
visitor chooses nothing) and lands, as `staff` with no user, inside
`withTenant(operatorTenantId, …, { role: "staff" })`: an organization party
named for the business plus a person party for the contact, joined by
`crm_affiliations` when CRM is on; contact points; the slot with a
proposition (the business name, the assessment); a follow-up due today
through `createWorkForEntity`; the `audits` row (below); an audit-log row.
Then the email to the operator's owners, `Reply-To` the visitor — the
enquiry's `notifyPlan`. The caps stay as they are.

**`audits`.** Gains `tenant_id` (= the operator, NOT NULL after the data
move) and `party_id`; its policy `audits_superadmin_all`
([0004_audits_rls.sql](../../drizzle/0004_audits_rls.sql)) is replaced by the
standard tenant member policies. `/admin/audits` and the copilot read and
write through the operator's context. `status` keeps its enum (Postgres
cannot drop a value); `won` and `lost` are no longer written — outcome is the
deal's — and the Zod schema refuses them. `interview_sessions` stays
platform-level: it is the conversation *before* anyone is known.

**Tests.** `interview.test.ts` rewritten for the new policies; `leads`
resolve unit tests (off feature → nothing, no proposition → record only);
`operator.test.ts` proves the health check's rows land in the operator and
in no other tenant. **Docs.** This file; `health-check.md`; `crm.md`;
`extension-model.md` §4 gets the slot as its fifth use; `security.md` §6's
`/health-check` row stops saying "no tenant data"; AGENTS.md's sentence about
`audits`.

**Drive by hand, on dev.** One health check end to end, then open the
operator's CRM: the party, the deal at New, the assessment on the timeline,
the follow-up on `/tasks`.

#### Slice 3 — Provision from a party; prospects retire

**What.** `/admin/clients/new` becomes *New workspace*: a type-ahead over the
operator's parties (`searchReachableParties` through the shared door under the
operator's context), the industry profile, the owner's email. It does what
`createClientBusiness`'s client branch does today — Clerk organization,
`upsertTenantFromOrg`, the invitation — and writes `operator_party_id`; the
`kind` select and the prospect branch go. `convertProspectToClient` and the
Prospect card go with them. The party gets a `note` activity, *Workspace
provisioned*, written as the platform's one permitted touch on the
relationship.

**The data.** Existing prospect rows (their audits moved home in slice 2, so
nothing cascades away) are deleted by a script after their parties are
confirmed; `prospect` stays in the enum, refused by Zod, documented retired.
Second migration, after slice 1 has been read on prod: `DROP TABLE
tenant_notes`.

**Tests.** The action refuses a party the operator does not hold; the
pointer is written once. **Docs.** This file; `architecture.md` line about
`admin/`; the `tenants` schema comment stops calling itself the CRM.

#### Slice 4 — Look at it as they see it (support access)

**What.** A superadmin opens a client's dashboard read-only. A
`support_sessions` table (`tenant_id`, `clerk_user_id`, `expires_at`,
`reason`), opened from the tenant page with a reason, audited as
`support.opened`; `resolveTenantContext()` honours a live session **for page
renders only** — server actions and `src/app/api/**` never resolve one, so a
write from a support view fails closed with *"you are viewing as support"*
rather than depending on every action to check. RLS role `staff`; a banner on
every page; every render audited as `support.viewed` with the path.

**Why now.** The first live client's first call is "where is my invoice", and
the only answer today is a `withSystem` query by hand.

**Tests.** Isolation for the table; a server action under a support session
is refused; the session expires. **Docs.** This file; `security.md` §6 gains
the row and §3 the invariant; `identity-and-roles.md`.

#### Slice 5 — The money loop

**What.** The operator's books see the platform's revenue. From the verified
Stripe webhook, `invoice.paid` on a subscription and the hour-block Checkout
session become a paid invoice against the client's customer in the operator
tenant, through Accounting's own verbs under `withTenant(operatorTenantId, …,
{ role: "staff" })` — the trusted-sync exemption the webhook already lives
under. `operator_postings` (`stripe_object_id UNIQUE`, `kind`, `invoice_id`)
is the idempotency arbiter, the `retainer_purchases.stripe_session_id`
pattern. Conversion (slice 3) mints the customer role on the party
(`createPartyForRole`'s neighbour in `role-sync.ts`) so the invoice has
somebody to be for. A backfill posts what Stripe already holds.

**Not decided here:** whether retainer *time* posts as revenue or WIP. The
meter stays at Layer 0 (ADR 0041, Notes).

**Docs.** This file; `accounting.md`; `security.md` §6's Stripe row.

#### Slice 6 — Health signals on the console

**What.** The Clients list stops being a table of names: last sign-in
(`memberships.last_seen_at`, stamped by `requireTenant()` at most once an
hour), features used this month (from `audit_log`), subscription state,
retainer overage (the existing math), and what the client owes Yosher (the
operator's open invoices, by `operator_party_id`). Nothing new to write by
hand; every column is derived.

#### Slice 7 — The `professional-services` pack and the `agency` profile

**What.** The pack every services business would recognise: an
*engagement* (a client's agreement — scope, retainer hours, rate, start),
time against an engagement, onboarding templates as Work lists. The
Discovery screen leaves the console for the pack, so the operator's staff
can run discovery without being superadmins. The `agency` profile lists the
pack, supplies vocabulary (*Client*, *Engagement*) and a service-business
chart of accounts — which needs the profile seed applier that
[packs-and-profiles.md](packs-and-profiles.md) records as unbuilt, so that
comes first inside this slice.

**Nothing in it is named Yosher.** Yosher is the pilot, as Hilltop Farm is the
homestead profile's.

## Data model

Slice 0 built, the rest planned. Every table below carries `tenant_id`, FORCE
RLS and an isolation test, per `security.md` §4.

| Table / column | Slice | Purpose | Notes |
| --- | --- | --- | --- |
| `tenants.is_operator` | 0 — built, migration 0286 | Names the operator tenant | Partial unique index `WHERE is_operator`; set by script under `withSystem`, never by a console action |
| `tenants.operator_party_id` | 1 — built, migration 0287 | The party in the operator tenant this workspace was provisioned for | Soft pointer, no FK; written once at conversion; null when the party is gone |
| `audits.tenant_id`, `audits.party_id` | 2 | Discovery becomes the operator's, attached to the party | Standard tenant policies replace `audits_superadmin_all`; `won`/`lost` retired |
| `src/lib/leads/` | 2 | The slot a stranger's arrival passes through | No table. CRM fills it |
| `tenant_notes` | 3 | Dropped | After slice 1's move has deployed |
| `support_sessions` | 4 | A superadmin's time-boxed read-only view of a tenant | Honoured for renders only |
| `operator_postings` | 5 | Stripe object → operator invoice | `stripe_object_id UNIQUE` is the idempotency arbiter |
| `memberships.last_seen_at` | 6 | Health signal | Stamped at most hourly |

## Key files & seams

- `src/lib/operator-guard.ts` (slice 0) — the one predicate both sides of the console call; `scripts/operator-tenant.ts` names the operator.
- `src/lib/operator-tenant.ts` (slice 1) — the operator, read once: id and Clerk org id.
- `src/app/admin/relationship.ts` + `relationship-controls.tsx` (slice 1) — a client is a party: ensure, read, the three buttons.
- `src/lib/leads/` (slice 2) — types, registry, resolve; `src/modules/crm/leads.ts` fills it.
- `src/lib/interview.ts` — `promoteSession` becomes a landing, not a provisioning.
- `src/lib/sites/enquiries.ts` — moves onto the slot with no proposition.
- `src/app/admin/actions.ts` — provisioning from a party; the guard.
- `src/lib/auth.ts` — `resolveTenantContext()` learns support sessions (slice 4), renders only.
- `src/app/api/webhooks/stripe/route.ts`, `src/lib/retainer-billing.ts` — the money loop's sources.

## Decisions & gotchas

- **Why not a bigger console CRM, why not a `yosher` pack, why a flag and not
  an env var, why a soft pointer** — all in [ADR 0041](../decisions/0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md).
- **A public write with no user carries `userId: ""`**, the enquiry's
  convention; `crm_deal_stage_events.changed_by_clerk_user_id` and
  `crm_activities.created_by_clerk_user_id` are NOT NULL and accept it. Slice
  2 must check the CRM timeline renders a deal nobody typed the way the
  follow-up list already renders the enquiry's item.
- **Order is load-bearing between slices 2 and 3.** `audits.tenant_id`
  cascades from `tenants`; prospect rows may be deleted only after their
  audits have moved.
- **An enum value cannot be dropped.** `prospect` stays in `tenant_status`
  forever; Zod refuses it and the docs say why.
- **The console reads the operator through `withTenant`, not `withSystem`.**
  Narrower, and the pattern support access (slice 4) generalises.

## Open items

- **No estimate/quote in Accounting** — core, not this area; the first
  proposal Yosher sends will want one.
- **Retainer time as revenue or WIP**, and whether the client-facing meter
  becomes a projection of the pack's engagements — deferred (ADR 0041, Notes).
- **Yosher's own public site** is the `(marketing)` route group in code, not a
  Marketing-module site. Running it through the module would be the loudest
  dogfood of all; not in this plan.
- **A second operator** (white-label) — the revisit trigger in the ADR.
