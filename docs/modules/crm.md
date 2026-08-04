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
| `crm_party_details` | What CRM knows about a party — 1:1, created when CRM is first asked about the record | FORCE RLS with a **visibility term**: `visibility = 'members' OR app_current_tenant_role() = 'owner'`, in USING **and** WITH CHECK. `owner_clerk_user_id` is an attribution and grants nothing — see Decisions. `custom` jsonb is the slice 2 extension bag (P2), `lifecycle_stage`/`source` are open taxonomies (P1) with no CHECK. Composite FK to `parties`, ON DELETE CASCADE. Unique on `(tenant, party)` is what makes "the CRM record for this party" a lookup |
| `crm_affiliations` | A person's connection to an organization, current or former | **Inherits visibility** through a positive `EXISTS` against `crm_party_details` at both ends — no second copy of the flag, so no drift. The positive spelling is load-bearing; see Decisions. Two partial uniques: one current connection per pair, one primary per person. CHECK that the two ends differ |
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
week of shipping and would then have to be unpicked from every read site. So
this table commits to nothing: accounting keeps reading `customers.email`
completely unchanged, and `party_contact_points` / `party_addresses` arrive as a
later shared slice with the accounting read sites migrated as an explicit step.
**Do not add an email column here as a convenience.**

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

**A field's TYPE cannot be changed after creation.** Flipping `text` to `number`
would leave every stored value in a shape the new type rejects, so saves would
start failing on records nobody had touched. Archive and re-add instead: the old
values stay readable and the discontinuity is visible.

## Open items

- **Contact points and addresses are deferred, deliberately.**
  `party_contact_points` and `party_addresses` (typed, labelled, multi-value,
  with a primary) are the intended model. Until they land, the only contact data
  is on the accounting role rows and CRM must not add its own.
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
- **A6 was overridden deliberately.** The empty-slot rule says a module waits for
  a paying client to pull it in. The founder directed this build ahead of that on
  2026-08-03. Recorded here so a future session reads it as a decision rather
  than as precedent.
- **No dedup warning yet.** Nothing stops two records for the same company being
  created by hand. The cheap version — warn on a matching normalized email or
  phone at create time — needs contact points to exist first, so it lands with
  them rather than in slice 7's full merge tool.
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
- Slices 2–11 (custom fields, pipelines & deals, timeline & tasks, mail
  extension, explicit collaborators, dedup & merge, saved views, reporting,
  automation, AI) are planned and unbuilt.
