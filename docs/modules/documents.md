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

### 2026-08-07 — Search reaches inside files (branch `claude/documents-extract-text`)

`extracted_text` has been read by `search_tsv` at weight D since `0026` and
written by nothing but the mail seam. Search matched a document's METADATA and
never its contents — which for a DMS is the difference between a filing cabinet
and a searchable one. There is now a producer.

**No model, and that is the finding rather than a compromise.** A PDF carrying
a text layer needs a parser, not vision, and `pdfjs-dist` was already a
dependency — it draws the previews. Probing it under plain Node settled the
whole design in ten minutes: `legacy/build/pdf.mjs` extracts a text layer with
no DOM, no worker and no new package. So the house AI pattern
(`accounting/ai/extract.ts`) is deliberately NOT copied here. There is no
per-document bill, so no cooldown to claim; no network hop, so nothing to
inject and nothing to keep out of a transaction; and the output is a string, so
no shape to validate. **Cargo-culting that machinery would have added a
transaction, a settings column and an injectable seam to a function that parses
bytes.**

Four strategies behind one dispatcher: PDF text layer, plain text/CSV/Markdown,
and xlsx through the exceljs the preview already owns. Zero new dependencies.

**`empty` is the point of the state column.** Six states rather than a boolean,
because "I searched for a phrase I can see in this file and got nothing" has six
different answers and only one is a bug. `empty` means a supported type that
genuinely carries no text layer — a scan, a photographed permit — and it is
therefore the exact population OCR would help. **The vision question is now
measurable instead of estimable**: the backfill prints that count, and the
number is what should decide whether anyone pays for a model. Guessing at it
first was the expensive version of this session.

**It runs inline at upload, which sidesteps the cron question entirely.**
`inspectUploadedBlob` already downloaded the whole blob to hash it and threw the
bytes away; handing them back makes extraction cost a parse rather than a second
download of up to 100MB. So no cron, no queue, and no fifth passenger on a
decision `notifications.md` has deliberately deferred until the agent runs give
it two real consumers. The backlog is drained by `npm run docs:extract-text`,
which is a script because a backlog is finite — a cron would be a permanent job
solving a problem that stops existing after its first successful run.

**Text lives on the version row, and that made re-extraction fall out for
free.** `document_versions` already stores every other descriptor of a set of
bytes (file_name, mime_type, size, sha256); text is one more, so it follows the
same rule and `promoteVersion` denormalizes it onto the document exactly as it
already does the other five. Restoring v1 therefore restores v1's text with no
blob read and no re-parse, and "the index describes the CURRENT bytes" is one
assignment in one function rather than an invariant two call sites must
remember. The alternative — re-downloading and re-parsing on restore — is more
code, more failure modes, and a window where the index is confidently wrong.

Four things the tests found, all invisible to the compiler:

- **pdfjs returns positioned FRAGMENTS, not lines.** Concatenated, "…order
  0042" followed by "Kitchen elevation" becomes the lexeme `0042Kitchen`, which
  matches neither word anyone would type — and the index looks fine, because
  every other word in the document still matches. Joined with a space, with a
  test that asserts the fused form never appears.
- **A NUL byte would have failed the upload, not the indexing.** Postgres `text`
  cannot hold U+0000, so one mislabeled binary uploaded as `text/plain` takes
  the whole INSERT down with `unsupported Unicode escape sequence`. Everything
  is scrubbed before it is stored.
- **A whitespace-boundary cut using a FRACTION of the budget is nonsense.** At
  200,000 characters the last space is always within a few characters of the
  end, so a `> max * 0.9` threshold either never fires or always fires depending
  on a number nobody can reason about — and at small budgets it silently cut
  mid-word anyway. An absolute 100-character lookback is a question with an
  obvious answer either way.
- **A sheet with no cells must contribute nothing, not even its name.** Indexing
  "Sheet1" makes every untouched workbook match a search for it, and means
  `empty` could never be reported for a spreadsheet at all — costing the state
  its meaning to gain a lexeme nobody wants.

**Run against the dev branch's REAL files, which is the only evidence that
counts here.** A Fulton Lumber invoice PDF yielded 932 characters and the
QuickBooks customer export from the sheet-reading session yielded 34,754 — both
confirmed matched by `search_tsv @@ websearch_to_tsquery`, not merely stored.
That run also produced the one quality defect worth knowing about (`INV OICE`,
see Open items) and a script bug no fixture would have shown: **a document whose
blob has gone missing is recorded `failed`, `failed` is in the queue, so the
backfill re-served the same four rows 732 times.** The queue now excludes what
the current run has already attempted, which keeps the behaviour that was
actually wanted — a transient failure is retried on the NEXT run, not
immediately and forever.

**The dossier was slightly wrong and is corrected above.** "Nothing populates
it" was true of the upload path only: `mail/extension.ts` has written a message
transcript into `extracted_text` since filing shipped. Those rows are marked
`done` so the backfill leaves them alone — a transcript is a better answer than
any parser could give for an `.eml`, whose raw bytes are headers and base64.

