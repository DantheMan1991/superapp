# CRM

> The people and organizations a business deals with, the work in front of them,
> and every touch in between: contacts, companies, pipelines, deals, activity and
> follow-ups. Layer 1 — industry-blind. The trade-specific vocabulary a plumbing
> contractor or a dental practice sees comes from a Layer 2b profile, never from
> this module.
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

The module is `coming_soon` while its foundation ships. Slice 0 is a **platform**
change that adds no CRM surface at all — read "The party spine" below before
anything else, because it is the decision the whole module rests on and it
touches accounting's live AR/AP tables.

## Build log

### 2026-08-04 — Contact points: slice 0's deferral comes due (branch `claude/party-contact-points`)

The shared table `parties` deliberately did without. It arrives because two
features needed it, and it unblocks both in the same slice.

- `party_contact_points` — kind (`email`/`phone`/`website`), open-taxonomy
  label, the value **as typed**, and a `normalized_value` that matching
  compares. Multi-value, with one primary per party per kind.
- `src/lib/parties/contact-values.ts` is pure and owns normalization — 19 unit
  tests, no database.
- **CRM now implements `MailContactSource`**, the hook the seam's own header
  says it was designed for.
- **Duplicate warning at create time**, matching on normalized values. It warns
  and never blocks.
- Backfilled from `customers`/`vendors`; accounting writes now contribute
  contact points **additively** through the single door.
- Accounting's own columns are untouched and still authoritative for AR/AP.
  This is the expand phase, exactly as slice 0 was.

### 2026-08-04 — Slice 5: the mail extension (branch `claude/crm-mail-extension`)

CRM becomes the **third** filler of the mail extension seam, after Accounting
and Documents. **No migration** — this slice is code only.

- `src/modules/crm/mail/extension.ts` registers `contact`, `company` and `deal`
  as linkable entity types, with `search`, `resolve` and fixed
  `templateFields`. A thread can now be attached to a CRM record, which files
  the message into Documents and links it, and Mail's reverse view shows the
  record.
- **`contacts` is NOT implemented, and that is a consequence of slice 0.**
  `MailContactSource` needs an email per suggestion and `parties` has no email
  column; the addresses that exist are on `customers`/`vendors` and Accounting
  already offers them. See Open items.
- **Custom fields are not placeholders**, and cannot be without changing Mail's
  contract. Fixed fields only.
- `contact` and `company` read `parties` directly; `deal` reads `crm_deals` and
  therefore inherits record visibility for free. Both halves are tested.

### 2026-08-04 — Slice 4: activity and follow-ups (branch `claude/crm-timeline`)

- `crm_activities` (note / call / meeting, with `occurred_at` separate from
  `created_at`) and `crm_tasks` (optional due date, optional record, completion
  as a timestamp pair).
- A timeline on every record merging both, plus a module-level **Follow-ups**
  list grouped overdue / today / this week / later / someday.
- `core/timeline.ts` is pure — merge, ordering, and the calendar-day urgency
  rules — with 21 unit tests and no database.
- **Built for sources that do not exist yet.** `mergeTimeline` takes items, not
  tables, so slice 5's mail threads are a query and a mapping function.
- `crm_tasks` RLS **branches**: unattached tasks are tenant-scoped, attached
  ones inherit the record's visibility. See Decisions.

### 2026-08-04 — Slice 3: pipelines, deals, and stage history (branch `claude/crm-pipelines`)

- `crm_pipelines`, `crm_pipeline_stages`, `crm_deals`, `crm_deal_stage_events`,
  `crm_deal_parties`. Board, deal page, stage settings, and a deals panel on
  every record.
- **Won/lost is a property of the STAGE.** No `status` column on the deal, so
  the two cannot desync. `closed_at` is stored because it is a fact about time;
  `closedAtFor` stamps on first close, refuses to re-stamp a won→lost
  correction, and clears on reopen.
- **Stage history ships with a reader.** The deal page renders it from day one
  rather than leaving the table an unverified promise until slice 9.
- Deals inherit the party's visibility; stage events inherit through the deal.
- `money.ts` moved to `src/lib/` with a re-export shim — CRM needed cents and a
  module may not import another module.
