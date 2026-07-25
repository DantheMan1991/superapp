# Documents

> The filing cabinet for the whole business — office, field and shop floor.
> Folders, uploads, versions, tags and search over every file the business
> runs on, with owner-only areas for the things the crew should not see.
> Industry layers (construction drawings with mark-ups and measurements) bolt
> on later through the pack seam without touching the core.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-07-25 — External share links (branch `claude/documents-shares`)

Tokenised, expiring links that let a client, subcontractor or inspector open a
file or a job folder with no login: `/s/<token>`. Three tables (`0028`/`0029`),
a public page and stream route, a management page, and `robots.ts`.

**The v1 restriction that shapes the whole design: a share root must be visible
to all members.** Owners-only content cannot be shared externally at all. That
is not just a policy choice — it is what lets the public route run `withTenant`
at role `staff`, so *RLS itself* prunes restricted content out of every share
and the pure scope function is a second layer rather than the only one. It also
matches intent: a folder someone deliberately hid from their own staff should
not be reachable by a stranger with a URL.

The token is never stored. `token_hash` (keyed HMAC) is the lookup key and
`token_ciphertext` (AES-GCM) exists so an owner can copy the URL again — an
audited reveal rather than a plaintext column. Both keys live in the
environment, so a database-only compromise yields no working links.

New env var **`SHARE_SECRET`** (fail-closed), with labelled derivation for
token hashing, IP hashing and unlock-cookie signing — one secret to set and
rotate instead of three. Rotating it invalidates every outstanding link, which
is the deliberate emergency lever.

### 2026-07-25 — Search, trash view, rename (branch `claude/documents-search`)

Full-text search over the cabinet: a generated `search_tsv` STORED column
(`0026`) with a GIN index, queried through `websearch_to_tsquery` so users get
quoted phrases, `or` and `-exclusion` for free and malformed input never
raises. Search box lives in the module nav, so it is reachable from every page;
the query lives in the URL so a result set is linkable.

`0027` fixes tokenization found by the tests: Postgres' parser treats
`acmewidgets.pdf` and `dan@example.com` as SINGLE lexemes, so the distinctive
part of a filename or an email local part matched nothing. `translate()` now
splits `-_.` in `file_name` and `@.` in `email_from`. Worth knowing because the
index *looked* fine — "invoice" matched `2026-invoice_acme.pdf` — and only the
part anyone would actually type silently missed.

Also closed two gaps from the previous session's open items: a **trash view**
(restore already existed but nothing listed trashed files) and a **rename**
dialog wired to `updateDocumentAction`. Folder-path label building was
extracted to `lib/folder-labels.ts` after a third copy appeared.

A nice emergent property: the accounting AI extraction's `vendorName` is
indexed at weight B, so searching "fulton lumber" finds a receipt whose
filename is `Invoice 3000 (1).pdf`.

### 2026-07-24 — Core cabinet: folders, visibility, upload (PRs 1–3, branch `claude/documents-core`)

Three commits, each independently shippable.

**PR1 (`ff4fb7b`) — schema, RLS role dimension, module wiring.** Built ON the
existing `documents` table rather than forking a second file record; the table
was designed for this in accounting session 5 and already carried the
`(tenant_id, id)` unique that child tables need. Added `documents.origin` as
the discriminator between the two surfaces, five new tables, and the
`app.tenant_role` GUC that lets an RLS policy tell owners from staff. Flipped
the seeded module row to `available`, registered the renderer, added
provisioning.

**PR2 (`bb89ba7`) — folders, browse, and the visibility gate made real.**
Folder CRUD/move/visibility, `recomputeVisibility`, `verifyDocumentInvariants`,
the browse UI with breadcrumbs and keyset paging — plus the one-line change to
the accounting file route that makes PR1's policy do anything (see Decisions).

**PR3 (`f373691`) — upload, Inbox, generic routes, accounting origin filters.**
Presigned client-direct upload into `docs/{tenant}/files/`, the authenticated
streaming route, the shared `streamBlobResponse` helper, and the five
accounting queries that had to become origin-aware — `close.ts` first.