`0095` is expand-only (three `ADD COLUMN`s with defaults, one partial index, two
CHECKs) and adds no table, so there is deliberately no `--custom` RLS migration
beside it: a new COLUMN on a table that already has FORCE'd policies is covered
the moment it exists, and adding a policy would be a second place for the
visibility rule to be wrong. Verified with `verify-rls.ts` and by reading
`information_schema` back, because "migrations complete" is not evidence.

The isolation suite gained the assertion that now matters more than it did:
what is protected is no longer a filename but **the wording of an owners-only
document**, across tenants and across roles, on both tables and through the
`search_tsv` query shape search actually uses.

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

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `documents` (shared) | The generic file record, now carrying DMS columns | `origin` discriminates `accounting`/`dms`; required in `$inferInsert` via `schema.ts`, and DB-defaulted to `'accounting'` so pre-Documents writers keep working (see Decisions). `member_all` policy compares `effective_visibility` against `app_current_tenant_role()`. **No new UNIQUE index may be added** — see Decisions. `extracted_text` (indexed by `search_tsv` at weight D) describes the CURRENT bytes and is denormalized from the current version row; `text_extraction` (`0095`, text + CHECK over six states) says why it is or is not there. Do NOT confuse `text_extraction` with `extraction_status` — the latter is the accounting AI's, and a DMS upload is `skipped` there and meaningful here |
| `document_folders` | The tree | Adjacency list (`parent_id`, source of truth) **+** materialized `path`. Self composite FK, NO ACTION. Two partial name uniques (root and non-root). `text_pattern_ops` prefix index, hand-written in 0024. Same visibility policy as `documents` |
| `document_versions` | File revision history | Written by `versions.ts` since 2026-07-25. Partial unique on `is_current` makes "exactly one current" a DB invariant, and it is NOT deferrable, so the swap must clear the old flag before inserting. `blob_pathname` index is deliberately NOT unique (a restore reuses a blob). Inherits visibility via an `EXISTS` subquery — no third copy of the flag. A document with no history has ZERO rows here, not one — see Decisions. Since `0095` it also carries `extracted_text`/`text_extraction`, and this is the AUTHORITATIVE copy: text describes BYTES, and every other descriptor of the bytes (file_name, mime_type, size, sha256) was already here. `promoteVersion` denormalizes both onto the document |
| `document_tags` | Tenant tag registry | Written by `tag-ops.ts` since 2026-07-25. `documents.tags text[]` stores slugs from here, so a rename never rewrites documents — and the SLUG IS IMMUTABLE, see Decisions. Slug format enforced by CHECK; `(tenant, slug)` unique is what makes "As Built" and "as-built" the same tag. No FK is possible from an array element, so `setDocumentTags` is the only door |
| `document_saved_views` | Saved filters | `query` jsonb is stored USER INPUT — re-parsed with Zod on EVERY read by `parseSavedViewQuery`. Since 2026-07-25 it resolves to search-page parameters rather than to a WHERE clause of its own; unknown keys are stripped, invalid fields degrade to absent. Unique is `(tenant, creator, name_key)`, so two people may use the same view name |
| `document_templates` | Document template identity | `0033`/`0035`. `(tenant, name_key)` unique — restored by `0035` after a hand edit to `0033` dropped it, see Build log. Archived, never deleted, so a generated document naming it cannot dangle |
| `document_template_versions` | Template bodies | Partial unique on `published_at is null` makes "at most one draft per template" a DB invariant. Publish immutability itself is enforced in `template-ops.ts` — Postgres cannot freeze columns on a condition without a trigger. `fields` jsonb is DERIVED from the body on every save, so it cannot drift into promising a field the document lacks; still re-parsed on read |
| `document_generations` | What was produced from a template | `0037`/`0038`. `member_read` ONLY — provenance is evidence, so only `recordGeneration` writes it. `(tenant, number)` unique makes the per-tenant sequence quotable. `document_id` is NULLABLE with a NO ACTION FK: a document can be trashed and the record that it was ever produced must outlive that. Stores `template_version_no` as a NUMBER as well as an id, so "generated from v3" survives even if the version row does not |
| `document_settings` | Per-tenant module knobs | `member_read` only (platform-governed). E-sign/AI columns created now, unused, so later phases need no migration |
| `document_shares` | Anonymous link grants | `token_hash` GLOBALLY unique (the public lookup has no tenant to scope by). XOR document/folder scope. `expires_at` NOT NULL — no permanent anonymous links. `created_root_visibility` snapshot drives self-suspension |
| `document_share_events` | Per-link access log | `member_read` ONLY — evidence in a dispute, so members read it and only `recordShareEvent` (withSystem) writes it |
| `public_access_attempts` | Anonymous probe counters | **No `tenant_id` at all.** An attacker guessing tokens is nobody's data, and attributing that traffic to whichever tenant they hit would be wrong. Superadmin-only |