- Default pipeline provisioned **lazily on first board visit**, so no backfill
  and no change to `toggleModule`.

### 2026-08-04 — Slice 2: custom fields (branch `claude/crm-custom-fields`)

Per-tenant fields on every record — the feature that makes this shapeable
rather than a fixed form, and the seam a Layer 2b profile fills with **data**
instead of code.

- `crm_field_defs` — key, label, one of seven types, options, `is_required`,
  sort order, `archived_at`. **Read by every member, written only by owners**
  (`0067`), because a definition is the shape of every record rather than a
  record.
- Values live in `crm_party_details.custom`, **keyed by definition id** rather
  than by `key`, so renaming a field rewrites one row instead of every record
  that ever held it.
- `core/custom-fields.ts` is pure and carries the whole integrity of that jsonb
  column — 27 unit tests, no database.
- **Required means required to change stage**, not to save. Required-on-create
  is how imports and lead capture stop being usable.
- Archiving never deletes: the write path merges rather than replaces, so a
  retired field's stored values survive every later save.
- Owner-only settings page at `/dashboard/m/crm/fields`; typed controls render
  on the record form from the definitions.

### 2026-08-04 — Slice 1: records, connections, and record visibility (branch `claude/crm-party-records`)

The module becomes `available`. First surface: the records list, a record page,
and the connections between people and companies.

- `crm_party_details` — 1:1 with a party, holding what CRM knows: assigned
  owner, lifecycle stage, source, notes, visibility, and the `custom` jsonb bag
  slice 2 fills. A party with no row here is one Accounting created and CRM has
  never been asked about, which is a normal state and not a gap to backfill.
- `crm_affiliations` — a person's connection to an organization, with a title
  and a date range. A join table rather than a column so a former employer
  survives the person changing jobs.
- **Record visibility, in RLS.** `members` (default) or `restricted`
  (tenant owners only), reusing `app_current_tenant_role()` from 0024.
  Affiliations INHERIT it rather than storing a second copy.
- The records list is a LEFT JOIN over every party, so a tenant who has been
  invoicing for months does not open CRM to an empty product.
- **0061's compatibility triggers are dropped** (`0065`). Every insert site now
  routes through `src/lib/parties/`, so the single door is true rather than
  merely claimed.
- `npm run db:seed -- --dev` gained a `--dev` flag mirroring `db:migrate`'s. A
  module seeded only on production is one nobody can look at before shipping.

### 2026-08-03 — Slice 0: the party spine (branch `claude/crm-party-spine`)

The identity table CRM and Accounting share, added with no CRM UI and no
behaviour change.

- `parties` — the shared spine. **Identity only**: kind, display name, structured
  person name, legal name, active flag, version. No email, no phone, no address
  (see Decisions — this absence is the design).
- `customers.party_id` and `vendors.party_id` — nullable, composite FK
  `(tenant_id, party_id) → parties (tenant_id, id)`.
- `src/lib/parties/` — the single door onto the table, outside `src/modules/`
  because two modules write it.
- Compatibility triggers on `customers`/`vendors` mint a party on insert while
  `party_id` is null, so the **currently running code keeps working** through the
  backfill window. Dropped by the contract migration.
- Backfill: exactly one party per existing role row. **No name matching, no
  automatic merging** — see Decisions.
- Contract migration: `NOT NULL`, `UNIQUE (tenant_id, party_id)` on both role
  tables, triggers dropped.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `parties` | The shared identity spine — one row per person or organization a tenant deals with | **Written by two modules**, so it lives at `src/lib/parties/` and not inside either. FORCE RLS, `member_all` policy scoped by `app_current_tenant()`: ordinary business data, ordinary tenant scoping. Composite unique `(tenant_id, id)` so every referencing FK can be tenant-aware. `kind` is `person` \| `organization`; `given_name`/`family_name` are NULL for organizations. `display_name` is authoritative, never derived — see Decisions |
