# Back office — running Yosher on Yosher

> The business that operates the platform runs on it: Yosher is a tenant of
> its own platform (the operator tenant), its clients are parties in that
> tenant's CRM, its money is in that tenant's books, and the console at
> `/admin` shrinks to what only a superadmin can do — provision a workspace,
> switch features on, watch, support. Plan and slice order below; the decision
> under it is [ADR 0041](../decisions/0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md).
> Status: partial — slices 0–6 and 7a built (the operator tenant exists; a client is a party; Discovery comes home and a lead lands as a lead; a workspace is provisioned from a party and prospects retire; support access; the money loop; health signals; the agency profile and the seed applier); slices 7b–7d planned below · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area. Every PR that
changes it MUST add an entry here (rule in AGENTS.md).

### 2026-09-10 — Slice 7a: seeds land, and the agency profile exists (`claude/back-office-7a-seeds-and-the-agency-profile`)

- Slice 7 split into four, because the plan itself says the engagement model
  is worth more once a fortnight of running the agency inside the product has
  said what an engagement is: **7a** the platform gap and the profile (this),
  **7b** engagements and time, **7c** onboarding as a Work list, **7d**
  Discovery leaves the console. The order is in [agency.md](agency.md).
- **The profile seed applier is built** (`src/app/admin/profile-seed.ts`) —
  the gap [packs-and-profiles.md](packs-and-profiles.md) had carried since
  Layer 2 shipped. A seed lands only in a module that is on and is not lost
  when it is off: `installProfile` applies it for what is on, `toggleModule`
  for a module switched on later. Additive; the tenant's own rows win.
- **The `agency` profile** (`src/industries/agency/`): one pack,
  `professional-services`, declared and unbuilt in `src/packs/index.ts` and
  seeded `coming_soon`; a chart of twelve additions over the general one
  (Work in Progress, Client Retainers Held, five income lines under Sales,
  two direct costs, three expenses); folders *Clients* and *Proposals*; the
  dollar sign. No labels: the pack's fallbacks are this industry's words.
  Nothing in it is named after the business that pilots it.
- **Not driven.** After the merge: *Install profile → Agency* on the
  operator tenant's page; its chart gains the twelve and Documents two
  folders. `db:seed` run on dev and prod before opening the PR, because the
  pack's `modules` row is what an install writes against.

### 2026-09-10 — Slice 6: health signals on the console (`claude/back-office-6-health-signals`)

- **Last seen.** `memberships.last_seen_at` (migration 0294), stamped by the
  member's own request in `requireTenant`/`resolveTenantContext` — at most
  once an hour (`shouldStampSeen`, pure, `src/lib/last-seen.ts`) and once per
  request (`cache`), never by a support view, which is the superadmin's
  request and not the client's sign-in. The membership row is now read for
  every role, an owner's too; Clerk still decides owner-vs-member.
- **The signals** (`src/app/admin/health.ts`), derived and never typed: the
  newest last-seen across a workspace's members; audit-log rows in the last
  thirty days, when the last was, and which FEATURES they belonged to — a
  best-effort map of action prefixes to feature slugs (`ledger`, `books`,
  `bill`, `invoice`, `banking`, `close` → accounting; `mail` → email; and so
  on), because the prefixes were named by hand over two months and do not
  all match a slug, so a prefix the map does not know is counted and never
  attributed; the retainer's month from the existing math; and what the
  client owes the operator — open invoices less what was paid or credited,
  per party, read through the operator's own context (slice 5 put them
  there). Each becomes a CONCERN — past due, over retainer, owes, quiet
  thirty days, never signed in — with a weight.
- **The Clients list** sorts by concern first, then the operator's row, then
  newest; a concern is a badge under the name (`Over retainer by 1.5 h`,
  `Owes $250.00`); the columns are Status, Subscription, Last seen, the
  thirty days (count and features), Modules, Since. The stats trade "Active"
  for "Need a look". The tenant page gains a *Health* card with the same
  numbers.
- **Tests.** `tests/last-seen.test.ts` (pure): the hourly rule, the words,
  quiet. `tests/health-signals.test.ts` (db-backed): a busy client seen three
  hours ago with three audit rows (two features the map knows, one it does
  not), a one-hour retainer with two hours logged (over by an hour), and —
  against a minted operator only — a $250 issued invoice it owes; a silent
  client past due reads never-signed-in, past due first, score 9.