Migrations: `drizzle/0023_documents_dms.sql` (+ two hand edits, see Decisions)
and `drizzle/0024_documents_dms_rls.sql` (custom: the role function, the
replaced `documents` policy, policies for the five new tables).
`drizzle/0095_documents_extracted_text.sql` adds the text columns — expand-only,
no new table, and therefore deliberately **no `--custom` RLS migration** (see
Decisions).

## Key files & seams

- `src/modules/documents/core/` — pure, DB-free, unit-tested: `tree.ts`
  (paths, cycles, `computeEffectiveVisibility`), `tags.ts`, `paging.ts`,
  `errors.ts`, `integrity.ts` (drift detector).
- `src/modules/documents/folder-ops.ts` — folder mutations + `recomputeVisibility`.
- `src/modules/documents/actions.ts` (folders) and `document-actions.ts` (files).
- `src/modules/documents/ingest.ts`, `allowlist.ts` — upload verification.
- `src/modules/documents/versions.ts` — the revision log: `addDocumentVersion`,
  `restoreDocumentVersion`, `listDocumentVersions`, and the lazy
  `materializeCurrentVersion` every write path calls first.
- `src/modules/documents/components/version-controls.tsx` — the replace dialog
  and the history panel, mounted only while open so browsing a folder makes no
  version queries.
- `src/modules/documents/text/` — the `extracted_text` producer. `state.ts` is
  the pure vocabulary (the six states, the bounds, `isTextExtractable`) and
  carries NO `server-only` marker, so a client component can say why a file is
  not searchable; `extract.ts` is `server-only` and owns pdfjs and exceljs.
  Importing even a type from `extract.ts` into client code drags those parsers
  toward the browser bundle — the `doc-templates/fields.ts` lesson, again.
- `scripts/extract-document-text.ts` (`npm run docs:extract-text`) — the
  backfill for documents that predate the producer, and the retry for `failed`.
  Prints the per-state tally, which is the measurement the OCR decision needs.
- `src/modules/documents/search.ts` — raw-SQL query behind BOTH search and
  every saved view: optional text term, tag/origin facets, folder scope.
  `search_tsv` is deliberately absent from `schema.ts`, so this is the only
  place that knows the column exists.
- `src/modules/documents/tag-ops.ts` — the registry, and `setDocumentTags`, the
  single door onto `documents.tags`.
- `src/modules/documents/saved-views.ts` — `savedViewQuerySchema`,
  `parseSavedViewQuery` (called on every read) and `savedViewHref`.
- `src/modules/documents/lib/folder-labels.ts` — "Contracts / 2026 / Acme"
  labels derived from the materialized path; degrades gracefully when RLS has
  hidden an ancestor.
- `src/lib/public-token.ts` — mint/hash/verify for anonymous credentials, plus
  scrypt passcodes and unlock-cookie signing. One `SHARE_SECRET`, derived per
  purpose.
- `src/modules/documents/shares/activity.ts` — the per-link feed, plus the pure
  `visitorLabel` (IP-hash pseudonym) and `isDeniedKind`.
- `src/modules/documents/shares/` — `status.ts` (derived status truth table),
  `scope.ts` (pruning rules), `resolve.ts` (the token→tenant hop),
  `contents.ts` (what a recipient sees), `limits.ts`, `events.ts`, `shares.ts`.
- `src/app/s/[token]/` — the public surface. Nothing else in the app renders
  without a session.
- `src/modules/documents/templates/apply.ts` — FOLDER-tree provisioning, called
  from `toggleModule` in `src/app/admin/actions.ts`. Unrelated to
  `doc-templates/` below despite the shared word.
- `src/modules/documents/preview/` — spreadsheet previews. `cell.ts` (exceljs
  value shapes → text) and `csv.ts` (RFC 4180) are pure and heavily tested;
  `spreadsheet.ts` is `server-only` and owns exceljs; `types.ts` carries the
  shapes the client needs so nothing drags the parser into the browser bundle.
- `src/modules/documents/components/pdf-canvas.tsx` — PDF rendering via pdf.js
  to a canvas. Read the header before changing it: fetch-and-draw is what lets
  previews exist without touching the file-response CSP.
- `src/modules/documents/doc-templates/` — DOCUMENT templates (a lien waiver, a
  change order). `merge.ts` is the pure, parser-free injection engine;
  `fields.ts` is the vocabulary shared with the browser; `template-ops.ts` is
  `server-only` and owns publish immutability; `render-pdf.tsx` is
  markdown→PDF; `generate.ts` files the result. `fonts/` is vendored Noto Sans
  — see `fonts/NOTICE.md` before shipping externally.
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

