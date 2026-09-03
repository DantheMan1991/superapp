# Guides

> Tenant-facing how-to guides. A "?" on every dashboard screen opens the guide for that screen beside it, and `/dashboard/guides` lists every guide for the tools a business has switched on. Content is markdown under `docs/help/`, written for the client, with pack vocabulary resolved per tenant.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-09-03 — Inventory, in eight guides (`claude/inventory-guides`)

Second pack of the run, after `assets`. All seven screens plus an overview:
`overview`, `items`, `item`, `counting`, `count`, `what-it-is-worth`,
`deliveries-and-invoices`, `when-it-is-deducted`. No `**Area:**`, matching
Documents at ten rather than CRM at sixteen.

**The first feature where route precedence is load-bearing.** `item` claims
`/dashboard/m/inventory/*`, the same depth as the `/counts`, `/value`,
`/matching` and `/tax` tabs. An exact route beats a single wildcard, so each
tab keeps its own guide and everything else one level down is an item. The test
asserts all seven plus the two-levels-down fallback rather than trusting the
ordering to stay put.

**Vocabulary, split within one pack, deliberately.** `{{item}}` is written in
`items.md` for the table header and the empty states, because those are the
four places `InventoryModule.tsx` actually resolves it, and the literal
`Add item` on the same screen, because the button does not. `{{lot}}` is
written nowhere: the key is declared, the farm profile renames it to `Lot`,
and `labelFor` is never called with it anywhere in `src/`, so every screen says
`Batch` whatever a tenant asks for. Assets had the simple version of this
question; inventory has the split one, and the answer is the same. The guide
says what the screen says, and the pack bug is recorded.

Five agents, seven screens, roughly ninety distinct message strings per screen
group. The action-layer pass again paid for itself: `LedgerError` never enters
the pack error map, so a closed accounting period and an accountant posting
costed stock both surface as `Something went wrong saving that.`; the most
useful sentence in the matching flow is thrown under a code that discards it;
and the movement form is owner-gated over three member-level ops, directly
under a comment saying it is ungated. All recorded in
[inventory.md](inventory.md).

### 2026-09-03 — Assets, in three guides (`claude/assets-guides`)

Founder, after the CRM set: *"now start on the packs guides."* First of the
five built packs, taken in dependency order — `assets`, then `inventory`,
`livestock`, `production`, `retail` — so a later guide can link back to an
earlier one. `land` already has its six. `crops` is declared and unbuilt: no
`Component`, no route, so no guide, and that is the answer rather than a hole.

Three guides in `docs/help/assets/`: `overview` (the `**` fallback, Order 0),
`assets` (the list, 10), `asset` (one asset, 20). No `**Area:**` — three guides
do not need captioning. No new icons: `wrench` comes from the module registry,
which `guide-icons.ts` accepts alongside its own names, and every control icon
was already registered.

**A pack guide that deliberately uses no `{{placeholder}}`, which is new.**
`_TEMPLATE.md` says a pack guide must never hardcode a renameable word. Assets
declares `asset`/`Asset` and then never calls `labelFor` for it anywhere in
`src/` — about a dozen visible strings spell it out. Writing `{{asset}}` would
render *Add machine* next to a button reading `Add asset`, and since the help
panel rings a control by matching its text, the chip would stop pointing at
anything. **The rule assumes the pack reads its own label; when it does not,
the screen wins.** Recorded in `docs/modules/assets.md` as the thing to fix,
with a note that fixing it sweeps these three guides in the same PR. Expect the
same question on `inventory`, where `lot` is declared and resolved nowhere at
all and `item` is resolved only on the hub.

**Method, unchanged from Mail and CRM:** parallel agents inventory every screen
before a word is written. Three here — the list, the detail page, and the
action layer — and the action-layer pass is the one that pays: it found six
bugs the dossier did not have, including a disposal that doubles the
accumulated-depreciation figure on both screens and a depreciable asset with no
company that 500s the whole list. All recorded in `docs/modules/assets.md`.

**One trap worth writing down: spawn inventory agents with a type that can
write.** `Explore` has no Write tool, so a brief telling it to save notes to the
scratchpad fails silently and the agent improvises the entire inventory into its
final message — which lands in the parent's context instead of on disk, and is
lost outright if it obeys a "report only briefly" instruction at the end. Caught
mid-run and patched by messaging all seven agents still going.

