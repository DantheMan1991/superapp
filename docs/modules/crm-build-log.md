# CRM — build log archive

> Older build-log entries for the CRM module, moved out of
> [`crm`](./crm) so the dossier stays readable. Nothing here is
> superseded — it is the record of how the module got built. The dossier
> itself carries the recent entries, the data model and the current state.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

### 2026-08-05 — Follow-ups group against the business's today (branch `claude/tenant-timezone`)
- The Follow-ups page and CRM automation both stop using the server's clock. `tenants.timezone` (`0086`) is the platform-level setting the old comment in `tasks/page.tsx` said it was waiting for — see [timezone.md](timezone.md)
- Automation's "due in N days" now counts from the tenant's today. A rule firing at 9pm in Denver used to date its follow-up from tomorrow's UTC date and land a day early
- `dueBucket()` needed no change: it always took `today` as a `yyyy-mm-dd` string, which was the point of that design

### 2026-08-05 — Slice 10: automation (branch `claude/crm-automation`)

"When this happens, do that." `crm_automation_rules` (`0082`/`0083`), five
triggers, three actions, and an engine that runs inside the transaction that
fired it.

- **A rule runs as the person who triggered it**, synchronously, with their
  role. So it can never do something they could not — and automation needed no
  permission model at all. Tested: staff triggering a rule against a restricted
  record applies nothing.
- **A savepoint per rule.** A broken rule must not roll back somebody's own
  work, and catching the exception in TypeScript is not enough because Postgres
  aborts the whole transaction. Tested by breaking a rule on purpose and then
  writing in the same transaction.
- **One hop, never a cascade.** Actions write tables directly and never call
  back into a triggering path, so a loop is unrepresentable rather than merely
  unlikely.
- **`parseRule` returns null rather than a degraded rule** — the opposite of
  `parseFilter`, and the reason is in Decisions.
- Readable by every member, writable by owners. Nothing sends anything.

### 2026-08-05 — Saved reports (branch `claude/crm-saved-reports`)

Slice 9's one named gap, closed. `crm_reports` (`0080`/`0081`) — a report can be
kept by name and shared with the team.

- **Deliberately the same four policies as `crm_saved_views`**, because a report
  and a view are the same kind of thing: a saved question whose answer is
  computed in the reader's own transaction. If one table's policies change,
  change the other or write down why they diverged.
- **`definition` is ONE jsonb column, not four.** `parseDefinition` already
  validates the whole shape on every read; splitting it would mean four things
  to validate separately and a fifth state where they disagree.
- **The name is the question, by convention rather than by CHECK.** Every
  built-in ends in a question mark and a test enforces that for them, but
  refusing to save "Q3 pipeline" for want of punctuation would be a product
  telling its user how to write.
- `resolveReport` returns **null rather than falling back**, unlike a view pin —
  a report id in a URL is a specific thing somebody asked for, and quietly
  answering a different question would be worse than a 404.
- 6 more database tests: private stays private, a colleague cannot edit a shared
  one, a tenant owner can delete it, and a stored definition still runs.

### 2026-08-05 — Slice 9: reporting (branch `claude/crm-reporting`)

Five declared report types, four built-in reports, and a report page whose every
control is a link. **No migration in this slice** — the engine is code and URLs.
Saved reports followed immediately after; see the entry above.

- **The report TYPE is the design.** A report picks one of five declared join
  shapes, each a hand-written base query. That is the join-level version of the
  column whitelist slice 8 built: `views.ts` decides which columns a filter may
  name, `reports.ts` decides which joins a report may reach across.
- **Aggregation happens in Postgres.** The pure module sums nothing.
- **RLS does the access control**, and there is a test: over one definition an
  owner totals 10,750,000 and staff 1,750,000, because the restricted record's
  deal is not theirs to count.
- **Nulls are kept and labelled** — "not set" is usually the actionable line,
  and dropping it would make the groups fail to add up to the total above them.
- Every built-in is **named as a question**, taken from the Salesforce org where
  all fifty-nine are.
- `FILTER_FIELDS` became a default rather than the only registry, so slice 8's
  compiler serves both. Its 32 tests passed untouched.

### 2026-08-05 — Slice 8: saved views, and the end of the 500 cap (branch `claude/crm-saved-views`)

The list stops being one fixed question. `crm_saved_views` + `crm_view_pins`
(`0078`/`0079`), a pure rules module, a filter compiler, and real pagination.