**Follow-up (`0025_documents_origin_default.sql`) — live outage fix.** 0023
dropped `documents.origin`'s database default in the same migration that added
it. Because migrations run against the live database before the new code
deploys, receipt uploads and inbound email ingestion failed with a not-null
violation for about an hour. The default is restored and must stay; see
Decisions.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `documents` (shared) | The generic file record, now carrying DMS columns | `origin` discriminates `accounting`/`dms`; required in `$inferInsert` via `schema.ts`, and DB-defaulted to `'accounting'` so pre-Documents writers keep working (see Decisions). `member_all` policy compares `effective_visibility` against `app_current_tenant_role()`. **No new UNIQUE index may be added** — see Decisions |
| `document_folders` | The tree | Adjacency list (`parent_id`, source of truth) **+** materialized `path`. Self composite FK, NO ACTION. Two partial name uniques (root and non-root). `text_pattern_ops` prefix index, hand-written in 0024. Same visibility policy as `documents` |
| `document_versions` | File revision history | Partial unique on `is_current` makes "exactly one current" a DB invariant. `blob_pathname` index is deliberately NOT unique (a restore reuses a blob). Inherits visibility via an `EXISTS` subquery — no third copy of the flag |
| `document_tags` | Tenant tag registry | `documents.tags text[]` stores slugs from here, so a rename never rewrites documents. Slug format enforced by CHECK |
| `document_saved_views` | Saved filters | `query` jsonb is stored USER INPUT that becomes a WHERE clause — must be re-parsed with Zod on read |
| `document_settings` | Per-tenant module knobs | `member_read` only (platform-governed). E-sign/AI columns created now, unused, so later phases need no migration |
| `document_shares` | Anonymous link grants | `token_hash` GLOBALLY unique (the public lookup has no tenant to scope by). XOR document/folder scope. `expires_at` NOT NULL — no permanent anonymous links. `created_root_visibility` snapshot drives self-suspension |
| `document_share_events` | Per-link access log | `member_read` ONLY — evidence in a dispute, so members read it and only `recordShareEvent` (withSystem) writes it |
| `public_access_attempts` | Anonymous probe counters | **No `tenant_id` at all.** An attacker guessing tokens is nobody's data, and attributing that traffic to whichever tenant they hit would be wrong. Superadmin-only |

Migrations: `drizzle/0023_documents_dms.sql` (+ two hand edits, see Decisions)
and `drizzle/0024_documents_dms_rls.sql` (custom: the role function, the
replaced `documents` policy, policies for the five new tables).

## Key files & seams

- `src/modules/documents/core/` — pure, DB-free, unit-tested: `tree.ts`
  (paths, cycles, `computeEffectiveVisibility`), `tags.ts`, `paging.ts`,
  `errors.ts`, `integrity.ts` (drift detector).
- `src/modules/documents/folder-ops.ts` — folder mutations + `recomputeVisibility`.
- `src/modules/documents/actions.ts` (folders) and `document-actions.ts` (files).
- `src/modules/documents/ingest.ts`, `allowlist.ts` — upload verification.
- `src/modules/documents/search.ts` — raw-SQL full-text query. `search_tsv` is
  deliberately absent from `schema.ts`, so this is the only place that knows
  the column exists.
- `src/modules/documents/lib/folder-labels.ts` — "Contracts / 2026 / Acme"
  labels derived from the materialized path; degrades gracefully when RLS has
  hidden an ancestor.
- `src/lib/public-token.ts` — mint/hash/verify for anonymous credentials, plus
  scrypt passcodes and unlock-cookie signing. One `SHARE_SECRET`, derived per
  purpose.
- `src/modules/documents/shares/` — `status.ts` (derived status truth table),
  `scope.ts` (pruning rules), `resolve.ts` (the token→tenant hop),
  `contents.ts` (what a recipient sees), `limits.ts`, `events.ts`, `shares.ts`.
- `src/app/s/[token]/` — the public surface. Nothing else in the app renders
  without a session.
- `src/modules/documents/templates/apply.ts` — provisioning, called from
  `toggleModule` in `src/app/admin/actions.ts`.
- `src/lib/blob-stream.ts` — **the single way a stored blob reaches a
  browser**, shared with accounting and with the future public share routes.
- `src/lib/blob.ts` — `dmsPathPrefix(tenantId, kind)`, `isTenantBlobPath`.
- Routes: `/api/documents/blob/upload`, `/api/documents/[id]/file`,
  `/dashboard/m/documents/{browse,browse/[folderId],inbox}`.
- `src/db/index.ts` — `withTenant(tenantId, fn, { role })`, the third GUC.