- **Not driven** — same reason as before. What to try by hand: `/admin` sorted
  by concern, and a client's Health card.

### 2026-09-10 — Slice 5: the money loop (`claude/back-office-5-the-money-loop`)

**Slice 4 was DRIVEN on production first, with the founder signed in.** The
Support card opened a session (`support.opened`), `/dashboard` was answered
as Hilltop Farm's workspace with the banner and `support.viewed` (the GET path
of the wall works), and the founder opened his own view meanwhile, which
ended mine — one live per person, as designed. What the drive found: the
console's *Opening…* stayed stuck because `router.refresh()` right after
`router.push()` aborted the navigation it had just started
(`ERR_ABORTED` on the `/dashboard` RSC request); both buttons lose the
refresh here. The founder then drove the view himself — six pages, a journal
form among them — and ended it; my later press of *Add record* ran eleven
minutes after that, in Yosher App's own workspace, which is exactly right
with no session live. The wall's refusal was therefore not exercised in the
pane; it is certified by the pure test and stands unchanged.

- **A charge becomes a paid invoice in the operator's books** ([ADR 0043](../decisions/0043-the-platforms-revenue-is-posted-by-the-webhook-as-the-operators-owner.md)).
  `src/lib/platform-revenue.ts`: `postPlatformCharge` claims the Stripe
  object once in `operator_postings` (migrations 0292 + 0293, superadmin-only),
  then — as the operator's owner with no user, through Accounting's own verbs
  — a draft with one line to Service Revenue (4010, else Sales 4000), issued,
  and paid into Undeposited Funds on the day Stripe says it was paid, for the
  customer role on the client's party (made if missing — the party is the
  identity, the role is what an invoice is for). The invoice's memo carries
  `stripe:<id>`, so a crash between the ledger write and the posting row is
  found on the next attempt, never posted twice.
- **Two sources.** The webhook's new `invoice.paid` case, which finds the
  workspace by OUR `subscriptions.stripe_customer_id` and never by the
  payload's metadata; and the hour-block credit (`creditHourBlockFromSession`,
  webhook and reconcile alike), which posts after it credits, keyed on the
  session id so both paths meet the same row.
- **Skipped, never dropped.** `SKIP_REASONS`: no operator, Accounting off,
  unknown customer, no party, nothing paid, a foreign currency, no 4010/4000
  or no Undeposited Funds, before the books begin (ADR 0035), a ledger
  refusal. The operator's tenant page gains a *Platform revenue* card — total
  posted, skipped count, the latest postings with the client and the reason —
  and two verbs: *Post what Stripe holds* (every paid invoice of every known
  customer, every hour block ever credited; idempotent) and *Retry N skipped*.
- **Tests.** `tests/platform-revenue.test.ts` (db-backed): posts a charge as
  a paid invoice for the client's customer role with a `stripe` payment; the
  same object again posts nothing twice; a client with no party is skipped
  and posts on retry once it has one; nothing paid, a foreign currency and a
  day before the books begin are skipped. **It runs only against a MINTED
  operator** — it writes real invoices, and a database where the founder has
  named one holds Yosher's own books — and says so; CI builds from zero and
  always runs it. `tests/isolation/platform-revenue.test.ts`: superadmin-only.
- **Not driven** — posting needs a real Stripe charge. The first real one is
  the drive: a client subscribes, and an invoice appears in Yosher App's
  Accounting. Until then *Post what Stripe holds* on the operator's page
  posts the Test workspace's history, if any.

### 2026-09-10 — Slice 4: look at it as they see it — support access (`claude/back-office-4-support-access`)

- **`support_sessions`** (migrations 0290 + 0291): platform-level,
  superadmin-only. A row is a superadmin's look at one client's workspace —
  who, which, why, opened, expires (sixty minutes), ended, views. One live
  per person by partial unique index; opening a new one ends the last.
- **The wall is the request, not every action.** `requireTenant()` and
  `resolveTenantContext()` share one lookup (one transaction, as before) that
  also fetches the viewer's live session. With one, the decision is PURE
  (`src/lib/support-view-decide.ts`): a GET or HEAD carrying no
  `next-action` header is answered as the client's workspace; a server
  action or any other method is REFUSED outright — `SupportViewError` from
  `requireTenant`, null from `resolveTenantContext` — never answered under
  the superadmin's own workspace (a client's ids in the wrong tenant) and
  never under the client's (a write). The method and path come from headers
  the MIDDLEWARE stamps (`x-yosher-method`, `x-yosher-path`), overwriting
  anything a client sent; an unstamped method reads as not-a-GET.