| `customers.party_id` | The AR role's link to its party | Nullable → backfilled → `NOT NULL`. Composite FK. `UNIQUE (tenant_id, party_id)`: a party may hold the customer role at most once |
| `vendors.party_id` | The AP role's link to its party | Same shape. A party that is both customer and vendor holds two role rows, which is correct and is not a duplicate |
| `party_contact_points` | How to reach a party — **shared, not CRM's** | Tenant-scoped and member-writable like `parties`, NOT visibility-bearing: the same addresses are already on `customers.email` where staff read them, so hiding one copy while the other shows on the invoice screen would be two answers to one question. `normalized_value` is written only by `src/lib/parties/contacts.ts` and is what the duplicate check compares. Partial unique gives one primary per party **per kind**; `(tenant, party, kind, normalized)` unique stops the same address twice; `(tenant, kind, normalized)` indexes the duplicate lookup |
| `crm_party_details` | What CRM knows about a party — 1:1, created when CRM is first asked about the record | FORCE RLS with a **visibility term**: `visibility = 'members' OR app_current_tenant_role() = 'owner'`, in USING **and** WITH CHECK. `owner_clerk_user_id` is an attribution and grants nothing — see Decisions. `custom` jsonb is the slice 2 extension bag (P2), `lifecycle_stage`/`source` are open taxonomies (P1) with no CHECK. Composite FK to `parties`, ON DELETE CASCADE. Unique on `(tenant, party)` is what makes "the CRM record for this party" a lookup |
| `crm_affiliations` | A person's connection to an organization, current or former | **Inherits visibility** through a positive `EXISTS` against `crm_party_details` at both ends — no second copy of the flag, so no drift. The positive spelling is load-bearing; see Decisions. Two partial uniques: one current connection per pair, one primary per person. CHECK that the two ends differ |
| `crm_pipelines` / `crm_pipeline_stages` | The steps a deal moves through | **Configuration**: member-read + owner-write, same two-policy split as `crm_field_defs`. One default per tenant enforced by a partial unique. `outcome` (`open`/`won`/`lost`) is where terminal semantics live — there is no status column on the deal |
| `crm_deals` | One piece of work in front of a record | **Inherits the party's visibility** through a positive `EXISTS` against `crm_party_details`. `amount_cents` is NULLABLE on purpose — "not priced yet" and "worth nothing" are different facts and a forecast must not conflate them. `closed_at` denormalized from the history; `custom` holds slice 2's `entity_type = 'deal'` fields |
| `crm_deal_stage_events` | Append-only stage history | **Inherits through the deal** — a two-link chain. Member-writable because the same action that moves a deal records the move; nothing UPDATEs or DELETEs these rows, which is a code property in the same standing as `audit_log` being append-only by convention. No `version` column |
| `crm_deal_parties` | Additional stakeholders beyond the primary contact | Inherits through the deal. Unique on `(tenant, deal, party)` |
| `crm_activities` | What was said — a note, a call, a meeting | Inherits the party's visibility positively, like deals. `occurred_at` is separate from `created_at` so writing up Friday's visit on Monday reads as Friday. No `email` kind: Mail already holds those and two records of one conversation disagree the moment either is edited. **Deletable**, unlike everything else here — see Decisions |
| `crm_tasks` | A follow-up | **The policy BRANCHES**: `party_id IS NULL` is plain tenant-scoped, otherwise it inherits. Completion is a timestamp pair guarded by a CHECK — `completed_at` and `completed_by` are one fact and a row with half of it is uninterpretable. `due_on` is a DATE; follow-ups are due on a day |
| `crm_field_defs` | Per-tenant custom field definitions | **Read/write split, not a visibility term**: a `FOR SELECT` member-read policy plus a `FOR ALL` owner-write policy. Two policies because **WITH CHECK is not consulted for DELETE** — a single `FOR ALL` with a permissive USING would let staff delete every definition in the tenant. `entity_type` is an open taxonomy (P1) so slice 3's deals need no migration. Key format enforced by CHECK; the `(tenant, entity_type, key)` unique is **partial on `archived_at is null`**, so archiving frees the name |

Migrations: `0059` (tables/columns), `0060_parties_rls.sql` (custom: policies),
`0061_parties_compat.sql` (custom: the compatibility triggers),
`0062_parties_contract.sql` (custom: NOT NULL, uniques, triggers dropped).