**Text extraction has no model in it, and that was a decision rather than a
shortcut.** The house AI pattern — gather-and-gate in one tenant transaction, a
per-tenant cooldown claimed as it is checked, exactly one injectable network
function, Zod at the boundary — exists to make a metered, slow, untrusted remote
call safe. A library call is none of those things: no bill, so no cooldown; no
network, so nothing to inject and nothing that must stay out of a transaction;
a string, so nothing to validate. **Copying the shape anyway is how a parser
ends up with a settings column.** If a vision pass is ever added it should
follow `accounting/ai/extract.ts` properly, as a SEPARATE producer consuming the
`empty` queue — not by growing this file a network branch.

**`empty` is a measurement, not a failure.** It means a supported type that
genuinely carries no text layer, which is precisely the population OCR would
help and nothing else would. Counting it is how the vision question gets decided
with evidence; `npm run docs:extract-text` prints the number. Anything that
makes `empty` unreachable — say, indexing a blank sheet's name so a workbook is
never textless — quietly destroys that measurement, which is why an empty sheet
contributes nothing at all.

**`text_extraction` and `extraction_status` are different questions about the
same file.** The latter is the accounting AI's status for the `extraction` jsonb;
a DMS upload is `skipped` there forever. The former is whether search can reach
inside the file. They were conflated once in review and the shared table makes
that easy to do again — the insert site carries a comment saying so.

**200,000 characters is the INDEX's number, not a taste.** `search_tsv` reads
`left(extracted_text, 200000)` because a tsvector has a hard 1MB limit and an
unbounded dump would make INSERTs start failing later, in production, on a table
that was fine yesterday. The producer honours the consumer's bound rather than
letting the index truncate silently — storing more is bytes nobody can ever
find. **Change `text/state.ts` and `drizzle/0026`'s `left(...)` together** or
the two disagree.

**A NUL byte is an upload failure, not an indexing failure.** Postgres `text`
cannot hold U+0000, so one mislabeled binary uploaded as `text/plain` would take
the whole INSERT down with `unsupported Unicode escape sequence` — a rejected
file, caused by a column we only added to help find it. `sanitizeExtractedText`
scrubs control characters and lone surrogates before anything is stored, and it
is written with Unicode property escapes rather than code-point ranges so the
source file contains no control characters of its own to be mangled by an editor
or a patch.

**pdfjs, in Node, from `legacy/build/`.** The default `build/pdf.mjs` the browser
preview uses assumes a window. No worker is configured on purpose — pdfjs then
runs on the calling thread, which is what a serverless function with no second
thread wants. `verbosity: 0` because otherwise every document without embedded
standard fonts logs a `standardFontDataUrl` warning irrelevant to text. There is
deliberately no `isEvalSupported: false`: pdfjs 6 **removed the option along
with the eval path it guarded**, so adding it back would not fail the build, it
would be silently ignored — which reads like a protection that is not there.

**pdfjs returns positioned FRAGMENTS, not lines.** Join them with a space or
"…order 0042" and "Kitchen elevation" fuse into the lexeme `0042Kitchen`,
matching neither word anybody would type. The failure is nasty because the index
looks healthy: every other word in the document still matches. There is a test
asserting the fused form never appears.

**The extracted text follows the current bytes, exactly as `file_name` does,
and `promoteVersion` is the only place that has to know.** Both the append path
and the restore path end there, so the invariant is one assignment rather than a
rule two call sites must remember. Storing text on the version row is what makes
that free: restoring v1 recovers v1's text with no blob read and no re-parse, and
a document uploaded before the producer existed materializes its v1 as `pending`
rather than borrowing v2's text — which would leave the index confidently wrong,
the worst of the available failures.

**The backfill runs under `withSystem`, and `withTenant` would be the unsafe
choice.** `withTenant` defaults `app.tenant_role` to `'staff'`, so a
tenant-context backfill would silently skip exactly the owners-only documents —
leaving a corpus searchable for everyone except the people who filed the
sensitive things. Same trap as an owner-only tag delete sweeping rows RLS hid
from it. Every query in the script still names `tenant_id`, and nothing crosses a
tenant boundary within one document.

**The backfill never blanks text it did not produce, and never touches
`updated_at`.** A row can already hold a mail transcript; if a strategy has
nothing better to offer, the existing text stays. And reading a file is not a
change to it — moving the timestamp would push every document in the business to
the top of "recently modified" on the day the script runs.

**Settled answers are not retried.** The queue is `pending` and `failed` only.
`empty`, `unsupported` and `too_large` are facts about the file rather than
transient errors, and re-downloading the corpus every run to re-learn them would
be the expensive way to change nothing. **When the strategies grow — an OCR pass
claiming `empty`, a zip reader claiming Word — the re-queue is a deliberate
UPDATE**, not something the script does on its own.

**A new COLUMN needs no RLS migration; a new TABLE does.** `0095` adds no table,
and RLS is row-level: `documents` and `document_versions` already carry FORCE'd
policies that cover a column the moment it exists. Adding a policy here would be
a second place for the visibility rule to be wrong. The general rule in
AGENTS.md is about tables, and it is worth reading it that way rather than
reflexively writing a `--custom` file. Verified either way — `verify-rls.ts`
plus an `information_schema` read-back, because "migrations complete" is not
evidence.