## Decisions & gotchas

**One table, two surfaces.** `documents` is shared with the accounting
Receipts tool. `origin` discriminates them, and `text("origin").notNull()` with
no `.default()` in `schema.ts` makes it **required** in Drizzle's
`$inferInsert`, so the compiler names every raw insert site. It found exactly
four. This is enforcement by type, not by code review.

**The database default is deliberate — do not drop it again.** 0023 dropped it
and 0025 put it back after it caused a live outage. Migrations run before the
new code deploys, so for that window the RUNNING code still inserted documents
with no `origin` and every receipt upload and inbound-email ingestion failed
with `23502: null value in column "origin"`. The rationale for dropping it was
also wrong: `$inferInsert` is driven by `schema.ts`, not by the database
default, so the drop bought no enforcement whatsoever. The lesson generalizes —
**this repo migrates a live database ahead of the deploy, so every migration
must leave the CURRENTLY RUNNING code working.** Expand, deploy, then contract.

**The five queries that had to change.** Anything filtering `documents` by
`status` alone silently widens once DMS rows exist. `close.ts:105` is the
severe one — every unfiled DMS file would have become a permanent month-end
close blocker. There is a regression test for it. The others: `listDocuments`,
the Receipts tab counts, the dashboard KPI, and the sha256 duplicate lookup.

**`status` and `folder_id` are different words for "filed".** `status='filed'`
means *has ≥1 accounting link* and is owned by `links.ts`; `folder_id IS NOT
NULL` means *filed into the cabinet* and is owned by the DMS. Neither writes
the other's column. A receipt filed into a folder keeps its accounting status.

**Visibility is enforced by RLS, not by app queries.** A third
transaction-local setting, `app.tenant_role`, lets the policy compare
`effective_visibility` against the caller's role. It defaults to **`'staff'`**
— the least privileged value — so every existing two-argument `withTenant`
call keeps working and is denied restricted rows. A forgotten opt-in denies a
read; it can never grant one.

**The one-line fix that made it real.** `/api/accounting/documents/[id]/file`
is a bare id lookup with only a module gate. Until it passed `{ role }` to
`withTenant`, any staff member of an accounting tenant could stream an
owners-only DMS file by learning its uuid. App-level filtering in the DMS
module would never have covered that route — which is the argument for putting
the rule in RLS.

**Structural folder operations are owner-only** (move, delete, change
visibility) and this is a correctness constraint, not a permission taste. They
rewrite a subtree; staff cannot see owners-only folders; so a staff-run
rewrite would skip exactly the rows RLS hid from it and leave their paths
pointing at a parent that moved. Create and rename touch one visible row and
stay open to staff.

**Visibility is recomputed in TypeScript, never by a subtree UPDATE.** The
naive `UPDATE ... WHERE path LIKE prefix || '%'` is wrong in one direction:
turning a parent back to `members` must NOT re-open a descendant that declares
itself `owners`. `computeEffectiveVisibility` handles it and there are tests
for that exact case, pure and DB-backed.

**Restricted things return NOT_FOUND.** There is no `FOLDER_RESTRICTED` code.
When RLS hides a row, the application genuinely cannot distinguish "restricted"
from "gone", and not-found is the only non-leaking answer.

**Two WITH CHECK behaviours differ, and the tests document it.**
Cross-tenant writes return 0 rows (USING filters them). Moving a document INTO
a restricted folder *raises* — USING passes because staff can see the source
row, and WITH CHECK refuses the result. Loud failure is the better outcome.

**Serving uploads is the sharpest risk.** `text/html`, `image/svg+xml` and
`application/xhtml+xml` are refused at **upload**, not merely served as
attachments, so they can never sit in the store waiting to be mis-served.
`dispositionFor()` permits inline only for types that cannot execute. Every
file response carries `default-src 'none'; sandbox`, `nosniff` and
`no-referrer`, so widening the allowlist later is not automatically a
stored-XSS hole against the dashboard session. Filenames are sanitized (CR/LF
is header injection) and emitted with an RFC 5987 `filename*`.

**Two upload routes, not one parameterized route.** One route answering to two
module gates has cross-module privilege escalation as its failure mode; forty
duplicated lines are cheaper.