## Key files & seams

- `src/lib/parties/` — the platform subsystem. `create`, `update`, `load`,
  version enforcement, and the normalization rules. Takes the caller's `tx`;
  never opens its own scope and never `withSystem`. **Deliberately has no
  `requireModuleEnabled` call** — it serves tenants who bought Accounting and
  not CRM. `names.ts` is pure and free of `server-only`, so the normalization
  rules are tested without a database (`tests/parties.test.ts`).
- `src/lib/parties/role-sync.ts` — the "both names exist" bridge while
  `customers.name` and `parties.display_name` are both stored. Temporary by
  design; the header says what has to move before it goes.
- `src/modules/accounting/invoicing/customers.ts` and `payables/vendors.ts` —
  create paths route through the service so a role row and its party are born in
  one transaction; a rename carries onto the party.
- `src/modules/crm/party-ops.ts` — CRM's operations. Never writes `parties`
  itself; identity goes through the shared service and CRM's own tables are
  written here.
- `src/modules/crm/actions.ts` — every `withTenant` passes `{ role: ctx.role }`
  without exception, because `crm_party_details` is visibility-bearing.
- `src/modules/crm/CrmModule.tsx` — the records list, and it IS the module home
  rather than an overview linking to one.
- Routes: `/dashboard/m/crm`, `/dashboard/m/crm/records/new`,
  `/dashboard/m/crm/records/[partyId]`.

## Decisions & gotchas

**The spine is shared, not CRM-owned, and the constraint that forced it is
entitlement.** A tenant can buy Accounting without CRM, so accounting can never
FK into a `crm_*` table — but two customer lists is the failure this module
exists to prevent. `documents` already solved this shape once: one table, two
surfaces, `origin` discriminating. `parties` is the same answer, and it lives in
`src/lib/` for the reason `eslint.config.mjs` states — genuinely shared code
moves there rather than being imported across a module boundary.

**`customers` and `vendors` become role records, and no existing foreign key
moved.** `invoices.customer_id` and `bills.vendor_id` still point exactly where
they pointed. The alternative — promoting `customers` into a universal entity —
would have relocated live AR foreign keys for no gain the role model does not
already give.

**`parties` carries NO contact information, and that absence is the design.** A
company has several offices, billing addresses and numbers; a person has a work
address and a personal one. A single `parties.email` would be canonical within a
week of shipping and would then have to be unpicked from every read site.
**Do not add an email column here as a convenience** — `party_contact_points`
is the answer, and it arrived on 2026-08-04.

**CONTACT VALUES ARE STORED TWICE, AS TYPED AND AS MATCHABLE.**
`Bob@Example.COM ` and `bob@example.com` are one address; `(555) 123-4567` and
`+1 555 123 4567` are one phone. The person sees what they typed and the machine
compares something that can actually be compared. `normalizeContactValue` is the
only place that computes the matchable form — normalizing at each call site
would be the same class of mistake as formatting money in two places, and the
symptom is not an error but the duplicate check quietly finding nothing. The
backfill migration (0074) mirrors those rules in SQL with the correspondence
written out line by line; **if you change one, change the other in the same
commit.**

**Accounting's contact sync is ADDITIVE, unlike the name sync.** A name is one
fact and the role's copy is authoritative, so a rename overwrites. A way of
reaching somebody is one of several, so an accounting edit contributes an
address and never removes one. The concrete failure that rules out mirroring:
somebody clears `customers.email` because the invoice should go elsewhere, and a
mirroring sync silently deletes the mobile a colleague added in CRM last week.

**The composer now offers a customer's address twice**, once from Accounting's
column and once from the contact point backfilled from it. Both carry a sublabel
saying where they came from. That is accepted rather than missed — the fix is the
contract slice that retires the accounting columns, not a filter guessing which
copy to suppress.

**The duplicate check warns and never blocks.** Two people at one company
genuinely share `info@`, and a product that refuses the second record teaches
its users to add a full stop to get past it. Same line the merge tool and the AI
slices sit on: the machine suggests, a person commits.