**A tag's slug is immutable, and that is the whole design.** `documents.tags`
stores slugs, so renaming a tag is a one-row update on the registry and not a
single document moves. Changing a slug on rename would orphan every document
carrying it — silently, with no error anywhere, because Postgres cannot
foreign-key an array element. `updateTag` therefore writes `name` and `color`
only. Somebody who truly wants a different slug creates a different tag.

**`setDocumentTags` is the only door onto `documents.tags`.** It resolves every
slug against the registry inside the transaction and refuses unknown ones. That
check is the *substitute* for the foreign key that cannot exist, so anything
else writing that column can create a slug the registry has never heard of.

**Deleting a tag is owner-only**, for the same correctness reason structural
folder operations are: the delete sweeps `array_remove` across the tenant's
documents, and RLS hides owners-only documents from staff. A staff-run delete
would remove the registry entry while silently skipping exactly the documents
it could not see, leaving them carrying a slug that resolves to nothing.
Creating and renaming touch one registry row and stay open to staff.

**Search's text term is optional, and that is what makes saved views safe.**
One query implementation serves full-text search, tag facets, origin and folder
scope. A saved view is consequently the same parameter set the search page
already reads — stored, re-parsed, and replayed as a URL. The alternative,
a second query builder interpreting stored jsonb, is what turns "user input
that becomes a WHERE clause" into a real problem. `parseSavedViewQuery` still
runs on every read: unknown keys are stripped, invalid fields degrade to
absent, and tags go through the same normalizer as every other tag path. There
is a test that feeds it a hand-edited row containing an injection string and a
bogus origin and asserts only the valid field survives.

**A private saved view hides a shortcut, not data.** `scope` is an app-level
courtesy with no RLS behind it; the documents a view selects are protected by
their own policies. The dialog says so in as many words, because "only me"
could otherwise be read as a security control.