`tests/guides.test.ts` gains an `it(...)` resolving both Assets screens plus the
overview fallback two levels down.

Not clicked through live: the pane's Clerk session is still expired.

### 2026-09-03 — CRM, in sixteen guides (`claude/crm-guides`)

Founder, after Mail merged: *"keep going."* Sixteen guides in `docs/help/crm/`
— `overview`, `records`, `views`, `new-record`, `record`, `timeline`, `tasks`,
`board`, `deal`, `new-deal`, `pipelines`, `fields`, `reports`, `report`,
`automations`, `duplicates` — captioned on the Guides page by the module's own
tab strip: Records, Follow-ups, Board, Pipelines, Fields, Reports, Automations,
Duplicates.

Two pairs share a route, the pattern Documents' `browse`/`file` set: `records`
and `views` both answer `/dashboard/m/crm`, and `record` and `timeline` both
answer `/dashboard/m/crm/records/*`. The earlier slug wins the "?" and links to
its partner. `tests/guides.test.ts` resolves all thirteen CRM screens, and the
Land test's old line asserting that `/dashboard/m/crm` has no guide now points
at a made-up module slug, so it survives every module getting guides.

Method as for Mail: six agents inventoried the module screen by screen (4,685
lines of notes, 131 recorded gaps), then one agent wrote each guide and a
second checked every quoted string, control variant, icon name and number
against the source. The checkers applied 116 corrections. This session settled
what they would not: link text is each target guide's own title, the reports
list stopped drawing the report screen's buttons, and four guides now say that
a custom number field cannot be filled in at all. **Stale within the day**:
the field was fixed and those four guides now describe what it takes. See
[crm.md](crm.md).

Six icon names joined `guide-icons.ts` — `archive`, `archive-restore`,
`calendar-days`, `unlink`, `user-round` — so the facsimiles stop approximating
the glyph the screen draws.

Not clicked through live: the pane's Clerk session is still expired. What the
inventories found is recorded in [crm.md](crm.md).

### 2026-09-03 — Mail, in thirteen guides (`claude/mail-guides`)

Founder, straight after Documents merged: *"keep going."* Thirteen guides in
`docs/help/email/` — `overview` (the `**` fallback), `mailbox`, `sorting`,
`message`, `search`, `compose`, `templates`, `signature`, `rules`, `filing`,
`away`, `records`, `connect` — grouped on the Guides page under Reading,
Writing, Rules and replies, Records and Setting up.

Mail is the module the route grammar's query conditions were written for: one
path, `/dashboard/m/email`, and every view a parameter on it. So the routes are
`?message`, `?q`, `?compose`, `?templates=1`, `?signature=1`, `?rules=1`,
`?autofile=1`, `?away=1` and `?setup=1`, and `tests/guides.test.ts` resolves
all of them. Two pairs share a route on purpose, as Documents' `browse` and
`file` do: `mailbox` and `sorting` both answer the bare route, and `message`
and `records` both answer `?message`. The earlier slug wins the "?" and links
to its partner.

Method, since the module is about seven thousand lines of UI: seven agents in
parallel inventoried it screen by screen (5,074 lines of notes in the
scratchpad), then one agent wrote each guide and a second checked every quoted
string, control variant, icon name and number against the source and fixed what
it found. The checkers applied 103 corrections and reported what they judged
wrong but would not fix alone, which is where this session's editing went:
link text is now each target guide's own title, the Write button draws the pen
the screen really uses, and the claims about the poller, the accountant and the
filing sweep say what the code does rather than what reads well.

Five icon names joined `guide-icons.ts`: `arrow-down`, `arrow-up`,
`image-plus`, `pen-square`, and with them the mail toolbar's icon-only buttons
can be drawn as themselves. `pointTo` already matches `aria-label` and `title`,
so a facsimile of an icon-only button still rings the real control.

Not clicked through live: the pane's Clerk session is still expired, and only
the founder can sign in. What the inventories found and the guides state as
fact is recorded in [email.md](email.md).

### 2026-09-03 — Documents, in ten guides (`claude/documents-guides`)

