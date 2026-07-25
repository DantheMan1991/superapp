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

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `documents` (shared) | The generic file record, now carrying DMS columns | `origin` discriminates `accounting`/`dms` and has **no DB default** so `$inferInsert` makes it required. `member_all` policy compares `effective_visibility` against `app_current_tenant_role()`. **No new UNIQUE index may be added** — see Decisions |
| `document_folders` | The tree | Adjacency list (`parent_id`, source of truth) **+** materialized `path`. Self composite FK, NO ACTION. Two partial name uniques (root and non-root). `text_pattern_ops` prefix index, hand-written in 0024. Same visibility policy as `documents` |
| `document_versions` | File revision history | Partial unique on `is_current` makes "exactly one current" a DB invariant. `blob_pathname` index is deliberately NOT unique (a restore reuses a blob). Inherits visibility via an `EXISTS` subquery — no third copy of the flag |
| `document_tags` | Tenant tag registry | `documents.tags text[]` stores slugs from here, so a rename never rewrites documents. Slug format enforced by CHECK |
| `document_saved_views` | Saved filters | `query` jsonb is stored USER INPUT that becomes a WHERE clause — must be re-parsed with Zod on read |
| `document_settings` | Per-tenant module knobs | `member_read` only (platform-governed). Share/e-sign/AI columns created now, unused, so later phases need no migration |

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
Receipts tool. `origin` was added with a DB default (so existing rows backfill
for free) and then `DROP DEFAULT`ed, so Drizzle's `$inferInsert` makes it
**required** and the compiler names every raw insert site. It found exactly
four. This is enforcement by type, not by code review.

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

**Migration hand edits (both the same trap `0013` hit).** `origin` is added
defaulted then `DROP DEFAULT`ed; and `document_folders_tenant_id_id_idx` was
moved above the FKs that reference it, or the migration fails with "no unique
constraint matching given keys".

**No enum was touched.** `ALTER TYPE ... ADD VALUE` cannot be used in the
transaction that adds it, and Drizzle runs migrations in a transaction. All
new discriminators are `text` + CHECK.

**Pagination exists here and nowhere else in the repo.** Every other list is a
hard `.limit(200)`, which is right for a chart of accounts and wrong for a
filing cabinet. Browse uses a keyset cursor on `(created_at DESC, id DESC)`,
matching `documents_tenant_folder_idx`.

## Open items

- **Versions, tags and saved views have tables but no UI yet** — the schema
  ships now so the later phases need no migration. `document_versions` is
  written by nothing today; `documents.file_version_no/count` stay at 1.
- **Search** — `extracted_text` is an empty seam. The plan is a generated
  `tsvector` STORED column plus a GIN index, hand-written in the migration and
  deliberately not modelled in `schema.ts` (Drizzle has no tsvector type).
  Requires `'english'::regconfig` (the 2-arg form is not IMMUTABLE) and
  `left(extracted_text, 200000)` (tsvector has a 1MB ceiling).
- **External share links, templates/generation, e-signature** — designed and
  phased, not built. `document_settings` already carries their columns.
- **Trash has no UI** — `trashDocumentsAction`/`restoreDocumentsAction` exist
  and are reachable from the row menu, but there is no trash view to restore
  from yet.
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