**Interpolating a JS array into a Drizzle `sql` template flattens it** into one
parameter per element, and Postgres then rejects the result ("malformed array
literal", or "op ANY/ALL requires array on right side"). Use `inArray()` for
membership and `sql.param(arr)` when the array must arrive as a single
parameter. Both bugs were caught by the DB-backed tests and neither is visible
to the type checker.

**A document with no history has ZERO version rows, not one.** The initial
upload deliberately writes nothing to `document_versions`, so
`listDocumentVersions` synthesizes the single entry (`id: null`) and the UI
never special-cases "never revised". The consequence that matters: **every
write path must call `materializeCurrentVersion` before appending**, or the
document's current blob loses its last reference the moment
`documents.blob_pathname` is overwritten. That function is the reason nothing
was lost when versioning shipped over an existing corpus, and any future writer
of `document_versions` has to call it too.

**Restore appends; it never rewinds.** Restoring v1 inserts a NEW row (v4, say)
pointing at v1's *existing* blob — no byte copy, no re-hash, and
`restored_from_version_id` records where it came from. The alternative, moving
the `is_current` flag backwards, would erase the fact that a rollback happened,
which is precisely the event someone reading a history wants to see. This is
also why `document_versions_blob_idx` is not unique.

**Versioning is DMS-only.** `origin='accounting'` is refused with
`DOCUMENT_NOT_VERSIONABLE`. A receipt's bytes are the evidence a journal entry
or bill points at, and swapping them from the filing cabinet would rewrite that
transaction's support without the accounting module ever hearing about it. The
row menu hides the option instead of offering an action that will be refused.

**`file_name` follows the current version; `title` does not.** The title is the
human's label for the *thing* ("Kitchen elevation") and survives a revision that
arrives named `scan_0042.pdf`. The file name describes the bytes actually being
served, so downloads and the search index stay honest. The `documents.version`
CAS counter is also bumped, so a rename dialog opened before a replacement is
correctly refused as stale.

**Share links follow the current version.** A recipient always sees the newest
bytes, and the public route accepts no `?v=` parameter at all, so history is
unreachable from outside the business. Both are deliberate: a link to "the
drawing" should show the drawing that is current, and superseded revisions are
internal.

**A new enum value gets its own migration file, alone.** `ALTER TYPE ... ADD
VALUE` cannot be followed by a use of that value in the same transaction, and
the runner wraps each file in one. `0036` therefore contains exactly one
statement and `0037` creates the table. The same reasoning is why earlier
sessions used `text` + CHECK instead of enums for new discriminators — this was
the one place a real enum already existed.

**Generation always uses the newest PUBLISHED version.** Never the draft. A
half-written waiver must not be able to leave the building, and the generation
record names the exact `version_no`, which is only meaningful because published
versions are frozen. The two features are one design.

**react-pdf does not synthesize font faces.** A missing italic is
`Could not resolve font for NotoSans, fontStyle italic` at render time — a
failed document, not a slightly wrong one. All four faces are registered, and
`next.config.ts` traces the font directory into the serverless bundle. Both
failures are invisible locally, where the repo is simply present.

**A merge value is content, never syntax.** Values are injected as TEXT NODES
into the parsed Markdown tree; they are never substituted into the source. This
is the analogue of SQL parameterization — a client literally named `# ACME`
must render as text, and a subcontractor called
`[click here](http://evil.example)` must not become a link in a document the
business is about to put its name on. `doc-templates/merge.ts` is pure and
imports no parser, so the identical function runs as a remark plugin in the
browser preview and server-side for generation. **Never "simplify" it into a
string replace on the body.** Two behaviours fall out of the tree approach and
are tested: markup SPANNING a placeholder (`**Hello {{name}}**`) survives,
which source-splitting would break, and placeholders inside code spans are left
alone because a template showing `{{amount}}` is documenting the syntax.

**Publish immutability is application-enforced, deliberately.** Postgres cannot
express "these columns freeze once that column is non-null" without a trigger,
and a trigger that silently discards a write is worse than an error that
explains itself. `saveDraft` additionally carries `published_at is null` in its
WHERE clause, so even a mis-targeted id cannot rewrite a frozen version.

**After hand-editing a generated migration, re-read the whole file against
`schema.ts`.** Moving an index above an FK in `0033` silently deleted a
different unique index; the symptom was `onConflictDoNothing()` having nothing
to conflict with, which no type checker can see. `0035` restores it.

**`server-only` propagates through type imports.** Importing just a TYPE and a
constant from `template-ops.ts` into the editor pulled the database layer into
the browser bundle and failed the build. Vocabulary shared with client
components lives in `doc-templates/fields.ts`, which carries no marker.

**Never let an error state hide the control that escapes it.** The spreadsheet
viewer returned its "empty sheet" message before rendering the sheet tabs, so
the one workbook shape where you most need to switch sheets — a cover sheet
first — was the shape where switching became impossible. Render navigation
before content, always.

**A fixture you generated only proves you can read your own output.** The
spreadsheet reader passed a full round-trip suite and then returned nothing for
a real Excel file, because it indexed by `rowCount`/`columnCount` — counters
derived from metadata the writing application chooses to emit, which exceljs
naturally emits correctly for its own files. Traverse with `eachRow`/`eachCell`
instead, and treat "the tests use a fixture the code under test also wrote" as
a reason to distrust the coverage rather than to feel good about it.

**A stored file is never EMBEDDED — it is fetched and drawn.** `frame-ancestors
'none'` plus `sandbox` on every file response is what stops user-uploaded
content executing in our origin, and together they rule out an iframe, an
`<object>` and the browser's own PDF viewer. They do NOT rule out previews:
those headers govern the file as a document, whereas `fetch()` answers to our
page's policy and a canvas is not a browsing context. pdf.js therefore reads the
bytes and paints them (`pdf-canvas.tsx`), images use `<img>`, and both headers
stay as they are.

The general lesson, because the first attempt got this wrong: **when a security
header blocks a feature, check whether the feature actually needs the thing the
header governs before proposing to weaken it.** Relaxing `frame-ancestors` here
would have bought nothing that fetch-and-draw does not already give, at the cost
of the module's main defence against stored XSS.

**Client uploads MUST use `uploadPresigned`, never `upload`.** The blob store is
private, which rejects classic client tokens, and both upload routes answer
with `handleUploadPresigned`. The two SDK functions have identical signatures,
so `import { upload as uploadPresigned }` type-checks and then fails every
upload at runtime — which is exactly what shipped. A source-scan test now
guards it, because nothing else can.

**Drag and drop adds gestures, never authority.** Every drop calls the same
server action the equivalent menu item calls. Folder rows are not draggable for
staff at all (moving a folder is owner-only), the subtree-cycle rule is applied
before the request as well as inside it, and a drop into an owners-only folder
still fails at RLS. If a future drop target needs a NEW action, that is the
signal to stop and check the permission story rather than reuse the nearest
one.

**`dragover` cannot read `dataTransfer` contents, only the type list.** That is
why internal drags carry a private MIME type (`application/x-yosher-doc`) — a
drop target has to decide whether to accept the drag before it can see what is
being dragged. Also why `dragenter`/`dragleave` counting is a ref rather than a
boolean: both fire for every child element, so a naive flag flickers as the
pointer crosses a row's own contents.

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

**A folder's email address is an anonymous WRITE surface** — the mirror image
of a share link. Anyone holding it can put files in that folder, so addresses
are off by default, owner-only to create, and rotating one invalidates the old
address. Controls are the unguessable token, a per-folder hourly cap, and the
upload allowlist re-applied to the real downloaded bytes rather than the
provider's claimed size.

**Delivery stops if the folder later becomes owners-only.** The address was
handed to an outsider while the folder was open; continuing to accept mail
would let a third party keep writing into somewhere the business has since
closed. Same instinct as a share link suspending itself, and there is a test.

**Emailed files arrive already filed**, not in the Inbox. A drawing sent to the
job folder should be *in* the job folder — routing it to an inbox for someone
to sort defeats the point of giving out the address.

## Open items

- **Tag colours are stored but never rendered.** `document_tags.color` takes a
  design-token name and the picker does not offer one yet, so every chip looks
  the same. Cheap to add; the column is already there.
- **No bulk tagging.** Tags are set one file at a time, which is tedious for the
  fifty photos that just came off a job. Multi-select in the browse list is the
  obvious follow-up.
- **Saved views cannot be edited or reordered** — `sort_order` exists and is
  always 0. Changing a view means deleting it and saving a new one.
- **A saved view pointing at a deleted folder or tag silently widens** rather
  than erroring: an unknown folder id resolves to no path, which the query reads
  as "no folder restriction". Honest degradation, but a view can quietly start
  matching more than its name implies.
- **No diff or preview between versions** — the history panel lists them and
  downloads any one, but comparing v2 to v3 means opening both. Real drawing
  comparison is an industry-pack concern (overlay, not text diff).
- **Nothing prunes version blobs.** Replacing a 40MB drawing ten times keeps all
  ten forever, and the per-file cap is the only bound on that. Same retention
  rule as everything else here, but versions make the storage bill grow faster
  than the file count suggests — a retention policy is the eventual answer.
- **A version cannot be deleted individually**, so a file uploaded to the wrong
  document is fixed by uploading the right one over it, leaving the mistake in
  the history. Trashing the whole document is the only eraser.
- **Letter-spaced headings come out split, and it is the space join's fault.**
  Running the backfill over the dev branch's real files extracted a Fulton
  Lumber invoice as `INV OICE Fulton Lumber & Supply, LLC …` — the generator
  emitted the heading as two positioned fragments, and joining fragments with a
  space is what stops `0042Kitchen` (see Decisions). So a designed heading may
  not match a search for the word it plainly shows. The impact is small in
  practice — `file_name` and `title` are weight A, the body text is fine, and
  the body is the part you cannot get any other way — but the fix is known: join
  on GEOMETRY instead, using each item's `transform` and `width` to suppress the
  space only when fragments literally abut on the same line. Deliberately not
  guessed at here, because tuning a gap threshold against a PDF written
  specifically to exhibit the problem is the fixture trap this module already
  learned once. It wants a handful of real files to tune against.
- **Scans and images are not read at all — and the size of that gap is now a
  number.** `text_extraction = 'empty'` is a supported type carrying no text
  layer, which is exactly the OCR population; `npm run docs:extract-text` prints
  the count. **Look at that number before paying for a model.** When it is worth
  doing, build it as a separate producer following
  `accounting/ai/extract.ts` properly (cooldown, one injectable network
  function, a per-tenant budget) consuming the `empty` queue — do NOT grow
  `text/extract.ts` a network branch. The cost bounds it will need and this pass
  does not: a page cap per document and a per-tenant spend ceiling, because a
  300-page scan and a 40MB photo are very different bills.
- **Word, PowerPoint and legacy `.doc`/`.xls` contents are not indexed.** OOXML
  is a zip and no zip reader is a declared dependency here; the legacy binary
  formats have no library worth the risk (the same argument that refuses
  SheetJS for previews). Recorded as `unsupported`, so it is countable rather
  than silent. A contract filed as `.docx` is findable by its name and not by
  its terms, which is the most likely first complaint.
- **A receipt uploaded through the Accounting capture path stays `pending`
  until someone runs the backfill.** Extraction is wired into the DMS upload and
  version actions only; accounting has its own `createDocumentRecord` and this
  PR deliberately did not reach across the module boundary. Receipts are not
  unsearchable meanwhile — the AI extraction's `vendorName` is indexed at weight
  B — but their full text arrives late and only on demand. Wiring it in is
  small; deciding whether accounting should depend on `documents/text/` is the
  actual question.
- **Nothing in the UI says why a file's contents are not searchable.**
  `describeTextExtraction` exists and returns a sentence for all six states, and
  nothing renders it. Somebody searching for text they can plainly see in a
  scanned permit currently concludes search is broken. Cheap to add to the row
  menu or the viewer; this PR stopped at the producer.
- **Only the CURRENT version's text is indexed.** Search finds the document, not
  the revision that said it, so a phrase deleted in v3 is unfindable even though
  v1 is still downloadable. The version rows hold the text to make that possible
  later; nothing queries them.
- **The backfill only fixes the CURRENT version row**, not historical ones — an
  older revision's text can only come from re-reading a blob the script does not
  walk. Those stay `pending` forever, harmlessly, until something wants them.
- **Extraction is inline, so a pathological file is a slow upload.** Bounded at
  20 seconds, 100 PDF pages and 25MB, and a failure never blocks the upload —
  but the person waiting pays the parse. A 100MB drawing set is refused outright
  as `too_large` even though the upload allowlist accepted it.
- **Previews download the whole file.** A PDF thumbnail parses the entire
  document to draw page 1, and an image tile is the ORIGINAL scaled by the
  browser — so a folder of 12-megapixel site photos downloads 12-megapixel site
  photos, lazily but fully. Fine for drawings and job photos on a desk; not
  fine on a phone tethered at a site. The fix is the same one for both:
  rasterise/resize once on upload, store the result as its own small blob, and
  serve that everywhere. It does not need a CSP change — just a rasteriser.
- **Word and PowerPoint cannot be previewed**, only downloaded — there is no
  equivalent of exceljs for them that is worth the dependency. The viewer says
  so plainly rather than showing a broken frame. Legacy `.xls` is refused with
  its own message.
- **A spreadsheet preview shows values, not formatting.** No number formats, no
  cell colours, no merged cells, no column widths: `1234.5` where Excel shows
  `$1,234.50`. Deliberate — inventing a currency symbol from a guessed locale
  is worse than being plainly unformatted — but it means the preview is for
  reading, never for checking a total's presentation.
- **`document_settings` has no preview switch.** A tenant who would rather no
  spreadsheet contents be readable in-app cannot turn it off.
- **The remembered layout is per-browser, not per-account.** It is a cookie, so
  switching machines or clearing cookies starts from List again, and two people
  sharing a login do not share the setting. Fine for a display preference;
  worth knowing before someone reports it as a bug.
- **Drag and drop is mouse-only and moves one thing at a time.** No keyboard
  equivalent (the row menus remain the accessible path, and they do everything
  drag does), no multi-select, no touch support, and no drag between browser
  tabs. It is also absent from Inbox, Search and Trash — only Browse has it.
- **A dropped folder move has no optimistic UI.** The row stays put until the
  server responds and the page refreshes, which on a slow connection reads as
  the drop having failed.
- **No `doc_kind` facet yet** — the column exists and is an open taxonomy for
  industry packs ('drawing', 'permit', 'submittal'), but nothing sets or filters
  it. Tag, origin and folder facets closed 2026-07-25.
- **The OFL text is not vendored next to the fonts.** `fonts/NOTICE.md` names
  Noto Sans, its copyright and its licence with a canonical URL, but the SIL
  OFL requires the FULL text to travel with the font. Copy `OFL.txt` verbatim
  from the upstream Noto repository before this reaches anyone outside the
  business. It was deliberately not reproduced from memory.
- **A crash between rendering and recording leaks a blob.** The PDF is uploaded
  before the rows are written, so a failure in between leaves orphaned bytes —
  the same blob-janitor gap the rest of the module has. The reverse (a document
  row pointing at a blob that was never written) is impossible, which is the
  ordering that matters.
- **No regeneration.** `document_generations.values` stores what was merged, so
  re-rendering an old document from its recorded values is a small addition —
  but nothing does it, and there is no UI for correcting a typo other than
  generating a fresh one.
- **No template preview of a PUBLISHED version.** The editor always shows the
  draft (or the published body as a starting point); reading v2 while v4 is
  current means looking at the history list, which shows metadata only.
- **Only one page size and no letterhead.** Generation is LETTER with a plain
  footer. Per-tenant branding (logo, address block) is the obvious next step and
  is exactly what `document_settings` is for.
- **AI template drafting (plan PR 12) is unbuilt.** `document_settings` already
  carries the cooldown columns.
- **E-signature (plan PRs 13/14) is deliberately not started.** The plan flags
  legal review first and the reasons are real: several states mandate statutory
  lien-waiver forms and some require notarization, so an e-signed waiver can be
  void; ESIGN §101(c) consumer-disclosure mechanics plausibly apply to
  residential construction contracts; the certificate's assertions want review
  verbatim; and signed artifacts need a defined retention obligation before the
  first tenant churns.
- **Share links can be emailed, but nothing actually sends yet** — the outbound
  spine is built and `emailShareAction` uses it, but no sending domain is
  verified in Resend. See `docs/modules/email.md`.
- **No sender allowlist on folder addresses.** Anyone with the address can
  deliver. Restricting to particular sender domains ("only @acmesubs.com") is
  the obvious next control if one ever gets abused.
- **No notification when a file arrives by email.** It appears in the folder
  silently; nobody is told. That wants the outbound spine.
- **The activity feed shows the most recent 100 events and says so** — there is
  no paging into older history, and no export. A link hammered by a scanner
  will push real opens out of view.
- **Visitor codes cannot survive a `SHARE_SECRET` rotation.** `hashIp` is keyed
  by it, so rotating the secret (the emergency lever for leaked links) also
  re-pseudonymizes every future event: the same visitor gets a new code, and
  old and new events cannot be grouped. Correct, but surprising in a dispute.
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