Founder: *"start on documents."* Ten guides in `docs/help/documents/` —
`overview` (the module root and the `**` fallback), `browse`, `file`,
`inbox`, `search`, `tags`, `templates`, `template`, `shares`, `trash`
— written straight to CONTROLS, VOICE and SHAPE from three exhaustive screen
inventories (about 2,000 lines, taken by three agents in parallel before a word
was written) and the dossier's decisions and open items. `browse` and `file`
share `/browse` and `/browse/*` on purpose: the viewer is a dialog, not a
route, so the "?" shows the Browse guide, which links to the file one. The
public share page has no guide (it is outside `/dashboard`); what a recipient
sees is described in `shares`. Twenty-three icon names joined
`guide-icons.ts` for the controls these screens draw. Not clicked through
live: the pane's session is still expired.

Things the inventories found that the guides state as fact rather than
promise, and which [documents.md](documents.md) now records: the Inbox shows
only the newest fifty unfiled files and has no paging; typing a tag's name into
Search finds nothing (tags are a facet, though the page's own description says
"and tags"); the Shared links page shows `Active` for a link whose file was
trashed or made owners-only; a view limit on a link exists in the schema and
has no control; the viewer's fallback sentence calls a `.txt` a file that
"opens in the app on your computer"; a generated PDF's contents are not
searchable until the backfill runs; the templates count stops at fifty; the
editor's preview renders tables that the PDF prints as text.

### 2026-09-03 — The Guides page in cards (`claude/the-guides-page-in-cards`)

Founder, with a screenshot of the Guides page after the sweep: *"It is not
laid out very well. just kind of one long list with no seperation per guide
item."* The page had stacked every guide of a feature in one divided list,
and Accounting's thirty-five read as a wall.

- **Each guide is a tile** — the Overview's module tile, with the guide's
  title and a three-line summary — in a grid of three on a wide screen. A
  feature is a heading row (its icon in its own colour, its name, its count)
  over its grid; a fixed section is just its grid.
- **A feature with many guides captions them by `Area`.** A new optional
  header field, `**Area:**`, read by `parseGuide` and grouped by
  `guideAreas` (uncaptioned guides first, then areas in the order their
  guides appear). The thirty-four accounting guides carry the accounting
  menu's own words — Banking, Inbox, Sales, Purchases, Chart of Accounts,
  Journal, Recurring, Reports, Trial Balance, Close, then Companies — and
  were renumbered to the menu's order, so the page reads like the screen. The
  overview leads uncaptioned. A test requires an area on every accounting
  guide but the overview, so a new one cannot land ungrouped.
- Not seen live: the pane's session is still expired. The tile is the one
  the Overview already draws, so its look is not in question; the grid and
  the captions are.

### 2026-09-03 — The sweep, fourth area: Reports, Close, Companies, Recurring (`claude/sweep-accounting-reports-and-close`)

Twelve accounting guides rewritten to CONTROLS, VOICE and SHAPE — `reports`,
`profit-and-loss`, `balance-sheet`, `general-ledger`, `cash-activity`,
`ar-aging`, `ap-aging`, `sales-tax`, `close`, `close-record`,
`companies`, `recurring` — the last of the 48. Facts carried over from the
verified first drafts; the looks from the reports-and-close inventory (the
verdict badges `In balance` success and `Out of balance` destructive, an
aging report's `overdue` destructive and `Nothing overdue` success, a close
`Completed` success and `Reopened` secondary, `Closed through` secondary
and `Books open` outline, a company's `Default` secondary and `Inactive`
outline, a template's kind outline, `posts automatically` primary, `paused`
outline, `template needs fixing` and `failing` destructive). With this PR
every guide in `docs/help/` follows the same rules. Not clicked through
live; the pane's session is still expired.


### 2026-09-03 — The sweep, third area: Banking and the ledger (`claude/sweep-accounting-banking-and-ledger`)