**No new UNIQUE index on `documents`, ever.** `createDocumentRecord` uses a
bare `.onConflictDoNothing()`, which covers every unique constraint on the
table — a second one would silently convert legitimate inserts into swallowed
conflicts followed by a confusing reselect failure. All new uniques live on
child tables. Corollary: filenames are not unique per folder (drives don't do
that either).

**Provisioning runs under `withSystem`**, diverging from `provisionAccounting`,
because `document_settings` is `member_read`-only by policy — a tenant-context
insert would be denied by design.

**Migration hand edit.** `document_folders_tenant_id_id_idx` had to be moved
above the FKs that reference it, or the migration fails with "no unique
constraint matching given keys" — the same trap `0013` hit.

**No enum was touched.** `ALTER TYPE ... ADD VALUE` cannot be used in the
transaction that adds it, and Drizzle runs migrations in a transaction. All
new discriminators are `text` + CHECK.

**Pagination exists here and nowhere else in the repo.** Every other list is a
hard `.limit(200)`, which is right for a chart of accounts and wrong for a
filing cabinet. Browse uses a keyset cursor on `(created_at DESC, id DESC)`,
matching `documents_tenant_folder_idx`.

**The public surface gives nothing away.** Unknown token, revoked, expired,
used up, locked, suspended, module switched off, tenant gone, file trashed —
all render the identical page with identical words. The invalid-token path
burns a decoy scrypt so it is not measurably faster than a real
wrong-passcode check either. Verified in a logged-out browser: a
one-character-different token is byte-identical to a revoked one.

**`withSystem` does the token→tenant hop and nothing else.** It never accepts a
caller-supplied tenant, document or folder id; every read after it is
`withTenant`. Widening that single lookup is the most dangerous refactor in
this module — the inbound-email webhook has the same rule for the same reason.

**Scope is re-checked on every file request**, not trusted from the listing.
The landing page is a render; the stream route is the gate. A file that left
the share between the two — trashed, moved somewhere private, link revoked —
is refused even though it was on screen a second ago.

**`max_uses` counts VIEWS, not devices.** A reload is a view. The alternative
needs a cookie minted during render, which React Server Components cannot do,
and "limit to N views" is an honest label.

**Byte budgets are a cost control, not only a security one.** A public link is
an egress amplifier: one leaked token pointed at a large file is an unbounded
storage bill and nothing else in the system would stop it.

## Open items

- **Versions, tags and saved views have tables but no UI yet** — the schema
  ships now so the later phases need no migration. `document_versions` is
  written by nothing today; `documents.file_version_no/count` stay at 1.
- **`extracted_text` is still empty** — the search index reads it at weight D,
  but nothing populates it. OCR / PDF text extraction is the follow-up that
  makes search reach inside documents rather than across their metadata.
- **Search is global or folder-scoped only** — no tag or kind facets, because
  there is no tag UI yet. `searchDocuments` already takes `folderPath`; the
  saved-view query schema anticipates the rest.
- **Templates/generation and e-signature** — designed and phased, not built.
  `document_settings` already carries their columns.
- **Share links have no email delivery** — the owner copies the URL and sends
  it themselves. The outbound email spine is its own phase, and it also
  unblocks invoice emailing. Rule for when it lands: never send a passcode in
  the same message as the link.
- **No per-link activity drawer yet** — `document_share_events` is written and
  readable, and the list page shows an open count and last-accessed date, but
  the full "opened from 203.0.113.x, 2 hours ago" feed is unbuilt.
- **A link-scanning security appliance that pre-fetches URLs will burn a view
  and log one.** Worth saying plainly if an activity feed ever implies a human
  looked.
- **The complete fix for serving user content is a separate origin**
  (`files.yosher-usercontent.com`). The sandbox CSP holds the line until then,
  and the stream route was written origin-agnostic so it can move.
- **No hard delete, and no blob is ever deleted** — same retention rule as the
  Receipts tool. A blob janitor is unbuilt.
- **`deleteFolder` with `move_to_parent` can throw `FOLDER_NAME_TAKEN`** if a
  relocated child collides with an existing name in the grandparent. Honest but
  confusing; wants a rename-on-collision or a clearer message.
- **Concurrent folder moves** are serialized by a coarse `FOR UPDATE` over the
  tenant's folders. Fine at this scale; revisit if a tenant ever has thousands.
- **A separate usercontent origin** (`files.yosher-usercontent.com`) is the
  complete fix for the XSS class. The stream route was written origin-agnostic
  so it can move without a rewrite.