- **Role `staff`**, the least a member can be: owners-only folders stay
  closed by RLS, owner pages (`requireTenantOwner`) redirect, the CRM and
  Accounting render as they do for staff. A viewer who is no longer a
  superadmin, or whose session's tenant is gone, has the session ended and
  falls through to the ordinary path. Every render audits `support.viewed`
  with the path — once per request, `React.cache` collapsing the layout's and
  the page's calls — and counts on the session.
- **Console and banner.** The tenant page's *Support* card takes a reason and
  opens the view (`openSupportViewAction`, audited `support.opened`, refused
  for the operator — the superadmin is already inside it); the dashboard
  shows a bar on every page with the workspace, the reason, the minutes left
  and *End support view* (`endSupportViewAction`, audited `support.ended`
  with the view count, then back to the tenant page).
- **What a render may still write.** The wall stops actions and non-GET
  routes; a page that writes on load runs as staff under the client's
  policies. Every such page was read: billing and hours are owner-only or
  need a checkout parameter, the CRM board's first-visit pipeline needs an
  owner, the Team page reconciles only for an owner. None writes under
  support. A database-level READ ONLY for support renders would need the
  context to reach `withTenant` through fifty-six hand-written role unions;
  recorded under Open items, not done.
- **Tests.** `tests/support-view.test.ts` (pure) — none / view / refuse, and
  the unstamped method; `tests/support-sessions.test.ts` (db) — open ends
  the last, views counted and audited with their paths, ending and expiry;
  `tests/isolation/support.test.ts` — members see and write nothing, no
  context sees nothing, the superadmin sees.
- **Not driven in a browser** — opening a view needs the superadmin's Clerk
  session in the pane. What to try by hand: *Support* on a client's page →
  the dashboard with the bar → any Save (refused) → *End support view*.

### 2026-09-10 — Slice 3: a workspace is provisioned from a party; prospects retire (`claude/back-office-3-provision-from-a-party`)

**Slices 1 and 2 were DRIVEN first, on production, in the pane with the
founder signed in, after #476 deployed.** *Create its party* on Hilltop Farm
made the party, and the breadcrumb attached its July transcript on the spot;
*Open in CRM* switched the active organization and landed on the record
(`platform` source, the contact email as main). A full health check as a
stranger landed in Yosher App — both parties, the contact point, both records
with source `health-check`, the affiliation, the note, the follow-up on the
CRM's Follow-ups tab (`/dashboard/m/crm/tasks`), the attached discovery record
with the assessment as its intake notes — and the visitor got the written
health check. **No deal**, because Yosher App had no pipeline yet: the Board's
first visit (`/dashboard/m/crm/deals`) made *Sales*, so the next lead gets one
— a prerequisite worth knowing, recorded under Open items. **The lead email
failed**: Resend reports `mail.yosherapp.com` is not a verified sending
domain, so EVERY platform notification fails until the founder verifies it
(`outbound_emails.status = failed`). And "haveno" on the Clients page — a
JSX newline after `}` collapsing to nothing — fixed here.

- **A workspace is provisioned FROM a party.** `/admin/clients/new` is *New
  workspace*: the operator's organization parties that no workspace points at,
  an industry profile (or none), an owner's email. `provisionWorkspace`
  (actions.ts) composes `resolveProvisionTarget` → Clerk → `upsertTenantFromOrg`
  → `attachWorkspaceToParty` (`src/app/admin/provision.ts`). Everything the
  console can check is checked before Clerk is asked for anything — the party
  is the operator's, is a business, has no workspace — and Clerk is handed an
  explicit, deduped slug (the carried gotcha, closed) with Clerk's own suffix
  as the fallback when the slug is taken on its side by an organization this
  database no longer knows. Then the pointer (once), the party's email as the
  contact, a *Workspace provisioned* note on the timeline, the profile install,
  the invitation. `createClientBusiness`, `convertProspectToClient`, the
  Stage select, the Prospect card and *Convert to client* are gone.