Ten accounting guides rewritten to CONTROLS, VOICE and SHAPE — `banking`,
`register`, `import-statement`, `reconcile`, `bank-rules`,
`chart-of-accounts`, `journal`, `new-entry`, `entry`, `trial-balance`.
Facts carried over from the verified first drafts; the looks from the
banking-and-ledger inventory (a connected feed's `connected` is the success
tint and `reconnect needed` destructive; `closed`, `Off` and `Suggested`
outline; `Active`, `in progress`, `completed` and `system` secondary;
an entry's `posted` primary, `draft` secondary, `void` outline; the trial
balance's `In balance` success and `Out of balance` destructive). A register
row's `unreviewed` and `excluded` status words stay chips, because the
inventory did not record their tint. Not clicked through live; the pane's
session is still expired.

### 2026-09-03 — The sweep, second area: Purchases, the Inbox and Sales (`claude/sweep-accounting-purchases-and-sales`)

Twelve accounting guides rewritten to CONTROLS, VOICE and SHAPE —
`overview`, `new-bill`, `bill`, `vendors`, `inbox`, `document`,
`invoices`, `new-invoice`, `invoice`, `customers`, `catalogue`,
`reminders`. Facts carried over from the verified first drafts; the looks
come from the purchases and sales inventories (bill stages: draft outline,
awaiting approval secondary, approved and partial primary, paid secondary,
void outline; invoice stages: draft secondary, issued and partial primary,
paid and void outline; Inbox rows: the total secondary, the date outline,
`Not read yet` outline, `Couldn't read` destructive). An icon-only control
is drawn as its icon in the prose — the {icon:undo} that unapplies a bill
payment, the {icon:pencil} that edits a vendor — because a drawn button with
a label the screen never shows could not be pointed at. Not clicked through
live; the pane's session is still expired.

### 2026-09-03 — The sweep, first area: Workspace, Business, Settings, Land (`claude/sweep-workspace-and-land`)

Founder, on the two exemplars: *"the exemplars are good, sweep the rest."*
Fourteen guides rewritten to CONTROLS, VOICE and SHAPE — `workspace/what-needs-you`,
`business/hours` and `team`, the five `settings/` guides, and the six
`land/` guides. Every fact is carried over from the verified first drafts;
what changed is the voice (second person, imperative, American English), the
shape (What you see, How to <task>, Messages, Not on this page, Who can do
what) and the controls (drawn buttons and badges with the look the inventory
recorded, chips for everything else the reader looks for). A badge whose
tint the inventory did not record is quoted as a chip rather than drawn in a
guessed color — the payments statuses, for one. A marker whose label carries
a placeholder (`{button:Add {{zone|lower}}|outline}`, eight of them, all in
Land) is resolved before the renderer sees it, and the on-disk marker test
now resolves placeholders before it scans, so the braces inside cannot hide
a bad look from it. Not clicked through live: the browser pane's session is
still expired. The remaining 34 accounting guides follow in three PRs.

### 2026-09-03 — Every chip points (`claude/every-chip-points`)

Founder, ten minutes after #354 deployed, with the Bills guide's status pills
in a screenshot: *"all of these pills are buttons on the screen but the guide
doesn't point to them."* The first cut made only a drawn `{button:…}` live;
a quoted label in backticks was an inert chip, and the pills, tabs, tiles and
column headers a reader most wants located are quoted labels. Now every chip in
the panel is a button (`GuideChip`, rendered by `Markdown` for inline code
in guide prose) that calls the same pointer. The match is ranked so the
`Bills` pill beats the `Bills` page title: an exact match on something
clickable, then on a label, heading or badge, then a prefix match on each,
reading `innerText` so a tile's "Overdue 0.00 3 bills" is found from
`Overdue`; hidden elements never match. Authors change nothing: backticks
were already the rule for a control the reader looks for by its text.

### 2026-09-03 — Real buttons in the guides (`claude/real-buttons-in-the-guides`)

Founder, with a screenshot of the rendered "Getting around" page: *"They are
hard to read. Formatted weird etc. I think we need to have like actual button
images to reference each feature … I even think the way some things are worded
are a little off."* Three problems, three fixes, and two guides rewritten as
the exemplar for the other 48.

- **The backticks were real.** The typography plugin paints a literal backtick
  before and after inline code, and the guides quoted every label in
  backticks, so a client's page was peppered with them. `.guide-prose`
  (globals.css, unlayered so it beats the plugin) removes them and draws a
  quoted label as a chip in the app's own face. The build record keeps its
  monospace: `Markdown` takes `flavor="guide"` only from the guide page and the
  help panel.
- **Controls are drawn by the components, not photographed.**
  `{button:New bill|primary}`, `{badge:Overdue 3 days|destructive}`,
  `{icon:calculator}`, `{kbd:Ctrl+K}` — a remark plugin
  (`remark-guide-controls.ts`) turns the markers into `<guide-control>`
  elements and `GuideControl` renders the real `Button` and `Badge` one size
  down. A screenshot of a button rots with the next design sweep; the
  component cannot. The grammar lives in `guides-core.ts`, and a test over the
  real tree refuses a modifier it cannot place or an icon nobody registered
  (`guide-icons.ts`).
- **The panel points at the screen.** Inside the help sheet a drawn button is
  live: click it and the real control scrolls into view and is ringed
  (`.guide-target`), matched by the text the reader sees, so no screen needed
  marking up. A control that is not on the screen right now (inside a dialog,
  owner-only) says so in a toast.
- **Voice and shape, written down.** `_TEMPLATE.md` gains CONTROLS, VOICE
  (talk to the reader and tell them what to do; American English; quote only
  what they must recognize; no words from our side of the glass) and SHAPE
  (opening paragraph, What you see, How to <task>, Messages, Not on this page,
  Who can do what). `workspace/getting-around` and `accounting/bills` are
  rewritten to it as the exemplar. The other 48 guides follow once the founder
  has judged these two.

### 2026-09-02 — Accounting, fourth area: Reports, Close, Companies, Recurring (`claude/accounting-guides-reports`)

Twelve guides in `docs/help/accounting/` — `reports`, `profit-and-loss`,
`balance-sheet`, `general-ledger`, `cash-activity`, `ar-aging`, `ap-aging`,
`sales-tax`, `close`, `close-record`, `companies`, `recurring` — from the
reports-and-close inventory. Same bar, same method. Things the inventory found
that the guides state as fact: the report controls are a GET form, so a run is
a bookmarkable address; the consolidated scope is offered on three reports and
answered with a 404 on the other four, so each guide says which; the General
Ledger is accrual-only and stops at 5,000 lines with a notice on screen and an
`INCOMPLETE` first row in the file; the two aging reports and the sales-tax
summary have no export, and the books export lives on the Close page; a close
never blocks on its checklist; Reopen is offered only on the latest completed
close of the selected company; a company can be deactivated but never deleted;
a recurring template has no delete and no cadence but monthly. The General
Ledger page, which the accounting dossier had carried since 2026-08-12 as
never rendered by a signed-in person, was opened by hand as part of this
area's check and showed Hilltop Farm's September lines with running balances.

### 2026-09-02 — Accounting, third area: Banking and the ledger (`claude/accounting-guides-banking`)

Ten guides in `docs/help/accounting/` — `banking`, `register`,
`import-statement`, `reconcile`, `bank-rules`, `chart-of-accounts`, `journal`,
`new-entry`, `entry`, `trial-balance` — from the banking-and-ledger inventory.
Same bar, same method. Things the inventory found that the guides state as
fact: the live bank feed's button only renders when the deployment carries
Plaid keys, so the guide leads with CSV import; balances on the Banking page
are combined across companies on purpose; the only statuses a transaction can
show are `unreviewed`, `posted` and `excluded`; a rule beats the assistant and
only the rule's chip is shown; ticking a line in a reconciliation locks its
entry at once; the trial balance has no export of its own. On banking and
journal actions the accountant role's refusal never reaches the screen (the
gate sits outside the try), so those guides say "a save does not go through"
rather than quoting the sentence.