**`display_name` is authoritative, not derived.** Deriving it from
`given_name`/`family_name` means a fight the first time somebody wants
"Bob Smith Plumbing" rather than "Robert Smith". The structured names exist
alongside it because a mail template saying "Dear Aoife" needs a real first
name, and it needs one with CRM switched off — which is why they are on the
shared spine rather than in CRM's own table.

**The backfill creates one party per role row and matches nothing.** A customer
named "Probe Construction" and a vendor named "Probe Construction" are left as
two parties. Fusing them on a name match would silently merge two real
businesses inside a live tenant's books, with the evidence gone by the time
anybody noticed. Slice 7's merge tool proposes candidates to a human on stronger
evidence than a string compare.

**The compatibility triggers are what make the migration converge.** Between
adding `party_id` and enforcing it, the deployed code is still inserting
customers with no party — this repo migrates a live database *ahead* of the
deploy (the 0023/0025 outage lesson in `documents.md`), so a backfill alone
never reaches a stable finish line. A trigger covers the running code with no
deploy at all, and drops in the contract migration. Triggers as structural
backstops are precedented here: the deferrable balanced-entry trigger and the
append-only `audit_log` trigger.

**Tenant-aware composite FKs everywhere**, as every relation in this schema
already does — `(tenant_id, party_id)` referencing `(tenant_id, id)`, so a
cross-tenant reference is structurally impossible rather than merely refused by
a predicate somebody has to remember.

**The single door is review-enforced, not lint-enforced.** `@/db/schema` is
deliberately unrestricted by the module-isolation zones, because tables are the
platform's. So nothing mechanically stops a module writing `parties` directly;
`src/lib/parties/` is the only supported writer by convention, the same way
`setDocumentTags` is "the single door" onto `documents.tags`. If that convention
starts slipping, the fix is a lint rule, not a comment.

**Never call an organization an "Account."** `accounts` is the chart of
accounts. That collision would be permanent and unfixable by rename.

**"Owner" means two things, and they are kept structurally apart.**
`crm_party_details.owner_clerk_user_id` is the person a record is ASSIGNED to —
an attribution that grants nothing. `app.tenant_role = 'owner'` is the
business's owner, and it is the only thing visibility consults. A rep does not
see a restricted record because their name is on it, and a colleague does not
lose an ordinary one because it is not. The visibility enum is spelled
`restricted` rather than Documents' `owners` for exactly this reason: a value
called `owners` would read as "the rep who owns it". One inconsistent word is
cheaper than the collision.

**Affiliation visibility must be inherited POSITIVELY, and the negative
spelling fails open.** The obvious policy is "hide this row if either endpoint
is restricted" — `NOT EXISTS (… WHERE visibility = 'restricted')`. That is
backwards, because **RLS applies inside policy subqueries**: a staff member
cannot see the restricted row, so the inner query finds nothing, so `NOT EXISTS`
is true, so the connection is shown to precisely the person it was hidden from.
Stated positively — visible only if BOTH endpoints resolve to a
`crm_party_details` row the caller can see — the same mechanism works for us,
and the policy never mentions `restricted` at all. Same trick
`document_versions` uses. There is a test for both directions.

**`restricted` hides what CRM knows, not that the business deals with
somebody.** The party stays visible to staff, because the identity is shared
with Accounting where the same person can already see it as a customer. Hiding
it outright would mean a visibility term on `parties`, which would hide
customers from accounting staff. The record page says this in words rather than
leaving a blank panel.

**A restricted record and a never-worked one look identical to staff**, on
purpose — `details` is null in both cases. Distinguishing them would turn the
list into a way to discover which records are restricted, which is the same
probe the mail template values are designed to refuse.

**Custom field values are keyed by definition ID, not by `key`.** This is
deliberately the OPPOSITE choice from `document_tags`, where the slug is
immutable and `documents.tags` stores slugs — and the difference is who types
the string. A tag is a label somebody picks from a list; a custom field key is
closer to a column name, invented once under time pressure and regretted later.
Keying by id means correcting a typo rewrites one definition row instead of
every record that ever held the field. The cost is that `custom` is unreadable
without joining to `crm_field_defs`, which is a fair price for a rename that
cannot lose data.

