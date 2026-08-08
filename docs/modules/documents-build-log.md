# Documents — build log archive

> Older build-log entries for the Documents module, moved out of
> [`documents`](./documents) so the dossier stays readable. Nothing here is
> superseded — it is the record of how the module got built. The dossier
> itself carries the recent entries, the data model and the current state.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

### 2026-07-26 — Sheet-reading fix, remembered layout (branch `claude/documents-sheet-fix`)

**The founder sent the actual file, which settled it in one probe.** A
QuickBooks customer export is three problems at once: sheet 1 is
"QuickBooks Desktop Export Tips" — styled, `rowCount` 40, and genuinely empty
to a parser; the 955 rows of data are on sheet 2; and that data sits in column
C behind two empty indent columns.

**The UI bug was the one that actually hid the data.** The "this sheet is
empty" branch returned BEFORE the sheet tabs rendered — so a workbook whose
first sheet is a cover page showed the empty message with no way to reach sheet
2. Tabs now render first, always, and empty sheets are labelled as such. The
viewer also opens on the first sheet that HAS rows, because an export leading
with a cover sheet is the normal case, not the exception.

`trimGrid` now crops leading blank rows and columns as well as trailing ones,
so the customer list starts at "Customer" rather than at two empty columns.

**"This sheet is empty" on a real Excel file.** The reader indexed cells by
`worksheet.rowCount` and `worksheet.columnCount`. Both are derived from
metadata the WRITING application chooses to emit — and a workbook exceljs
itself writes reports them correctly, which is precisely why the original
version passed its tests and then failed on a file out of Excel. The tests were
testing the library's own output, not Excel's.

Now traversed with `eachRow`/`eachCell`, which walk the row objects that
actually exist. A sheet with no dimension record, a sparse grid, or data
starting at row 4 under a title block all read. Cells keep their real column
(`eachCell` skips leading gaps, so the row is padded to `colNumber`) and rows
keep their real number, so a gap does not shift everything up a line.

The round-trip tests now include the shapes that broke it: rows not starting at
row 1, sparse columns, multi-sheet, formulas, truncation. **A generated fixture
only proves you can read your own output** — worth remembering the next time a
parser looks well covered.

Also: a workbook that yields NO sheets now says so, rather than sharing the
"this sheet is empty" message with a genuinely blank sheet. Two different
problems deserve two different messages, and one of them is a bug report.

**The layout choice is remembered.** It was in the URL only, so walking into
another folder — where no `?view=` exists — reset it. Now stored in a cookie,
read on the SERVER so the first paint is already right; localStorage would
render the list and then flip on every navigation. An explicit `?view=` still
wins, so a link someone pastes into chat shows what they were looking at rather
than being rewritten by the recipient's habit.

### 2026-07-26 — Spreadsheet previews (branch `claude/documents-sheets`)

Excel and CSV now render as a table in the viewer, with sheet tabs.

**Parsed on the SERVER, and the library choice is the interesting part.** The
obvious pick is SheetJS in the browser, but the `xlsx` package published to npm
is pinned at **0.18.5** — the vendor moved newer community builds to their own
CDN — and that version carries known prototype-pollution and ReDoS advisories.
Pointing it at files strangers email into a folder address is not a trade worth
making for a preview. exceljs is MIT, current on npm, and Node is where it is
best supported. Parsing server-side also keeps roughly a megabyte of parser out
of the browser bundle and matches how every other blob here is handled.

**Bounded before a byte is parsed:** 200 rows × 40 columns × 12 sheets, and
files over 25MB are refused outright. A very large workbook is a denial of
service against this server, not merely a slow preview. Truncation is stated in
the UI — a preview that silently shows the first 200 rows of a 5,000-row takeoff
is a preview somebody will make a decision on.

`cell.ts` exists because `cell.value` is a union of about eight shapes and the
ugly ones only appear in real files: a formula cell is an object carrying its
cached RESULT (show the number, not `=SUM(A1:A9)`), rich text is an array of
runs, a hyperlink wraps its text. `String(value)` on any of those renders
"[object Object]" in the middle of someone's takeoff, and there is a test
asserting no shape ever does.

`csv.ts` is hand-written rather than a dependency — the whole job is RFC 4180
quoting, it is thirty lines, and it is pure. It sniffs `;` and tab delimiters
while ignoring delimiters inside quotes, so a `"Smith, John"` address cannot
win the vote in a semicolon file.

**Legacy `.xls` is refused with an explanation**, not a broken table: exceljs
cannot read the old binary format and the only library that can is the one
rejected above.