### 2026-09-02 — Accounting, second area: Sales (`claude/accounting-guides-sales`)

Six guides in `docs/help/accounting/` — `invoices`, `new-invoice`, `invoice`,
`customers`, `catalogue`, `reminders` — from the sales inventory taken with the
other three. Same bar, same method. Things the inventory found that the guides
state as fact: the invoice page hides its write buttons from staff and
accountants (only PDF and Print remain), where the bill page shows them and
refuses on press; the Send dialog has one field, the address, and the wording
is fixed; a saved item and a payment term cannot be edited, only deactivated
and re-added, while a tax rate can; the customer form has no default terms and
no tax-exempt flag, so the guide says terms and tax are set per invoice. The
`/sales` and `/sales/recurring` routes are redirects and get no guide of their
own.

### 2026-09-02 — Accounting, first area: the Overview, Purchases and the Inbox (`claude/accounting-guides-purchases`)

Founder, after merging #349: *"go ahead with accounting."* Accounting has 37
routed screens, so it ships in four review-sized PRs by area. This is the
first: seven guides in `docs/help/accounting/` — `overview` (the module root and
the strip, `/dashboard/m/accounting/**`), `bills`, `new-bill`, `bill`,
`vendors`, `inbox` and `document`.

- **Written from four exhaustive screen inventories** taken up front (purchases
  and receipts, sales, banking and ledger, reports/close/companies/recurring —
  about 2,500 lines of notes), so the remaining three PRs write from the same
  source without re-reading the module.