**`WITH CHECK` IS NOT CONSULTED FOR `DELETE`.** The tempting shape for an
owner-writable table is one `FOR ALL` policy with a permissive `USING` and a
role test only in `WITH CHECK`. That leaves a silent hole: staff could delete
every row while being unable to create one. `crm_field_defs` therefore splits
into a `FOR SELECT` read policy and a `FOR ALL` write policy whose **USING**
clause carries the role test. There is a test that deletes as staff and asserts
zero rows.

**Required means required to CHANGE STAGE, not to save.** A half-known record is
the normal state the moment somebody first types a name, and a form that refuses
it just moves the record into a spreadsheet. The check runs when
`lifecycle_stage` actually changes — compared against the stored value, never
asserted by the caller — which is the point at which the business commits to
something. Imports and quick captures stay usable.

**Archiving a field is not deleting it, and the write path is what makes that
true.** Stored values are keyed by definition id, so a hard delete would turn
every one of them into a number nobody can interpret. Archived definitions are
excluded from `listFieldDefs`, which means `sanitizeCustomValues` treats their
values as unknown and drops them from the *validated payload* — so
`mergeCustomValues` folds the payload onto what is stored rather than replacing
it. A straight replace would silently delete a retired field's values on the
next unrelated save, which is exactly what archiving was meant to prevent.

**`moveDealStage` is the only path that may change `stage_id`**, because it is
the only one that writes a `crm_deal_stage_events` row. A stray
`update(crmDeals).set({ stageId })` anywhere else would move the card and lose
the fact that it moved — and unlike almost every other bug in this module, that
one cannot be repaired afterwards. `updateDeal` deliberately does not accept a
stage.

**A DRIZZLE MIGRATION THAT CREATES A PARENT AND CHILD TOGETHER NEEDS ITS
STATEMENT ORDER HAND-EDITED.** drizzle-kit emits every `ADD CONSTRAINT` before
every `CREATE INDEX`. That is fine whenever a composite FK points at a table
from an earlier migration — every CRM migration before 0068 got away with it —
but `crm_deal_parties` references `crm_deals (tenant_id, id)` whose backing
unique index was still forty lines below, and Postgres refused with `42830,
there is no unique constraint matching given keys`. 0068 hoists the three
`(tenant_id, id)` uniques above the foreign keys. **Expect to do this again.**
The failure is loud rather than subtle, and drizzle wraps each file in a
transaction, so the database rolled back cleanly.

**A SERVER COMPONENT MAY IMPORT COMPONENTS FROM A `"use client"` MODULE, NEVER
PLAIN VALUES.** `centsToInput` started in `components/deal-form.tsx` and was
called from the deal page. Every export of a client module becomes a client
*reference*, so the call threw at render and production withheld the message —
while `npm run build`, `tsc` and `eslint` all stayed green, because the import
is legal and only the call is not. It reached production and took the deal page
down; nothing but opening the page could have caught it. `centsToInput` and
`EMPTY_RECORD` now live in `core/`, and the rule is in
[conventions.md §8](../conventions.md).

**THE MAIL PICKER OFFERS A RESTRICTED RECORD'S NAME BUT NOT ITS DEALS**, and
the asymmetry is deliberate rather than an oversight — pin it before "fixing"
either half. `contact` and `company` read `parties` directly, so a restricted
record's name appears exactly as it does in the records list; the identity is
shared with Accounting where the same staff member already sees it. `deal`
reads `crm_deals`, which inherits the record's visibility, so a restricted
account's deals are absent — and no predicate in the extension says so. It falls
out of using the caller's transaction, which is invariant S12 working as
designed. There is a test for both halves.

**An unattached task's `IS NULL` branch is not a hole**, and a reviewer's first
instinct is that it should be. `crm_tasks.party_id` is nullable because "ring
the accountant back" is a real task belonging to nobody in the CRM, and a
product that refuses to hold it sends that task to a sticky note. An unattached
task names no record, so there is no restricted thing to leak; its title is the
author's own words about their own work. The moment somebody attaches it, the
inheritance branch takes over — including on UPDATE, because WITH CHECK carries
the same test, so staff cannot attach a task to a record they cannot see.