### 2026-07-26 — In-app viewer, PDF previews, tile sizing, filename fix (branch `claude/documents-viewer`)

**PDF previews work now, and the CSP is untouched.** The previous session
concluded they were impossible; that was half right. `frame-ancestors 'none'`
and `sandbox` govern a stored file as a DOCUMENT — they say nothing about our
own page fetching the same bytes and drawing them. `fetch()` answers to OUR
page's policy, and a canvas is not a browsing context. So pdf.js reads the
bytes and paints pixels: no frame, nothing from the file ever executes, both
headers exactly as they were. **Reaching for the headers was the wrong instinct;
the right question was whether a frame was needed at all.**

The same component gives a real in-app viewer — click a file and it opens in a
dialog with page navigation, never leaving Yosher. Images render as `<img>`;
Office files get an honest card and a download, because a browser genuinely
cannot render an xlsx without a converter. The underlying `<a href>` survives,
so middle-click and open-in-new-tab still work and the file is reachable with
no JavaScript.

Thumbnails are lazy behind an IntersectionObserver — a folder of fifty drawings
must not parse fifty PDFs on first paint.

**Tile sizing.** Grid rows size to their tallest member, so a folder tile next
to a file tile stretched and every row came out a different height. Folders now
carry the same aspect-square media block as files, which makes the grid uniform
by construction rather than by fixed heights.

**Upload filenames.** `addRandomSuffix` belongs in the storage KEY, but the
stored name was read straight off the blob pathname — so `Invoice 3000 (1).pdf`
listed as `Invoice 3000 (1)-A76EZtxEuYMtCeXMNHHj.pdf`. `displayNameFromBlobPath`
strips a 20+ character alphanumeric run before the extension; the tests care
more about the other half, that `as-built.pdf` and `RFI-004-response.pdf`
survive untouched.

### 2026-07-26 — Same-window open, and List/Icons/Thumbnails (branch `claude/documents-views`)

Files now open in the same tab instead of a new one, everywhere (Browse, Inbox,
Search). Types the allowlist marks `attachment` — Word, Excel, ZIP — download
without the page moving; inline types replace it and Back returns you to the
folder.

Three layouts, chosen by `?view=list|icons|thumbs` so a view is linkable and
survives a reload, like every other piece of browse state. Paging carries it
forward.

**Thumbnails are images only, and that is a CSP consequence rather than a gap.**
File responses carry `frame-ancestors 'none'` *and* a `sandbox` directive: the
first stops a PDF being framed on our own pages at all, and the second disables
the browser's built-in PDF viewer even where framing is permitted. Showing a
PDF inline would mean weakening both — the two controls that stop
user-uploaded content executing in our origin — so PDFs get a typed tile
instead. An `<img>` is subject to neither, which is why images work. The real
fix is server-side rasterised thumbnails cached as blobs; it needs a rasteriser
this runtime does not have. Recorded as an open item, not quietly skipped.

Same-window open is also the only way a PDF renders at all, for exactly the
same reason: a top-level navigation is not a frame.

### 2026-07-26 — Upload fix + drag and drop (branch `claude/documents-upload-fix`)

**Every upload in this module was broken in production.** Both call sites did
`import { upload as uploadPresigned } from "@vercel/blob/client"` — the classic
client-token helper, aliased to the name of the presigned one. The store is
PRIVATE, which rejects classic client tokens outright, and both routes answer
with `handleUploadPresigned`, so `upload` sent a handshake the route could not
read. Accounting already carried this exact lesson in a comment; Documents was
written against the wrong function and the alias hid it.

**Why it survived review, a build, a deploy and four sessions of tests:
`upload` and `uploadPresigned` have IDENTICAL signatures.** The alias
type-checks perfectly. No compiler, linter or database test can see it — only a
human selecting a file. There is now a source-scan guard test asserting nothing
under `src/` imports `upload` from that module, verified by deliberately
re-introducing the bug.

Then drag and drop, on the same branch because it is the same subsystem: drag a
file onto a folder to move it, drag a folder onto a folder to re-parent it,
drop files from the desktop to upload into whatever you dropped on, and drop
onto a breadcrumb to move something UP a level — otherwise the only direction
you can drag is deeper.

Everything routes through the server actions the menus already use, so the
gesture adds no authority: RLS still refuses a staff member dropping into an
owners-only folder, and the cycle check still refuses a folder dropped inside
itself. Folder rows are not draggable at all for staff, because moving a folder
is owner-only for the correctness reason recorded below.