- **The overview stays generic about which guides exist.** An earlier draft
  listed them, which made the file a merge conflict for every later area; it
  points at the Guides page instead.
- **Role gating is stated per button**, because on these screens nothing is
  hidden from the accountant role — the buttons render and the refusal comes
  on press — and staff see `Submit for approval` where an owner sees `Approve`.
- **Things the inventory found and the guides state as fact rather than
  promise:** a draft bill cannot be deleted and an approved one cannot be
  edited (the actions exist with no UI caller); there is no tax on a bill by
  design; the Inbox has no company picker on purpose; the `Read` button only
  offers itself for an unread or failed document.

### 2026-09-02 — The manual, not the summary (`claude/the-manual-not-the-summary`)

Founder, having read the two guides that shipped with the plumbing: *"they are
not near detailed enough."* They had been written as proof that the pipeline
worked, from the few files read to build it. The bar he set, and agreed: **one
guide per screen, covering every control on it — every field, column, filter,
status word and message, and what happens next — written from every component
the screen renders.** The two areas were rewritten to it first, as the
exemplar, before accounting.

- **Fifteen guides replace two:** `workspace/` (getting-around,
  what-needs-you), `business/` (hours, team), `settings/` (business-settings,
  email-setup, billing, taking-payments, lines-of-business), `land/` (overview,
  parcels, parcel, site-plan, zone, find-my-parcels). Every quoted string was
  read from the component that renders it, via three exhaustive inventories of
  the screens (about 2,000 lines of notes) taken before a word was written.
- **The bar is written down** in `docs/help/_TEMPLATE.md` (DEPTH) and in
  AGENTS.md, so it binds every guide from here.
- **Two guides share a route on purpose.** `land/parcel` and `land/site-plan`
  both declare `/dashboard/m/land/*`; the tie goes to slug order, so the "?"
  shows the parcel guide, which links to the site-plan one. The site plan is a
  screen's worth of controls on its own and deserved its own page; a tie broken
  deterministically is the mechanism that lets a page be split.
- **An exact route now beats a `**` subtree at the same depth.** The first
  real tree exposed it: `land/overview` (`/dashboard/m/land/**`) and
  `land/parcels` (`/dashboard/m/land`) tied on three literals, and the tie went
  to the earlier slug, so the list screen opened the overview. `specificity`
  carries an exactness term second, after literals — pinned by a unit test.
- **Two Land defects fixed,** because the guide could not truthfully describe
  the screen otherwise — see [land.md](land.md): `Which paddock am I in?`
  navigated to a route that does not exist, and the boundary summary's "the
  site plan" link pointed at an anchor nothing carried.
- **What the inventories said a guide must not promise** — features never
  driven on real hardware, provider states never reached, the vocabulary and
  unit settings a tenant cannot change themselves, the morning email's
  delivery — is written as "ask us", stated as what the system does, or left
  out. Never described as observed.

### 2026-09-02 — The plumbing: reader, routes, panel, vocabulary (`claude/guides-plumbing`)

Founder, 2026-09-02: *"I think we need a how to page on how to use all of the
modules and packs in Yosher App … as well as in each module there should be
like a how to tab or something that pulls up just the how to for that specific
page or tool. There should be screen shots etc."* Two calls after the
assessment: content lives in the repo, and the guide is in-app only. This PR is
the machinery and two guides that prove it; the guides for each module follow,
most-used first (accounting's core loop, documents, mail, CRM, the packs, then
scheduling and work, which nobody has clicked through yet, so writing theirs is
also the first real walkthrough).

- **`docs/help/<folder>/<topic>.md` is a guide.** Same header shape the build
  record already parses — `# Title`, a blockquote summary — plus `**Route:**`
  (where the "?" finds it) and `**Order:**` (where it lists). The folder is a
  feature slug or a fixed section (`workspace`, `business`, `settings`).
  [`docs/help/_TEMPLATE.md`](../help/_TEMPLATE.md) is the contract for authors.