- **`core/views.ts` is a whitelist first and a rules module second.** A stored
  condition names a field KEY; the registry maps it to a column, so a column
  name cannot arrive from outside the codebase. Values are always bound — there
  is a test filtering on a literal `%` that asserts it matches nothing.
- **A dropped condition widens, never narrows**, which is safe only because RLS
  decides what the caller may see. A filter is a convenience over rows already
  permitted, and that is what makes a shared view shareable unaudited.
- **Built-in views are code, not seeded rows** — four of them, the same for
  every tenant.
- **Explore first, name it later.** Filters live in the URL and apply
  immediately; "Save as view" appears only once the list differs from the view
  it came from.
- **The 500-row cap is gone**, replaced by pages and a real count.
- Shaped after an afternoon in a Salesforce org (2026-08-05). What was worth
  taking and what was not is in Decisions.

### 2026-08-04 — Slice 6: explicit collaborators (branch `claude/crm-collaborators`)

`restricted` meant "tenant owners only" and nothing in between. The commonest
real want — "this is confidential, but the two people working it need it" —
could only be said by making the record visible to everybody.

- `crm_record_collaborators` (`0076`) + policies and the details-policy change
  (`0077`). A grant names a person and records who granted it.
- **This spends 0064's promise that the details policy reads no other table**,
  and it can only be spent once. See Decisions — the collaborators policy must
  never read `crm_party_details` back.
- **Deals, activities, tasks and affiliations inherit the grant for free**, and
  none of those four policies changed.
- **Every CRM transaction now passes `userId`**, because the policy consults
  `app_current_user()` and a missing one silently denies a collaborator.
- Owner-only to grant or revoke, both audited. Five RLS tests certify it,
  including that staff can neither self-grant nor DELETE a grant.
- The merge tool was taught about the new table in the same branch — without
  it, merging would have silently revoked everyone's access.

### 2026-08-04 — Slice 7: dedup & merge (branch `claude/crm-merge`)

The tool three earlier slices deferred to. **No migration** — merging is code
over the tables that already exist, and adding a `crm_party_merges` table would
be a second store for what `audit_log` already holds.

- `core/merge.ts` is pure and decides everything: candidates, contested fields,
  and the four unique indexes a merge has to step around. 33 unit tests.
- **The plan is the product.** `buildMergePlan` returns a complete description;
  the preview RENDERS it and `applyMerge` re-derives and APPLIES the same one.
  No second code path computes "what would happen".
- **The absorb re-points posted invoices** onto the surviving customer row when
  both records hold the role — authorised by the founder on 2026-08-04. See
  Decisions for why the ledger is untouched by it.
- Owner-only in full, including the listing. Every merge writes an audit row
  carrying both names and the counts, because nothing else survives it.
- `/dashboard/m/crm/duplicates`, linked from the module home.
- 8 database tests on the executor, plus a cross-tenant refusal in the
  isolation suite.

### 2026-08-04 — The contract step: the accounting columns are gone (branch `claude/party-contact-points`)

`customers.email`, `customers.phone` and the vendor pair were dropped (`0075`).
`party_contact_points` is now the only place an email or a phone is stored, and
the expand/deploy/contract sequence that began with `parties` itself is finished
for contacts.

- **The accounting forms did not lose their Email and Phone boxes.** The box
  shows `preferredContact(points, kind)` and `setPreferredContactValue` writes
  back to that same row — neither dialog component changed, because the pages
  that feed them now read the party instead of the column.
- **The additive rule went with the column it was protecting.** Clearing the box
  now deletes that address. See Decisions — this is the reversal that the
  contract step is *for*, not a regression against it.
- Read sites moved: the customers page, the vendors page, the mail extension
  (search, resolve, `{{customer.email}}`, contact source) and the two halves of
  the books export. **Five** files, not the two the previous entry predicted.
- **`0075` MUST BE APPLIED AFTER THE DEPLOY**, the only migration here that
  inverts the standing order. It carries a catch-up backfill for addresses typed
  into the old form after `0074` ran, and refuses to drop anything if a usable
  address is not already a contact point.
- The composer "duplicate" this slice was supposed to fix **never existed**:
  `rankContacts` already deduped by address. What the overlap actually decided
  was the sublabel. Corrected below, and pinned by a test.

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