### 2026-07-26 — PDF generation (branch `claude/documents-generate`)

Plan PR 11. A published template now produces a real filed PDF: fill the
fields, pick a folder, get a numbered document that shares, emails and versions
like anything else in the cabinet.

Three migrations, and the split is the point. **`0036` contains one statement
and nothing else** — `ALTER TYPE document_source ADD VALUE 'generated'`. A new
enum value cannot be USED in the transaction that adds it, and the runner wraps
a file in one, so `0037` (the table) and every writer of `'generated'` had to
land later. This was called in the build plan before a line was written.

**`@react-pdf/renderer`, not headless Chromium** — 3MB against Vercel's 250MB
limit rather than 50MB+ on top of `sharp`. `pdf-lib` remains the other half of
the plan for MODIFYING existing PDFs; nothing here does that yet.

**Noto Sans is vendored, and it is not decoration.** PDF's built-in Helvetica
is WinAnsi (cp1252) only: it covers `ñ` but silently mangles `Nguyễn`,
`Łukasz`, `Öztürk` — ordinary names on an ordinary crew list, and a lien waiver
that misspells the payee is a defective document. All FOUR faces are registered
because react-pdf does not synthesize; a missing italic face is a thrown error
at render time, not a slightly wrong document. That was found by the test that
renders every block type. `next.config.ts` traces the font directory into the
serverless bundle — without it, generation fails in production in a way that
cannot reproduce locally.

**Generation always uses the newest PUBLISHED version, never the draft**, which
is the practical payoff of publish immutability: a half-written waiver cannot
leave the building, and the generation record names the exact `version_no` used.

The blob is written with `access: "private"`, like every other blob in this
module. A generated waiver reaches a browser through the authenticated stream
route or a deliberate share link — never a public URL.

### 2026-07-26 — Document templates (branch `claude/documents-templates`)

Plan PR 10, complete. Three migrations (`0033`–`0035`), the merge engine, the
ops layer, the editor with a live preview, and a variable designer.

**Two bugs caught by tests that types could not see, both worth remembering.**

`0033` was hand-edited to move the `(tenant_id, id)` unique index above the
composite FK referencing it — the `0013`/`0023` trap. That edit silently
dropped `document_templates_tenant_name_idx` on the way past, so `schema.ts`
declared a unique the database did not have and `createTemplate`'s
`onConflictDoNothing()` had nothing to conflict WITH: duplicate template names
inserted silently instead of raising. `0035` restores it. **After hand-editing
a generated migration, re-read the whole file against `schema.ts`, not just
the lines you moved.**

The second: `template-ops.ts` is `server-only`, and the editor is a client
component. Importing a mere TYPE and a constant from it dragged the database
layer into the browser bundle and failed the build. The pure vocabulary now
lives in `doc-templates/fields.ts`, which has no `server-only` marker; client
code must import from there.

**Naming trap, read this first:** `src/modules/documents/templates/` is the
default FOLDER tree a tenant is provisioned with. DOCUMENT templates — a lien
waiver, a change order — live in `doc-templates/`. Unrelated concepts that
share an English word.

**The merge engine is the security-critical part and it is done.** A merge
value is NEVER substituted into the Markdown source; values are injected as
TEXT NODES into the already-parsed tree. This is the exact analogue of SQL
parameterization: a customer literally named `# ACME` must render as the text
"# ACME", not become a heading, and a subcontractor called
`[click here](http://evil.example)` must not become a link in a document the
business is about to put its name on. `merge.ts` is pure and imports no parser,
so the same code runs as a remark plugin in the browser preview and server-side
for PDF generation. Fifteen tests, including every injection shape (heading,
link, image, emphasis, list, blockquote, code) asserting the forbidden node
type never appears in the output tree.

Two subtleties worth keeping: markup that SPANS a placeholder (`**Hello
{{name}}**`) survives, which source-splitting would break; and placeholders
inside code spans are left alone, because a template showing `{{amount}}` is
documenting the syntax, not using it. An unfilled field renders as `[field]`
rather than a blank — a silent hole in "Received from ___ the sum of" is worse
than something that obviously still needs filling in.

**Publish immutability** is enforced in `template-ops.ts`, not by a constraint:
Postgres cannot express "these columns freeze once that column is non-null"
without a trigger, and a trigger that silently discards a write is worse than
an error that says why. Editing a published template opens a NEW draft at the
next version number. At most one draft per template IS a database invariant
(partial unique on `published_at is null`), so two people editing converge on
one draft instead of forking it.