- **A panel keyed to the page, not a tab per module.** Accounting alone has 37
  screens; a module-level tab is a 37-section document that moves the reader off
  the screen they are learning. `HelpButton` sits first in `PageHeader`'s
  actions row, so every page that uses the header has it, and computes its key
  from the pathname and query string at click time.
- **Routes are exact by default; `**` asks for a subtree.** With prefix
  matching, "Getting around" (`/dashboard`) would have answered for every
  accounting screen with no guide yet. A wrong guide is worse than "no guide
  for this screen yet".
- **Vocabulary.** `{{zone}}`, `{{zone|plural}}`, `{{zone|lower}}`,
  `{{zone|plural|lower}}` — resolved from `ctx.tenant` with no query (the
  sidebar's device), tenant-wide, applied to title, summary and body. The
  plural rule is the sidebar's: a word nobody renamed keeps its declared plural,
  a renamed one takes an `s`. `|lower` was not in the plan; the first pack
  guide needed it in its first paragraph, because the resolved word is
  capitalised and the screens themselves lowercase it mid-sentence.
- **Two guides shipped:** `workspace/getting-around` and `land/overview` — the
  second uses placeholders and a relative link, so the pipeline is proved end to
  end. Every other feature lists as "No guide yet", which is the honest state.
- **Six pages joined `PageHeader`** — hours (twice), team, billing, email,
  settings, taking payments — because they had kept the hand-written heading the
  design-system dossier said was gone, and a button placed in the header reached
  none of them. Mail's connected view has its own bar and got the button by hand.
- **Fixed in passing:** relative links between build docs 404ed (the shared
  `Markdown` rewrites them); production traced only `docs/modules`, so
  `/admin/docs` was missing four sections when deployed; the `[slug]` tracing
  key had never matched anything.
- **CI carve-out:** `docs/help/**` no longer skips the workflow, because a
  guide is product content that `tests/guides.test.ts` reads.

## Data model

None. Guides are files in the repository, read at request time. Nothing is
stored in the database, and a tenant's vocabulary is read from the row
`requireTenant()` already loads.

## Key files & seams

| File | Role |
| --- | --- |
| `docs/help/**` | The guides. `_TEMPLATE.md` documents the header, the route grammar and the placeholder grammar |
| `src/lib/markdown-meta.ts` | Pure header parser shared with the build record; `resolveDocLink` |
| `src/lib/markdown-tree.ts` | The walker both readers use; `skipTopLevel` is how build-docs ignores `help/` |
| `src/lib/guides-core.ts` | Pure: route grammar and matching, `parseGuide`, vocabulary, the index shape |
| `src/lib/guides.ts` | Server-only: reads the tree, memoises it in production, resolves a tenant's vocabulary, gates by enablement |
| `src/components/app/markdown.tsx` | The shared renderer (admin docs, guide pages, the help sheet) |
| `src/components/app/help-button.tsx` | The "?" and its sheet; rendered by `PageHeader` and by Mail's bar |
| `src/app/api/help/route.ts` | `GET /api/help?path=&search=` → the localised guide for a screen, or null |
| `src/app/dashboard/guides/` | The index and the guide page |
| `next.config.ts` | `outputFileTracingIncludes` for `/dashboard/guides` and `/api/help` |
| `tests/guides.test.ts` | The grammar, the matching, the vocabulary, and the checks over the real tree |

## Decisions & gotchas

- **A guide is the manual for its screen, not a summary.** One per screen,
  every control, every message, what happens next, written from every component
  the screen renders and checked against the running screen. The founder set
  this bar on reading the first two guides; `_TEMPLATE.md` (DEPTH) carries it.
  Writing to it is also a bug-finding pass — the first two areas turned up two
  dead ends in Land.
- **A control in a guide is the component, not a picture of it.** `{button:…}`
  and `{badge:…}` render the app's own `Button` and `Badge`, so a guide
  can never show a control the screen no longer draws, and in the panel the
  drawn control points at the real one. Screenshots stay deferred for the same
  reason they always were: they rot, they double for dark mode, and a client's
  data must never be captured. If pictures are ever wanted, one orientation
  image per guide is the most that makes sense.
- **The panel docks; it does not cover.** The first version was a modal
  sheet, and the by-hand check of the pointer showed why that could not stay:
  a page's actions live at the top right, exactly where the sheet sat, so the
  ringed `New bill` was behind the panel and the page was dimmed and blurred.
  The sheet is now non-modal (no overlay, no focus trap, outside clicks left
  alone) and `.help-docked` pads `<main>` by the panel's width, so the page
  reflows beside the guide and stays clickable. Escape and the X close it;
  navigating away always did.
- **A quoted label is a chip, not code, and in the panel it points.** Only for
  guides (`flavor="guide"`); the build record keeps monospace, because there a
  backticked word usually is code. In the help panel the chip is a button that
  rings what it names, ranked clickable-first so a pill beats a heading.
- **The index is tiles under captions, not a list.** A list of fifty summaries
  is a wall; a grid of tiles with the feature's own menu words as captions is a
  map. The caption comes from the guide (`**Area:**`), not from code, so a
  feature's authors decide its grouping and a guide can move areas with a
  one-line edit.
- **A GET route, not a server action.** `PageHeader` is imported by five
  client files; a `"use server"` module reached through it would put an action
  reference into every page's client manifest, and this repo has already had a
  `use server` export break module toggling with every check green. A read that
  returns prose is a GET, guarded like every other route: `resolveTenantContext()`
  for the caller, then the enablement gate the module page applies.
- **The sheet's markdown loads lazily.** `next/dynamic` with `ssr: false` —
  the first in the codebase — because the button is on every page and a
  markdown parser in every page's bundle is the wrong price for a panel most
  visits never open. The pages import `Markdown` directly.
- **`useSearchParams` is not used.** It demands a Suspense boundary on any
  statically rendered page, and the public share page renders `PageHeader`. The
  button reads `window.location.search` at click time instead, and gates itself
  off outside `/dashboard` and on the Guides pages themselves.
- **Memoised per instance in production only.** The files are traced into the
  deployment, so a module-level promise can never be stale: it lives exactly as
  long as the code it describes. A data cache would outlive a deploy. In
  development every call re-walks the tree so an edit is a refresh.
- **`docs/help/` is skipped by the build-docs walker.** On `/admin/docs` a guide
  would appear as an unexplained "Help" section with its `{{vocabulary}}`
  unresolved. `tests/build-docs.test.ts` holds the line.
- **Tracing keys are substring globs.** Next matches `outputFileTracingIncludes`
  keys with picomatch in `contains` mode, so `/dashboard/guides` covers the
  guide pages beneath it and `/admin/docs` its catch-all. A bracketed key is a
  character class and matches nothing.
- **Nothing body-portalled inside the sheet.** It is a modal Radix `Sheet`; the
  mobile drawer's documented bug — a popover that paints but cannot be clicked —
  applies to it too.
- **Labels are tenant-wide, not per pack.** `zone` is Land's word that Livestock
  also displays; the vocabulary is one map from `tenants.labels` over the
  profile's, the same as `packContext` resolves it.
- **The guide gate mirrors the page gate.** A guide for a feature that exists
  but is not switched on for this tenant is a 404, and `settings` guides are
  owner-only — so a guide URL never describes a screen its reader cannot open.
- **The template is a hidden file.** `_TEMPLATE.md` starts with `_`, which the
  walker skips, so it can carry a real-looking header without becoming a guide.

## Open items

- **The sweep is complete once #356, #357, #358 and this PR are all merged.**
  Every guide then follows CONTROLS, VOICE and SHAPE. A guide written after
  that starts from `_TEMPLATE.md` and never from an older guide's shape.
- **Screenshots.** Deliberately none yet. Manual captures rot within weeks at
  the current rate of UI change (the design sweep of 2026-08-11 would have
  invalidated every one), and dark mode doubles the set. The plan is Playwright
  against a seeded tenant, regenerated when a UI PR lands, and only for the
  standalone guide page — the panel sits beside the real screen. Hilltop Farm
  covers pack screens; a neutral business tenant is still needed for core ones,
  and a client tenant must never be captured.
- Per-guide entries in the command palette (`CommandItem.keywords` is unused
  and is the field for synonyms).
- The other five inline `ReactMarkdown` call sites could adopt `Markdown`.
- Heading anchors and a table of contents for long guides.
- Mail's views (`?rules=1`, `?compose=new`, `?message=…`) have no guides yet;
  the route grammar already supports them.
- The content itself, in the agreed order: accounting's core loop, documents,
  mail, CRM, the packs, then scheduling and work.