**Tasks are deliberately NOT scoped to their assignee.** A follow-up is the
business's work, not private correspondence, and whoever covers for somebody on
holiday has to see what is outstanding. `app.clerk_user_id` exists and six mail
tables use it; its absence here is a decision.

**Activity is the one deletable thing in this module.** Everything else
archives. An activity is the only table holding unstructured prose about
another person — "rude on the phone, would not budge" is a note whose author may
reasonably want it gone, and leaving it readable while pretending otherwise
would be worse. Nothing references an activity, so removing one dangles nothing.

**Calendar-day comparisons are done on yyyy-mm-dd STRINGS, never Dates.**
"Is this overdue" is a question about days in the user's timezone; comparing a
`date` column against a server `Date` is wrong by up to a day for anybody not on
UTC, which surfaces as the product nagging about something due tomorrow. The
per-row badge is computed in the BROWSER; the Follow-ups page groups on the
server's today and says so — properly fixing that needs a tenant timezone in a
shared setting, because `accounting_settings` holds one and CRM may not read it.

**The board moves deals with a MENU, not drag and drop.** conventions §8 says a
real share of usage is one-handed, in the field, on a phone, and dragging a card
between columns that do not fit the screen is the one board interaction with no
good touch story. A menu also names every destination.

**A field's TYPE cannot be changed after creation.** Flipping `text` to `number`
would leave every stored value in a shape the new type rejects, so saves would
start failing on records nobody had touched. Archive and re-add instead: the old
values stay readable and the discontinuity is visible.

## Open items

- **`party_addresses` is still deferred, and now deliberately rather than by
  omission.** Contact points landed because two features needed them; nothing
  reads a postal address that `customers.address` does not already serve, and
  adding a table with no reader is the speculative build this codebase avoids.
  The shape is the same as contact points when it is wanted.
- **The accounting columns have NOT been retired.** `customers.email` /
  `.phone` still exist, are still authoritative for AR/AP, and are still read by
  the invoice paths and Accounting's own mail extension. This is the expand
  phase; the contract slice retires them and is what removes the duplicate
  suggestion in the composer. Only two files read those columns directly, so it
  is a small change when somebody wants it.
- **Custom fields cannot become mail placeholders without changing Mail's
  contract.** `MailEntityType.templateFields` is a static array on purpose —
  its header says the vocabulary must be knowable without reading data, which is
  what keeps the placeholder enumeration closed. Per-tenant custom field
  definitions cannot satisfy that without turning `templateFields` into a
  function taking `(tx, ctx)`. The CRM mail extension therefore exposes fixed
  fields only, and reopening that enumeration is Mail's decision to make on its
  own merits.
- **Cross-linking accounting's customer list to a CRM record needs P5.**
  Accounting cannot import CRM. A record-link extension point is the sanctioned
  route; ADR 0004 already predicted nav contribution would force one.
- **`Probe Construction` is still in two files this module did not touch** —
  `src/lib/mail-extensions/types.ts` and `src/lib/email/jmap/types.ts`, both as
  comment examples. Worth knowing because CRM's own placeholders picked the name
  up from them by reading nearby code, which is the propagation mechanism
  [extension-model.md §8](../extension-model.md) describes rather than a
  coincidence. Rewrite them opportunistically when next in those files.
- **A6 was overridden deliberately.** The empty-slot rule says a module waits for
  a paying client to pull it in. The founder directed this build ahead of that on
  2026-08-03. Recorded here so a future session reads it as a decision rather
  than as precedent.
- **The duplicate warning covers contact points, not names.** Two records for
  the same company with no shared address are still invisible to it; that is
  slice 7's merge tool, matching on stronger evidence than a string compare.
- **The warning only fires where a contact point is entered**, which is the
  record page. Creating a record from the "Add a record" form does not ask for
  an address, so nothing is checked there.
- **The records list caps at 500** with a line saying so, and there is no paging
  or cursor. Fine at current scale; slice 8's saved views is where this gets
  solved properly rather than by raising the number.