### 2026-07-26 — Per-link activity feed (branch `claude/documents-share-activity`)

"Did the inspector actually open the drawings?" — answered. An Activity sheet
on every share link: what happened, when, which file, and how much was sent.

**No migration and no new read model.** `document_share_events` has been
written since share links shipped and `listShareEvents` already existed; the
whole gap was UI. `loadShareActivity` adds the join for the file name and the
visitor grouping.

**Visitor codes are derived from the stored IP HASH, not an address.** `hashIp`
is a keyed HMAC and the raw address is never stored, so the six-character code
supports exactly one honest claim — "these opens came from the same place" —
and cannot be reversed. An empty hash yields `null` rather than a shared
pseudonym, because a constant would invent a visitor by merging unrelated
events.

**The feed says out loud that an open is a REQUEST, not a person.** The
open item recorded when shares shipped — a link-scanning security appliance
pre-fetches URLs, burning a view and logging one — is now printed under the
feed rather than left as a trap for whoever reads it in an argument.

Available on revoked links too: what happened while a link was live is exactly
what someone asks about after switching it off.

### 2026-07-25 — Tags and saved views (branch `claude/documents-tags`)

A shared vocabulary for the business, and named filters over it. Registry page
at `/tags`, a picker on every file, chips that link to the filtered list, and
"Save this view".

**No migration again** — `document_tags`, `document_saved_views`,
`documents.tags` with its GIN index, `core/tags.ts` and six error codes all
shipped in session 1.

The move that makes saved views safe: **search grew an optional text term**, so
it is now the one filtered-list implementation — facets, folder scope and full
text in a single query. A saved view is therefore *the same parameter set the
search page already reads*, stored and replayed as a URL. There is no second
query path interpreting jsonb, which is the version of this feature the
original note ("`query` jsonb is stored USER INPUT that becomes a WHERE
clause") was warning about. It is still re-parsed with Zod on every read.

Two rules worth carrying forward: **a tag's slug is immutable** (rename touches
one row and no document moves — the entire reason documents store slugs), and
**deleting a tag is owner-only** for the same correctness reason structural
folder operations are, since the sweep rewrites documents RLS hides from staff.

Found by the tests, worth knowing: interpolating a JS array into a Drizzle
`sql` template flattens it into one parameter per element, which Postgres
rejects as a malformed array literal. Use `inArray()` or `sql.param()`.

### 2026-07-25 — File versions (branch `claude/documents-versions`)

Replace a file and keep the old one: "Upload new version…", a history panel,
and restore. The revised drawing lands on the same document everyone already
has links to, and last week's drawing is still one click away.

**No migration.** `document_versions`, `documents.file_version_no/count`, the
`?v=<versionId>` branch of the stream route and the `VERSION_NOT_FOUND` code
were all built in session 1 and sat unused. Shipping the schema ahead of the UI
paid for itself exactly as intended — this session is application code only.

The load-bearing piece is `materializeCurrentVersion`. Every document in the
system has zero version rows, so appending v2 would overwrite
`documents.blob_pathname` and leave the ORIGINAL blob referenced by nothing:
still stored, still billed, unreachable, and absent from a history claiming to
be complete. v1 is written lazily from the document's own columns immediately
before v2 is inserted. Lazily rather than as a backfill migration so there is
exactly one code path that produces a v1 row and every test exercises it.

Two refusals worth knowing: **accounting-origin documents cannot be versioned**
(a receipt's bytes are what a journal entry points at, and the row menu does not
offer the option rather than explaining the refusal), and **restore appends**
rather than rewinding, so "someone rolled back on Tuesday" survives in the
history instead of being erased by the act of rolling back.

### 2026-07-25 — Email files into a folder (branch `claude/documents-inbound`)

Opt-in forwarding address per folder: `docs-<token>@in.yosherapp.com`. A
subcontractor emails revised drawings to the job folder's address and they file
themselves — no login, no app, and no attachment stranded in somebody's
personal inbox.

Deliberately the half of the email story that needs **no paid sending plan**:
receiving was already configured for the receipts inbox, so this works today
while outbound waits on a Resend upgrade.

Two shared libs came out of it, because receipts and folders now receive on the
same domain: `src/lib/inbound-address.ts` (prefix routing, and the production
lesson that Outlook lowercases forwarded addresses) and
`src/lib/inbound-attachments.ts` (which files are documents versus signature
logos). Accounting delegates to both and keeps its own exports, so its tests
were untouched.

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