- **Prospects retire.** `status = 'prospect'` is refused by the console's
  schema and documented retired on the enum (Postgres cannot drop a value).
  `npm run db:retire-prospects [-- --dev] [-- --delete]` lists the rows with
  no Clerk organization and deletes on `--delete` — dry run by default,
  because the judgment is the founder's. Nothing cascades from them any more:
  slice 2 moved every audit home. Dev: the three deleted. Production: the same
  three listed (`test`, `greenline-test-landscaping`, `butt-fuck`), deleted
  on the founder's word.
- **`tenant_notes` dropped** (migration 0289): it held nothing on either
  database. The notes machinery left with it — `ensureOperatorParty` no
  longer carries notes, the Relationship card no longer lists them, and a note
  about a client is the party's.
- **Tests.** `tests/operator-provision.test.ts` (db-backed): refuses an
  unknown party, a person, a business with a workspace; resolves name, email
  and a deduped slug; attaches once with the note and links nothing the second
  time. `operator-relationship.test.ts` without the notes;
  `tests/isolation/core.test.ts` loses its `tenant_notes` block.
- **Not driven in a browser** — creating a workspace makes a real Clerk
  organization. The founder provisions the first real client from its party.

### 2026-09-09 — Slice 2: Discovery comes home, and a lead lands as a lead (`claude/back-office-2-discovery-comes-home`)

- **`audits` is the operator's table now** (migration 0288): `tenant_id` is
  the OPERATOR (NOT NULL), `party_id` the party the record is about,
  `origin_tenant_id` the tenant it used to be about — a breadcrumb
  `ensureOperatorParty` reads to attach the record the day that business
  gets its party, and nothing reads for access. Policies: `superadmin_all`
  kept, `member_all` added — Yosher's staff read discovery, like the sales
  team they are.
- **One migration, and it refuses where it must.** The rows move and the
  member policy land in the same file, because either half alone is wrong: a
  member policy before the move lets a client's staff read a transcript about
  themselves; the move before the policy hides the rows from the operator.
  And it RAISES on a database that has audits but no named operator, rather
  than leave a transcript under its old tenant. The dev branch tripped that
  guard on the first run — four test transcripts, no operator — and the four
  were deleted rather than an operator named for a fixture; the founder
  names the dev operator when convenient.
- **The leads slot** — `src/lib/leads/` (types, registry, resolve), the
  eighth declared extension point and the first whose caller is a public door
  with nobody at the keyboard (ADR 0042). A door that has written the party
  calls `landLead(tx, ctx, { partyId, contactPartyId?, source, proposition? })`
  inside its own transaction; `src/modules/crm/leads.ts` fills it — record
  with source, the person joined to the business, a deal in the opening stage
  when there is a proposition, a note. It never fails the arrival and never
  lets a database error escape (that poisons the transaction): an affiliation
  is looked up before it is added and is never primary, and a missing default
  pipeline is a deal not opened. **The enquiry and the booking moved onto the
  slot** with no proposition — behaviour unchanged, and neither file names a
  CRM table any more.