- **Custom fields are not filterable or searchable.** Nothing indexes `custom`,
  and the records list does not offer them as facets. Deliberate for now —
  arbitrary jsonb filtering gets expensive fast, and the right shape is an
  intentional expression index per field somebody actually filters on, decided
  with slice 8's saved views rather than guessed at now.
- **No field is classified as sensitive.** A custom field can hold anything a
  tenant types, including C4 PII, and it inherits only the record's visibility.
  A per-field restriction is a real gap once somebody puts a national insurance
  number in one.
- **Field definitions cannot be reordered from the UI.** `reorderFieldDefsAction`
  exists and works; nothing calls it yet, so new fields land at the bottom.
- **A profile cannot yet seed field definitions idempotently.** `key` is
  renameable, so a Layer 2b installer upserting on it would duplicate a field a
  tenant had renamed. That needs an ownership marker on the row, and it should
  be designed with the first real profile rather than guessed at now.
- **Affiliations assume person→organization.** The kinds are checked in
  `party-ops.ts` rather than by a constraint, because the constraint would have
  to reach into another table and because a sole trader is a real edge. A
  company-to-company relationship (parent, subsidiary, joint venture) is a
  different shape and is not modelled.
- **No `updated_at` trigger anywhere in CRM** — the ops layer sets it. Consistent
  with the rest of the schema, and worth knowing before writing a raw UPDATE.
- **Deals have no per-deal probability override** — the weight comes from the
  stage. A real want, but it is one more number to keep honest and slice 9 can
  add it once a report argues for it.
- **No currency column.** Single-currency platform; a second one is a change to
  `@/lib/money` before it is a change here.
- **Stage reordering has no UI.** `reorderStagesAction` exists and works;
  nothing calls it, so new stages land at the end.
- **A deal cannot be moved between pipelines**, and `moveDealStage` refuses it
  explicitly rather than leaving a card on a board that does not draw its
  column.
- **`crm_deal_parties` has no add/remove UI** — the deal page lists
  stakeholders, and the actions exist, but nothing creates one yet.
- **THE TIMELINE STILL HAS NO MAIL IN IT, and slice 5 did not fix that.**
  Registering the entity types was the prerequisite and is done — a thread can
  now be attached to a record — but showing those threads *on the CRM timeline*
  needs the reverse read, and that is a design question rather than a query.
  "Emails on this record" is two hops through `mail_links` plus resolving the
  filed copy through the Documents extension, and all of that lives in
  `src/modules/email/links.ts` and the registry, neither of which CRM may
  import. Reimplementing the hops here would duplicate behaviour Mail owns,
  including the `is not distinct from` subtlety that keeps a disconnected
  mailbox's links alive. The real answer is either moving the reverse read into
  a shared seam or Mail declaring a timeline-contribution extension point —
  P5 again, pointing the other way. `mergeTimeline` takes items rather than
  tables so that whichever wins is a mapping function here.
- **CRM contributes no recipients to the composer.** `MailContactSource`
  requires an email per suggestion and `parties` has none by design (slice 0).
  Accounting already offers the addresses that exist, on `customers`/`vendors`,
  so contributing them again would list the same person twice. CRM implements
  the hook the day parties have contact points of their own — the same later
  slice that unblocks dedup warnings.
- **The Follow-ups page groups against the SERVER's today**, so a tenant far
  from UTC sees a task change group a few hours early or late. The per-row badge
  is computed in the browser and is correct. A real fix needs a tenant timezone
  somewhere CRM may read.
- **An activity attaches to exactly one party**, plus optionally one deal. A
  meeting with three people from the same company is currently three entries or
  one filed against the company. Multi-attendee activity is a real want with no
  UI demand yet.
- **Tasks have no assignee picker** — the column exists and the ops honour it,
  but nothing sets it, so everything is unassigned.
- **No reminders or notifications.** An overdue follow-up is visible only to
  somebody who opens the page.
- Slices 5–11 (mail extension, explicit collaborators, dedup & merge, saved
  views, reporting, automation, AI) are planned and unbuilt.