- **The health check lands in the operator tenant.** `promoteSession` stops
  writing `tenants` and `subscriptions`. It claims the session atomically
  (only `awaiting_contact` flips to `completed`, so a double submit answers
  with the first landing), then, as `staff` with no user inside
  `withTenant(operator, …)`: the business party, the person (matched by
  email when the operator already knows the inbox), the contact point, the
  discovery record with `party_id`, the slot with a proposition, a follow-up
  due today, an audit-log row — one transaction. A failed landing hands the
  claim back so the visitor can retry. Then the operator's owners are
  emailed (`kind: health_check`, Reply-To the visitor — the Open item "no
  notification on promotion" closes), and the assessment, once written, is
  also the record's intake notes so the founder's discovery starts from what
  the visitor was told. No operator named → `unavailable`, logged.
- **Console.** Every Discovery action runs through the operator's context as
  an owner (`asOperator` in `audits/actions.ts`) — never `withSystem`. A new
  engagement is for a PARTY (the operator's organizations; the tenant page's
  *Start discovery* passes its party, or says to create one first). The list
  links to the workspace that points at the party; the record page has *Open
  in CRM*, a *Workspace* link, an *Attach* picker for a record nothing points
  at, and *Delete* (`interview_sessions.audit_id` is SET NULL, so the public
  session keeps its own transcript). `won`/`lost` are no longer written —
  the outcome is the deal's; the enum keeps them because Postgres cannot drop
  a value, and the Zod schema refuses them.
- **Tests.** `tests/leads-db.test.ts` (off → nothing; plain message → record
  with source; proposition → deal in the opening stage, affiliation, note;
  second arrival → no duplicate, and a write after the slot in the same
  transaction still succeeds). `tests/interview.test.ts` promotion rewritten:
  lands in the operator, mints no workspace, deal + affiliation + note when
  CRM is on, same inbox is the same person, double submit is one landing,
  assessment failure still lands. `tests/isolation/interview.test.ts` gains
  the audits block: the operator's members read and write, another tenant
  sees and changes nothing, no context sees nothing. All obtain the operator
  rather than mint one.
- **Not driven in a browser** — same reason as slices 0 and 1. What to try by
  hand after merge: one health check end to end on yosherapp.com, then Yosher
  App's CRM — the business, the person, the deal at *New*, the note, the
  follow-up on `/tasks` — and the email to the owners.
- **Carried from slice 0** (again, since #475 merged before it could be
  written): Clerk auto-suffixes the slug of an organization created through
  its API, and the console shows the slug nowhere.

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

#### Slice 2 — Discovery comes home, and a lead lands as a lead — BUILT 2026-09-09

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

#### Slice 3 — Provision from a party; prospects retire — BUILT 2026-09-10

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

#### Slice 4 — Look at it as they see it (support access) — BUILT 2026-09-10

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

#### Slice 5 — The money loop — BUILT 2026-09-10

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

#### Slice 6 — Health signals on the console — BUILT 2026-09-10

**What.** The Clients list stops being a table of names: last sign-in
(`memberships.last_seen_at`, stamped by `requireTenant()` at most once an
hour), features used this month (from `audit_log`), subscription state,
retainer overage (the existing math), and what the client owes Yosher (the
operator's open invoices, by `operator_party_id`). Nothing new to write by
hand; every column is derived.

#### Slice 7 — The `professional-services` pack and the `agency` profile — 7a BUILT 2026-09-10, 7b–7d planned

**What.** The pack every services business would recognise: an
*engagement* (a client's agreement — scope, retainer hours, rate, start),
time against an engagement, onboarding templates as Work lists. The
Discovery screen leaves the console for the pack, so the operator's staff
can run discovery without being superadmins. The `agency` profile lists the
pack and contributes a service-business chart of accounts — which needed the
profile seed applier [packs-and-profiles.md](packs-and-profiles.md) recorded
as unbuilt, so that came first.

**In four PRs**, the order and each one's shape in [agency.md](agency.md):
7a the seed applier and the profile (built); 7b engagements and time; 7c
onboarding as a Work list; 7d Discovery leaves the console.

**Nothing in it is named Yosher.** Yosher is the pilot, as Hilltop Farm is the
homestead profile's.

## Data model

Slice 0 built, the rest planned. Every table below carries `tenant_id`, FORCE
RLS and an isolation test, per `security.md` §4.

| Table / column | Slice | Purpose | Notes |
| --- | --- | --- | --- |
| `tenants.is_operator` | 0 — built, migration 0286 | Names the operator tenant | Partial unique index `WHERE is_operator`; set by script under `withSystem`, never by a console action |
| `tenants.operator_party_id` | 1 — built, migration 0287 | The party in the operator tenant this workspace was provisioned for | Soft pointer, no FK; written once at conversion; null when the party is gone |
| `audits.tenant_id`, `audits.party_id`, `audits.origin_tenant_id` | 2 — built, migration 0288 | Discovery becomes the operator's, attached to the party; the origin is a breadcrumb for attaching later | `member_all` added beside `superadmin_all`; `won`/`lost` retired; the migration refuses a database with audits and no operator |
| `src/lib/leads/` | 2 — built | The slot a stranger's arrival passes through (ADR 0042) | No table. CRM fills it |
| `tenant_notes` | 3 — dropped, migration 0289 | Dropped | It held nothing on either database by then |
| `support_sessions` | 4 — built, migrations 0290/0291 | A superadmin's time-boxed read-only view of a tenant | Superadmin-only; honoured for a GET and nothing else |
| `operator_postings` | 5 — built, migrations 0292/0293 | Stripe object → operator invoice, or the reason it is not one yet | `stripe_object_id UNIQUE` claims the object; the invoice memo finds a half-finished posting; superadmin-only |
| `memberships.last_seen_at` | 6 — built, migration 0294 | Health signal | Stamped at most hourly by the member's own request; never by a support view |

## Key files & seams

- `src/lib/operator-guard.ts` (slice 0) — the one predicate both sides of the console call; `scripts/operator-tenant.ts` names the operator.
- `src/lib/operator-tenant.ts` (slice 1) — the operator, read once: id and Clerk org id.
- `src/app/admin/relationship.ts` + `relationship-controls.tsx` (slice 1) — a client is a party: ensure, read, the three buttons.
- `src/lib/leads/` (slice 2) — types, registry, resolve; `src/modules/crm/leads.ts` fills it.
- `src/lib/interview.ts` — `promoteSession` is a landing, not a provisioning; `notifyOperator` the email.
- `src/lib/sites/enquiries.ts`, `bookings.ts` — on the slot, no proposition.
- `src/app/admin/audits/` — every action through `asOperator`; `audit-controls.tsx` attach and delete.
- `src/app/admin/provision.ts` (slice 3) — resolve the party, attach the workspace; `provisionWorkspace` in actions.ts is the only place Clerk is asked; `scripts/retire-prospects.ts`.
- `src/app/admin/health.ts` (slice 6) — the signals and the concerns; `src/lib/last-seen.ts` the hourly rule and the words.
- `src/app/admin/profile-seed.ts` (slice 7a) — a profile's seed lands in the modules that are on; `src/industries/agency/` the profile and its chart.
- `src/app/admin/actions.ts` — provisioning from a party; the guard.
- `src/lib/auth.ts` — `requireTenant`/`resolveTenantContext` honour a live support session for a GET only (slice 4); `src/lib/support-view.ts` the sessions, `support-view-decide.ts` the pure wall, `src/proxy.ts` the stamp.
- `src/app/api/webhooks/stripe/route.ts`, `src/lib/retainer-billing.ts` — the money loop's sources; `src/lib/platform-revenue.ts` the posting, the backfill, the retry; `platform-revenue-controls.tsx` the operator's two buttons.

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
- **The dev branch has no operator.** Slice 2's migration deleted its four
  test transcripts to pass the guard; naming one (a Yosher org on the
  development Clerk instance, then `db:operator-tenant -- <slug> --dev`) is
  the founder's, and the db-backed tests mint their own until then.
- **Platform email is down until Resend verifies `mail.yosherapp.com`.**
  Found by the slice-2 drive: the lead email was attempted and refused;
  enquiries and digests fail the same way. Nothing in the code.
- **The operator's default pipeline must exist before the first lead**, or
  the lead lands without a deal (by design — ADR 0042). The Board's first
  visit makes it; it exists on production now.
- **Drive residue in Yosher App's CRM**: *Yosher Drive Test Plumbing*, the
  person *Drive Test*, its discovery record and follow-up — delete on the
  founder's word.
- **A support render is not read-only at the database.** The wall is the
  request layer; a page that writes on load would write as staff. None does
  today (each was read). Making `withTenant` open a READ ONLY transaction
  for a support view needs the marker to reach it — the role unions are
  hand-written in fifty-six places — so it waits for a reason.
- **Clients cannot see their own support-access history.** `support_sessions`
  is superadmin-only. Showing a workspace who looked and why would be the
  honest thing; nobody has asked yet.
- **Sales tax on the platform's own invoices** is not applied (ADR 0043). SaaS
  in the operator's home state is a question for the accountant, and the
  invoice line is untaxed until it is answered.
- **Stripe's fee** is not recorded per charge; the payout the bank feed
  matches is net of it, so the difference lands where the feed codes it.
  A fee line per charge would need `balance_transaction` — one more Stripe
  read per posting — when somebody wants the gross/net split.
- **Retainer time as revenue or WIP**, and whether the client-facing meter
  becomes a projection of the pack's engagements — deferred (ADR 0041, Notes).
- **Yosher's own public site** is the `(marketing)` route group in code, not a
  Marketing-module site. Running it through the module would be the loudest
  dogfood of all; not in this plan.
- **A second operator** (white-label) — the revisit trigger in the ADR.
