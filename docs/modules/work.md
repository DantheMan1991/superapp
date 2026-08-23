# Work

> What has to be done, who it is on, and whether it is done yet. One dataset of
> work items — a list, a board and a per-person "my work" are three views of it,
> never three containers. Layer 1 — industry-blind: a plumbing profile labels a
> work item a Service Call, a GC calls it a Project, a dental practice calls it
> a recall, and core learns none of those words.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

### 2026-08-18 — Work that was about itself (branch `claude/work-cannot-be-about-itself`)

First time anybody has driven this module. Opened an item, typed a word into
**What this is about**, pressed the search button — and the item's own title came
back as a candidate. Attaching it produced a chip on the item pointing at the
item, and **nothing refused it**.

- **The attach picker searches every enabled module, and Work is one of them.**
  That is the design working as intended — Work is both the HOST rendering the
  picker and a CONTRIBUTOR answering it, which is the round trip slice 5 exists
  for. What nobody had asked was whether the host should offer ITSELF.
- **The guard is in `attachLink`, not in the picker.** Layer 0's shared work
  actions reach that function from any module, so a rule enforced in the sheet
  is a rule the next consumer does not get — the same argument that put
  `assertNoForeignRegisters` in the posting engine rather than in each screen.
  `SELF_LINK` joins the error union; the message is "Work cannot be about
  itself."
- **`searchLinkTargets` takes an optional `excludeItemId`** so the choice is not
  offered either. Optional because the search is also reachable before there is
  an item to exclude; the engine refuses regardless.
- `tests/work-ops.test.ts` gains the case, beside the one that proves attaching
  a DIFFERENT work item still resolves through Work's own contributor — the two
  together are the boundary.

**What else the drive covered, and found nothing wrong with:** the list with its
urgency grouping (Overdue / Later / No date), state changes through the row
dropdown, the board with all five columns and its empty-state, the item sheet's
title/notes/dates/assignee, and the Lists page — where the default list
correctly has no archive control. An item added with a due date landed in the
right group and moved to In progress cleanly.

### 2026-08-15 — Layer 0 gains work ACTIONS, not just a write path (`claude/shared-entity-work`)
- `src/lib/work/actions.ts` — the entity-scoped verbs (add, done/reopen,
  reassign, re-due) as `"use server"` at Layer 0, callable by any module or
  pack.
- **Why it was missing and why that mattered.** The write path has been shared
  since slice 5a, but the only `"use server"` file was
  `src/modules/work/actions.ts` — and a module may not import another module, so
  every consumer wrapped its own subset. CRM wrapped two verbs; the assets pack
  was about to wrap a different two. The divergence was invisible until there
  were two consumers.
- **The guard is the OWNING feature, not Work.** `extensionSlug` names the
  module or pack the record belongs to, and that is what must be enabled. Work
  being switched off does not stop a follow-up being raised — the item simply
  has no second home to appear in.
- `expectedVersion` is threaded through, enforced the way CRM does it: an empty
  patch through `updateEntityWork` whose only job is to fail when the row moved.
- Rule recorded in [extension-model.md §4b](../extension-model.md).

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-08-10 — Slice 5c: `crm_tasks` is dropped (branch `claude/work-slice-5c`)

The table goes. Migration `0110`, and **it is the only migration in the repo
that must be applied AFTER its deploy rather than before it.**

- **conventions §4 reverses here, and the header says so at length.** Every
  other migration goes out ahead of the deploy so the running code keeps
  working; a DROP is the exception, because drizzle names every column of a
  table in the SELECT it builds, so running it early makes the PREVIOUS release
  answer `relation "crm_tasks" does not exist`. Nothing enforces the order —
  what makes it safe is that the wrong way round is loud and the right way
  round is harmless, which is `0075_accounting_contacts_contract`'s reasoning
  verbatim.
- **Applied to the dev branch and the suites re-run against a database that no
  longer has the table**, which is the only way to know the drop is really
  unreferenced rather than merely believed to be.
- **Four isolation tests went with it**, and one property genuinely did not
  survive the move — recorded where somebody will find it rather than deleted
  quietly. `crm_tasks`' policy BRANCHED: an attached follow-up inherited the
  record's visibility, so a follow-up on a RESTRICTED record was hidden from
  staff. A work item inherits its LIST instead. Production had zero restricted
  records when this shipped, so nothing changed hands, but the two models
  differ and a tenant needing the old behaviour puts that work in an
  owners-only list.
- `GroupableTask` replaced `CrmTask` in the pure timeline test too. Those
  functions never depended on the table — they read a shape, which the
  structural type now says out loud.

### 2026-08-09 — Slice 5b: CRM follow-ups become work items (branch `claude/work-slice-5b`)

The switch, in one deploy. Migration `0109` copies the rows, CRM writes and
reads work items, and **CRM's attention source is deleted** — those three
cannot be separated, because copied rows plus two registered sources reports
every follow-up twice.

`crm_tasks` still exists and is now read by nothing. Slice 5c drops it, after
this deploys (conventions §4).

- **The data copy preserves ids**, so a link is a straight join rather than a
  mapping table, a re-run is idempotent through the primary key, and any URL
  already bookmarked still points at the same obligation.
- **The entity type comes from `parties.kind`** — `person` → `contact`,
  `organization` → `company`. Verified against the dev branch with seeded rows
  before anything else was written, because this is the one error in the whole
  slice that fails silently: a wrong type resolves to nothing and renders as a
  deleted record.
- **`WorkReadCtx` and `WorkWriteCtx` exist because the helpers do not read what
  they were asking for.** A read only ever scopes by tenant, so CRM's
  `listTasksForParty(tx, tenantId, partyId)` kept its signature and **no page or
  component changed**. A write needs tenant and user but never `role` — and
  requiring it had already invited the automation engine, which does not carry
  the caller's role, to invent `role: "owner"`. Asking for exactly what is used
  is what stopped that.
- **Two silent-failure modes were found by a test failing for the wrong
  reason**, both created by this change and both now closed:
  1. A tenant with no default work list. CRM's automation runs each action in a
     savepoint and swallows failures so a broken rule cannot roll back the
     person's own work — so the rule would have created nothing, with no error
     anywhere. `createWorkForEntity` now provisions the list rather than
     throwing.
  2. **A rule naming somebody who is not a member.** `crm_tasks.assignee` was
     free text; Work validates against the roster, which is the fix crm.md
     asked for — but a validation error inside that same savepoint would have
     lost the follow-up entirely. An unknown name now falls back to
     *unassigned*, where the digest's owner rollup catches it. Losing the
     assignment beats losing the obligation.
- **The `/tasks` page redirects rather than 404ing**, and deliberately does not
  filter to CRM-linked work. `party_id` was nullable so "ring the accountant
  back" had a home; a filtered page would have dropped exactly those. What
  somebody came to that URL for — everything outstanding — is now the whole
  list across every module.
- **A merge relinks rather than rewriting a column.** `relinkEntity` drops the
  loser's link where the item already points at the survivor, so a merge cannot
  violate the unique index.
- `groupTasks`, `TaskToggle` and the timeline component are typed against a
  structural `GroupableTask` instead of the `CrmTask` row, which is what let the
  storage move underneath them without any of them being touched.
- **Two readers nearly survived the switch**, and "read by nothing" was briefly
  untrue: the follow-ups REPORT and the merge PREVIEW both counted `crm_tasks`
  in raw SQL, which greps for `crmTasks` do not find. Left alone they would not
  have crashed — they would have gone on reporting a frozen snapshot that
  stopped changing the moment the storage did, which is worse. Both now read
  `work_items`, and the report's `completed_at` became `closed_at`.

### 2026-08-09 — Fix: the version guard had a TOCTOU window (branch `claude/work-slice-5b`)

Slice 5a shipped `updateItem` reading the row, comparing `version`, then
updating. **That is not a compare-and-swap.** Postgres runs at READ COMMITTED,
so another transaction can commit between the SELECT and the UPDATE; the
comparison passes against data that is already stale and the write silently
overwrites the very edit the column exists to detect.

The version now goes in the `UPDATE … WHERE`, so the row either still carries
what the caller saw (one row updated) or it does not (zero). Zero rows is then
disambiguated with a follow-up existence check, so "somebody got there first"
and "it is gone" stay different messages.

**`crm_tasks` has done it correctly since CRM slice 1**, and reading it while
planning 5b is the only reason this was caught — no test failed, because a
TOCTOU window needs two concurrent transactions to expose and the suite runs
one at a time. Worth remembering the next time an optimistic version is added
anywhere: the check belongs in the predicate, never before it.

### 2026-08-09 — Findings that reshape slice 5b (not yet built)

Three things came out of planning it that the design above got wrong or did not
consider. Recorded here so the session that builds it starts from them.

1. **CRM registers `contact`, `company` and `deal` — not `crm_party` and
   `crm_deal`.** The data model section above names types that do not exist.
   Worse, `contact` and `company` are two types over the SAME `parties` table,
   so the migration has to read `parties.kind` per row to pick one. Writing the
   wrong string produces links that resolve to nothing and render as dangling
   chips, which is silent.
2. **`crm_tasks` holds UNATTACHED follow-ups**, and they have nowhere to go on a
   page filtered to CRM-linked work. `party_id` is nullable precisely so "ring
   the accountant back" has a home. A `/tasks` page showing only linked work
   would drop them without saying so; the likely answer is that the page
   redirects to Work and the record page keeps a section reading linked work,
   but that is a UI decision the founder should make rather than discover.
3. **The whole switch is one deploy and cannot be split.** Copying rows while
   CRM still reads the originals double-counts every follow-up in the digest.
   That rules out landing the shared helpers or the migration on their own as a
   warm-up.

Scope, for planning: 8 CRM ops rewritten, the record page and timeline
component, one page redirected, the automation `create_task` action, note
extraction, merge handling, CRM's attention source deleted, a data migration,
and five test files. All at once, on a module that is live.

### 2026-08-09 — Slice 5a: the shared write path, and a version column (branch `claude/work-slice-5`)

Prerequisites for the CRM migration. **Nothing user-visible; no behaviour
change.** Migration `0108` adds one column.

**SLICE 5 IS THREE PULL REQUESTS, NOT ONE.** Planning it revealed two things
the design in this dossier did not account for:

1. **CRM cannot import Work.** Module isolation forbids it, so CRM cannot call
   `src/modules/work/item-ops.ts` to raise a follow-up. The write path had to
   move to `src/lib/work/items.ts` first — the alternative was a second write
   path inside CRM duplicating every guard, which would drift within a release.
   `src/lib/schedule/` set the precedent.
2. **Copying `crm_tasks` into `work_items` while CRM still reads the originals
   would make one follow-up appear TWICE in the digest**, once from each
   source. So the copy and the deletion of CRM's attention source have to land
   in the same deploy. The dossier previously said the two sources would report
   different rows and nothing would double-count; that is true only until the
   copy happens, and this corrects it.

So: **5a** prerequisites (here), **5b** the switch — CRM writes and reads work
items, data copied, CRM's source deleted — and **5c** `DROP TABLE crm_tasks`,
which conventions §4 requires to go out AFTER the deploy that stops reading it.

- **`work_items.version` ships ahead of its reader**, deliberately. `crm_tasks`
  has carried an optimistic version since CRM slice 1, and arriving without one
  would silently drop a property follow-ups have today — two people editing one
  item would go back to last-write-wins. Documents' pattern: ship the column
  with the schema, not with the screen.
- **`expectedVersion` is opt-in.** A caller with nothing to be stale about (a
  rule firing, an import) omits it and gets exactly the behaviour every caller
  had before the column existed, so adding the guard changed nothing.
- **The bump is `version = version + 1` in SQL**, never read-then-write —
  read-then-write loses a bump when two writes interleave, which is precisely
  the collision the column exists to detect.
- `WorkError` and the state predicates moved to `src/lib/work/` beside the
  values they test, for the same reason as the write path. The module
  re-exports both, so no call site changed. `friendlyMessage` stayed in the
  module: turning a code into a sentence is presentation, and CRM may want
  different words.

### 2026-08-09 — Slice 4: the digest source, and the module goes live (branch `claude/work-slice-4`)

**The seed row flips to `available`.** No migration. One attention source, 10
source tests, 5 pure ones.

- **The module goes live when the obligation it creates can reach a person, not
  when the UI works.** Until this slice, work assigned to somebody was visible
  only to whoever opened the page — which is the failure notifications.md
  records verbatim: the digest shipped into a product where nothing set an
  assignee, so every staff member's digest was empty by construction.
- **Work is SECOND in the digest, ahead of CRM follow-ups.** It took the place
  follow-ups held, on the reason follow-ups held it — real assignee, real agreed
  date — and has the stronger claim, because closing the item IS the point of
  the record and because it covers the whole business rather than the part that
  happens to be a customer conversation. Scheduling still leads: it is the only
  section with a time attached.
- **Four things are deliberately not an obligation**: undated work (nobody
  agreed a date, so nothing has been missed), deferred work (`starts_on` ahead
  of today — being told about something you decided not to start is the
  definition of noise), closed work, and anything past the seven-day horizon the
  page's own "this week" section uses.
- **But BLOCKED work still nags, and that is a decision.** The tempting rule is
  that it should not, since the assignee cannot act. It nags anyway: the action
  is real — chase whatever is blocking it — and excluding it would let anybody
  silence a late item by setting a state. **A digest that can be switched off
  per row is one nobody can trust.** What the state earns is a mention in the
  detail line, so the reader knows why it has not moved.
- **The href is the item itself**, which only became addressable in slice 3. The
  contract asks for a deep link rather than a list precisely so the email is
  actionable without a round trip, and `?item=` is what supplies it. A slice
  that had shipped the digest before the sheet would have linked to a page and
  called it done.
- Reuses `urgencyOf` from `core/grouping.ts` rather than re-deriving the
  comparison, so the digest and the page can never disagree about what is
  overdue. The three-value `AttentionUrgency` is mapped from the page's
  five-value one, not asserted.

### 2026-08-09 — Slice 3: links both ways, and saved views (branch `claude/work-slice-3`)

The seam slice. Two tables (`0106`), six policies (`0107`), an item sheet, and
the isolation suite up to 18. **Work is now the first module that is both a HOST
and a CONTRIBUTOR of `entity-links`.**

- **The host/contributor combination has an edge eslint could not see, and it
  is now pinned.** The registry imports `work/links.ts`; the host half
  (`link-ops.ts`) imports the registry. The module-isolation rule is generated
  per MODULE, so making `work` a host exempted the whole directory — including
  the contributor file, which would then have closed the graph into
  `registry -> links -> registry`. JavaScript resolves a cycle by handing one
  side a half-built module, which surfaces as `undefined is not a function` at
  request time on one route. `contributorFileInHost` in eslint.config.mjs puts
  the non-host rules back for that one file, and the guard was **verified by
  adding the import and watching it fail**, not by assuming.
- **`work` was missing from `MODULE_SLUGS` entirely.** Three slices shipped with
  no isolation rule on `src/modules/work/` in either direction — it could have
  imported another module, and another module could have imported it. Fixed
  here. A new module belongs in that array in the slice that creates its
  directory.
- **A saved view is a stored query string, replayed.** `params` is text, not
  jsonb, which differs from `document_saved_views` without disagreeing with it:
  the shared decision is that a saved view replays the ONE query builder rather
  than being a second one reading a filter tree. Work's views already serialise
  to a query string, so storing exactly what the URL held keeps "a view is a
  parameter set" literally true. Safe only because `parseWorkView` is TOTAL —
  if that parse ever gains a throw, this column becomes a crash vector and the
  two must be reconsidered together.
- **Saved views are the first table here where read and write scopes differ**,
  and the first policy in the module to read `app_current_user()` — the user id
  `withWork` has carried since slice 0 for nothing. Four command-specific
  policies rather than one `FOR ALL`, because DELETE consults USING and never
  WITH CHECK (drizzle/0077's trap): a USING wide enough to read a colleague's
  shared view would be wide enough to delete it.
- **Authorship cannot be forged.** The INSERT policy pins
  `created_by_clerk_user_id` to `app_current_user()` rather than trusting the
  row, so a staff member cannot write a view that claims to be the owner's.
  There is a test.
- **`?item=` is not part of the view.** It says which sheet is open, which is
  not a filter — a saved view called "Overdue on site" that also reopened one
  particular item every time would be carrying somebody's accident forever.
- **The sheet is URL-driven, and that is what makes Work linkable at all.** A
  sheet opened by component state would have no href for another module's chip
  to point at, so `work_item` could not have been contributed.
- **The link policy does not check the linked record**, and cannot: the entity
  lives in another module's table under an open taxonomy with no whitelist, so
  there is nothing to join to. The check happens where it can — the
  contributor's `resolve()` runs in the caller's transaction, so a record RLS
  refuses simply does not come back and the chip renders as dangling. The link
  row is not the secret; the record is, and the record defends itself.

### 2026-08-09 — Slice 2: the list and the board, over one query (branch `claude/work-slice-2`)

Two drawings, one dataset. **No migration.** 12 view-param tests and two new
read-path tests.

- **The roadmap's acceptance test was "if this needs a second query builder,
  slice 1 built the wrong read path". It did not.** `listWorkItems` grew two
  filters (`states`, `q`) and both views call it unchanged otherwise. There is
  no per-view fetch and no board-specific query.
- **A view IS a parameter set** (`core/view-params.ts`): `display` decides how
  rows are drawn, every other field decides which rows there are. Documents
  settled the storage half of this already — a saved view is the same parameter
  set replayed as a URL, never a second query builder reading jsonb — so slice
  3 can save these with no change to the shape.
- **A board column is `state`, which is a column on the row, not a container.**
  Trello's board is its data model, so a card is *in* the Doing list and
  "everything assigned to me" is unaskable there. Here the two views are one
  query and a row is in both at once.
- **Work moves between columns by MENU.** conventions §8 and CRM's deal board
  both got there first: a real share of usage is one-handed on a phone, and
  dragging between columns that do not fit the screen is the one board
  interaction with no good touch story. A menu also names every destination.
- **The board overrides `openOnly` rather than obeying it**, because a Done
  column that is always empty is worse than no Done column. The cost is that
  the two closed columns are unbounded — recorded below as the second caller
  wanting the pagination that slice 0 already flagged.
- **`?view=mine|unassigned|list` from slice 1 is gone**, replaced by
  `display/who/list/state/open/q`. Slice 1's params were a mode; these are a
  filter set, and keeping both would have meant two ways to say one thing.
  Nothing had been clicked and the module is not sellable, so this cost
  nothing — and `/dashboard/m/work` with no parameters still means "my work".
- **"Unassigned" is now offered to everybody, reversing slice 1's owner-only
  rule.** The reasoning changed with the direction: the digest PUSHES
  unassigned work to owners because nobody asked for it, while a filter PULLS
  and a staff member choosing "Nobody" is asking what is going spare.
- **One row DTO and one set of row controls**, in `core/row.ts` and
  `components/item-controls.tsx`. Two DTOs over one query is how two views
  start disagreeing about what a row is, and duplicated controls are how one of
  them silently stops knowing about a new state.
- **A `%` typed into the search box is a literal `%`.** `ilike` patterns escape
  `%` and `_` before binding; an unescaped wildcard silently matches everything,
  which reads as "search is broken" rather than as a wildcard.

### 2026-08-09 — Slice 1: lists, items, and "my work" (branch `claude/work-slice-1`)

The module renders. Eight server actions, two client surfaces, 13 op tests and
7 pure ones. **Module registered in `src/modules/index.ts`, seed row added as
`coming_soon`** — a superadmin can switch it on for one tenant to try it, and
nobody is sold it. Slice 4 flips the row. **No migration.**

- **The module home is "my work", not a board.** The per-person view is what
  gets opened daily and the one that proves the shape; a board over a dataset
  nobody has populated proves nothing. Google Tasks' single good idea with the
  part that makes it useless to a business fixed — the rows are the workspace's
  work, assigned to a person, not a private per-account list.
- **The row's date badge is computed in the BROWSER, the section headings on the
  server.** crm.md carries this as an open item: a page rendered at 23:58 and
  read at 00:02 keeps calling tomorrow's work "today" until something unrelated
  re-renders. `today` is still the TENANT's day passed down — the browser's
  clock is never consulted, only its render timing.
- **An expert cannot be assigned work, and that is what keeps the loop closed.**
  Experts are read-only here as in CRM, Documents and Scheduling — so an expert
  who *could* be assigned work would be unable to mark it done.
  `listAssignableMembers` already excludes them, so `assertAssignable` leans on
  that rather than restating it, and a test pins it. crm.md records the gap this
  closes: there, any string could be written into an assignee column, producing
  work that appears in nobody's list and nobody's digest.
- **`setItemState` is the only way to change a state**, because `state` and
  `closed_at` are one fact across two columns and the CHECK refuses any write
  where they disagree. There is no "just set the state" path to write and no way
  for a later caller to invent one.
- **The parent cycle check lives in the op, not the database.** The CHECK only
  catches an item that is its own parent; A → B → A is two legal rows and one
  illegal graph, so `setParent` walks up from the proposed parent. The walk
  refuses to visit a node twice rather than trusting the data is already clean.
- **`WORK_COLORS` is in `core/colors.ts`, not `actions.ts`** — a `"use server"`
  file may export only async functions, and scheduling shipped a colour array in
  its actions file on 2026-08-08 and took the superadmin tenant page down in
  production. `tests/use-server-exports.test.ts` is the only thing in the
  pipeline that catches it; `tsc`, eslint, vitest and the build all pass it.
- **`updated_at` is now set by every op**, closing the open item slice 0 left:
  there is no trigger, so the first op that forgot would not have failed a test.
- The default list has no archive control in the UI at all. The action refuses
  it, and a button that always fails is worse than no button.

### 2026-08-09 — Slice 0: schema, RLS, the read path (branch `claude/work-slice-0`)

Two tables, four policies, **no SECURITY DEFINER helpers**, twelve isolation
tests. No UI, no module registry entry, no seed row — the module is still
`coming_soon` and slice 4 is what turns it on. Migrations `0104` (tables) and
`0105` (RLS).

- **Two tables, not the three the data model lists.** `work_lists` and
  `work_items`. `work_item_links` lands in slice 3 with the surface that reads
  it; a table with no reader is the speculative build this codebase avoids.
  Items ARE here, because the property slice 0 exists to certify — that item
  visibility INHERITS from the list — cannot be proven without both.
- **No policy cycle, and therefore no definer helpers.** Worth recording
  because the last two modules both needed them and the next reader will expect
  them: scheduling needed `app_owns_calendar()` (a calendar's owner may share
  it) and `app_is_attendee()` (being invited shows you an item without the
  calendar), and each closed a cycle. Work has neither rule — a list is visible
  to members or to owners, there is no per-person grant table to recurse into,
  and **the assignee is not a visibility term**. The graph is one edge:
  `work_items` → `work_lists` → nothing.
- **The read path redacts nothing, because there is no level that would need
  it.** Scheduling's `busy` and `titles` are partial redactions and RLS cannot
  return half a row, which is what `app_schedule_range()` exists for. Work has
  no such level, so the policies are the entire answer and
  `src/modules/work/read.ts` is a plain query builder. If a "titles only" level
  ever arrives, 0097 is the worked example — but nothing in application code
  should start deciding visibility before then.
- **`withWork()` exists from slice 0**, for the reason scheduling wrote down:
  0077 named the fix, CRM never built it and now repeats the options at 49 call
  sites under a header comment. It carries `userId` even though no policy reads
  it yet, so slice 1 does not have to revisit every call site to assign work.
- **The default list is per TENANT and rides along on membership sync.** That
  is a workspace-level row provisioned from a person-level event, which is odd
  and deliberate: it is the path every pre-existing tenant comes back through,
  exactly as `ensurePrimaryCalendar` does. Idempotent via the partial unique
  index, so the common case costs one no-op insert.
- **drizzle-kit generated a migration that cannot run**, again — every
  `ADD CONSTRAINT` before every `CREATE INDEX`, so the composite FKs referenced
  unique indexes that did not exist yet (Postgres 42830). 0104 is hand-reordered
  and says so in its header. This is a property of the generator, not of the
  schema: expect it on the next module too.
- **`rejects.toThrow(/constraint_name/)` does not test what it looks like it
  tests.** Drizzle re-throws as `Failed query: …` and the constraint name only
  survives on the pg error underneath, so the regex never matched and a bare
  `toThrow()` would have passed for a typo'd column just as happily as for the
  invariant. `tests/work.test.ts` walks the cause chain and names the
  constraint instead.
- **The state vocabulary is NOT in the schema file**, and moving it out was the
  last change before the PR rather than the first. `WORK_STATES` lives in
  `src/lib/work/vocabulary.ts` with no imports and no directive, because slice
  1's board renders those labels in the browser and importing them from
  `@/db/schema/work` would pull drizzle and every table definition into that
  bundle. documents.md wrote this up after `server-only` propagated through a
  type import; conventions §8 records the inverse, which took the CRM deal page
  down in production.
- **A test reads the CHECK back out of Postgres and compares it to
  `WORK_STATES`.** The constraint is SQL literals and the constant is
  TypeScript; neither can be generated from the other, so without this the
  first drift shows up as a state the app offers and the database refuses.
  Postgres rewrites `in (…)` as `= ANY (ARRAY[…])`, which is why the test parses
  `pg_get_constraintdef` rather than comparing strings.
- Verified against `pg_class` and `pg_policies` on the dev branch after
  migrating, per the drift rule: both tables `relrowsecurity` AND
  `relforcerowsecurity`, four policies, six CHECKs.
- **The isolation suite failed on its first run and passed clean on its second**
  — `Connection terminated unexpectedly` from the Neon driver, which took
  `crm.test.ts` down and skipped 34 tests behind it. `close.test.ts` did the
  same thing once and then passed 23/23. Recorded because a first-run failure in
  this suite is not automatically a real one, and the tell is an infrastructure
  error with no assertion attached.

### 2026-08-09 — Design settled, nothing built

Chosen as the next core tool after Scheduling finished (#96–#107). Nothing in
`src/` exists yet; this file is the design, and the roadmap at the bottom is the
slice order. Production is at migration **0103**, so slice 0 starts at 0104.

Why this and not the two `coming_soon` slots already seeded:

- **Messaging** overlaps Mail on its own seed description (email + templates
  ship today). Its genuinely new part is SMS, which is gated on A2P 10DLC brand
  and campaign registration per tenant plus a provider contract — weeks of
  external lead time and permanent per-tenant onboarding friction. That is an
  operations problem wearing a build problem's clothes.
- **Marketing** depends on CRM *and* Messaging, and is the least likely thing to
  close a sale.
- Work is the last piece of the operational spine that is industry-blind, and it
  is the thing the first Layer 2a pack has to stand on. Build `jobs` before core
  has a work primitive and the pack ships its own assignment, status and
  due-date machinery — then `dispatch` and `estimating` each reinvent them, and
  the digest can see none of it.

The name was a decision, not a default. **"Projects" and "Jobs" both fail the
neutrality test** and extension-model.md §8 already contains the receipt: "job"
is what electrical calls its work while plumbing says Service Call and a GC says
Project. Those are labels a profile supplies. "Tasks" is the Google/ClickUp word
and implies something small, which a three-day service call is not. "Work" is
what all three of §3's businesses call it.


## What this is, and what it is not

**It is** the answer to "what is on me today", held for the whole business
rather than per person, attachable to any record in the product.

**It is not** a project-management tool. There is no Gantt chart, no critical
path, no finish-to-start dependency with a lag, no workload capacity model, no
workflow engine gating state transitions. Those are pack vocabulary
(`src/packs/jobs/`) or they are nothing. scheduling.md already drew this line
for its own nesting column and the same reasoning holds here: nesting passes the
bookkeeper/dentist/plumber test, dependency edges do not.


## The reference products, and what each gets right

Read before proposing a feature — three of these four failure modes are
attractive and one of them is already half-built into this product's habits.

| Product | The one idea worth taking | The trap |
| --- | --- | --- |
| **Trello** | A board is legible with zero configuration. Nobody needs training. | **Status is the container.** A card is *in* the Doing list, so a card can be in exactly one board, and "everything assigned to me" cannot be asked at all. Every workaround (Butler, Power-Ups, cards duplicated across boards) exists to undo this one decision. |
| **Google Tasks** | The per-person list is the surface people actually open, and it is one screen with no chrome. Subtasks and a due date cover most work. | **Lists are per-account and private.** Nothing can be assigned to anyone, so it cannot hold a business's work — the moment somebody is on holiday, their obligations are invisible. |
| **Notion** | **A view is a saved projection over one dataset** — filter, group, sort — not a place records live. Table, board and calendar are the same rows read three ways. | Everything is configurable, so every tenant builds a different product. Support becomes archaeology and no two tenants can be shown the same screenshot. |
| **ClickUp** | Per-item time tracking belongs next to the item, and vocabulary (custom statuses, custom fields) has to come from somewhere. | Five container levels (Space › Folder › List › Task › Subtask) plus per-list custom statuses plus custom fields — the configuration surface *is* the product, and the first hour with it is spent in settings. |

What that resolves to here:

- **Status is a column, not a container** (fixes Trello). The board groups by it.
- **One container level: the work list** (fixes ClickUp's five). Depth comes from
  `parent_id`, which is free and needs no configuration.
- **A view is a URL** (takes Notion, refuses its config surface). Documents
  already settled this exact question — a saved view is the same parameter set
  replayed as a URL, never a second query builder reading jsonb. Work reuses that
  decision verbatim rather than re-deriving it.
- **"My work" is the primary surface** (takes Google Tasks), but the rows are the
  business's, assigned to a person rather than owned by an account.
- **Vocabulary comes from a profile or a pack, never a tenant settings screen**
  (takes ClickUp's need, refuses its delivery). See `state` vs `status` below.


## Data model

Three tables. Composite `(tenant_id, id)` unique indexes and composite FKs
throughout, per conventions §4 and every module since accounting.

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `work_lists` | The container, and the unit of sharing | **BUILT (0104/0105).** `visibility` is `members` \| `owners`, text + CHECK, default `members`. Policy is `document_folders`' shape exactly: `tenant_id = app_current_tenant() AND (visibility = 'members' OR app_current_tenant_role() = 'owner')`. **No `effective_visibility` column** — lists do not nest, so there is no ancestor chain to roll down. One list per tenant is auto-provisioned (`Work`), the way scheduling provisions a primary calendar. `archived_at`, never deleted |
| `work_items` | The unit of work | **BUILT (0104/0105).** Inherits its list's visibility through an `EXISTS` against `work_lists` — RLS applies inside policy subqueries, so the visibility term is written once and cannot drift (the trick 0024 documents for `document_versions`). Columns below |
| `work_item_links` | What a work item is about | **BUILT (0106/0107).** Modelled on `schedule_item_links`/`mail_links` **exactly**: `entity_type` carries a FORMAT check (`^[a-z][a-z0-9_]{0,62}$`) and **no value whitelist**, plus `extension_slug`. Inherits from the item. Registering a new linkable type needs no migration to core |

`work_items` columns that carry a decision:

| Column | Why it is shaped this way |
| --- | --- |
| `state` | `todo` \| `in_progress` \| `blocked` \| `done` \| `cancelled`. **text + CHECK, never a pg enum** — documents learned that a new enum value needs its own migration file, alone, because it cannot be used in the transaction that adds it (0036 vs 0037). Five values, all of which pass §3: a bookkeeper waits on a client, a dentist waits on a lab, a plumber waits on parts, and all three call that blocked |
| `status` | Open text, default `''`. **The LABEL, when a profile or pack supplies one** — "Dispatched", "On the way", "With client". Code reads `state`; a human reads `status` when set and the state's own label otherwise. This is the §3 pattern stated as two columns: core owns the mechanism, packs own the vocabulary. Core writes nothing here, exactly like `schedule_items.kind` |
| `closed_at` + `closed_by_clerk_user_id` | One fact, and a CHECK makes the pair agree with `state`: `(state IN ('done','cancelled')) = (closed_at IS NOT NULL)`. **Done and cancelled are both closed**, which is what every list query wants — open work is `closed_at IS NULL`, one indexable predicate rather than a `NOT IN` over a growing enum. `crm_tasks` proved the timestamp-pair half; the state agreement is the part it did not need |
| `due_on` | A **DATE**, not a timestamp. Work is due on a day, not at 14:32 — `crm_tasks` pinned this and CRM's own gotcha about comparing a `date` column against a server `Date` applies here unchanged. Something due at a time is an appointment, and appointments are scheduling's |
| `starts_on` | Nullable DATE. "Do not show me this until Monday." Without it a list of forty items either nags on day one or hides until it is late; with it the digest can skip anything not started. Google Tasks' most-requested missing field |
| `assignee_clerk_user_id` | Nullable, and **one assignee, not many**. The digest's per-person model needs a single owner of an obligation; two assignees means each can assume the other has it. Nullable because unassigned work is real — and the attention contract already carries an `unassigned` flag that rolls it up to owners, which exists precisely because work assigned to nobody is otherwise invisible to everybody |
| `parent_id` | Unlimited nesting, self-referencing composite FK, `ON DELETE SET NULL`, with a `no_self_parent` CHECK — `schedule_items`' arrangement copied deliberately. **A checklist is children**; there is no separate checklist table and there will not be one |
| `kind` | Open taxonomy, default `''`. Core writes nothing. `service_call`, `inspection`, `punch_item` are values a pack registers |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` so `metadata->>'x'` is always safe. Pack extension bag — progress, estimated hours, whatever a chart needs and a list does not |

The index that matters is the one "my work" runs:
`(tenant_id, assignee_clerk_user_id, due_on) WHERE closed_at IS NULL`.

**Not in v1, on purpose:** `priority` (nothing would read it — the digest orders
by due date and state, so it would be theatre on day one), manual `position`
(ordering by hand implies drag-and-drop, and conventions §8 plus CRM's deal
board already refused that), and watchers. All three are open items, not
oversights.


## Key files & seams

Built in slice 0:

- `src/db/schema/work.ts` — the two tables, and the comments that explain them.
- `drizzle/0104_slow_zemo.sql` — tables. **Hand-reordered; regenerating undoes it.**
- `drizzle/0105_work_rls.sql` — four policies, and the note on why there are no
  definer helpers.
- `src/lib/work/with-work.ts` — `withWork(ctx, fn)`. The only door onto the
  tables from a request.
- `src/lib/work/provision.ts` — `ensureDefaultWorkList` / `findDefaultWorkListId`,
  called from `upsertMembership` on both branches.
- `src/lib/work/vocabulary.ts` — the values `state` and `visibility` may hold.
  **No imports and no directive**, because the schema, a browser-rendered board
  and the migration's CHECK all need them and cannot share a module. Importing
  them from `@/db/schema/work` would drag drizzle into a client bundle.
- `src/modules/work/core/state.ts` — the labels, and the one function that
  decides whether a reader sees `status` or core's own word. Also no directive,
  for conventions §8's reason.
- `src/modules/work/read.ts` — the read path.
- `tests/isolation/work.test.ts` · `tests/work.test.ts` · `tests/work-core.test.ts`.

Built in slice 1:

- `src/modules/work/WorkModule.tsx` — the module home, "my work". Registered in
  `src/modules/index.ts`; seed row is `coming_soon`.
- `src/modules/work/actions.ts` — the eight server actions. **Only async
  exports**; schemas and colours live in `core/`.
- `src/modules/work/list-ops.ts` · `item-ops.ts` — the ops the actions call.
- `src/modules/work/core/grouping.ts` — urgency, pure, client-safe.
- `src/modules/work/core/errors.ts` · `core/colors.ts`.
- `src/modules/work/components/my-work.tsx` · `components/list-manager.tsx`.
- `src/app/dashboard/m/work/lists/page.tsx`.
- `tests/work-ops.test.ts` · `tests/work-grouping.test.ts`.

Built in slice 2:

- `src/modules/work/core/view-params.ts` — a view as a parameter set. The file
  slice 3's saved views will read; if a later view needs its own query builder,
  this was the wrong shape.
- `src/modules/work/core/row.ts` — the one row DTO both drawings render.
- `src/modules/work/components/item-controls.tsx` — the row controls, written
  once so the list and the board cannot drift.
- `components/work-list.tsx` · `components/work-board.tsx` ·
  `components/filter-bar.tsx` · `components/add-work.tsx`.
- `tests/work-view-params.test.ts`.

Built in slice 3:

- `src/modules/work/links.ts` — the CONTRIBUTOR. **Must never import
  `entity-links/registry`**; eslint pins that per file.
- `src/modules/work/link-ops.ts` — the HOST. This is the half that imports the
  registry, and why `work` is in `ENTITY_LINK_HOSTS`.
- `src/modules/work/saved-view-ops.ts` — named parameter sets. Nothing here
  parses `params`.
- `src/modules/work/components/item-sheet.tsx` — the surface links live on,
  opened by `?item=`.
- `src/modules/work/components/saved-views.tsx`.
- `drizzle/0106` (tables) · `drizzle/0107` (six policies).

Still to come, and where it goes:

- `src/modules/work/attention/source.ts` — the digest contribution (slice 4)
- `src/app/dashboard/m/work/` — the routes
- `src/db/schema/work.ts`, re-exported by the barrel

Three existing seams get used, and one of them differently from any module so far:

1. **`src/lib/entity-links/`** — Work becomes the third HOST (after mail and
   scheduling), which is what makes "a task about that invoice" work on day one
   with **zero new implementations**: the nine entity types across Accounting,
   CRM and Documents already exist.
2. **Work is also a CONTRIBUTOR** — a mail thread or a calendar event should be
   able to point at a work item. **No module has been both before**, and the
   registry's rule has a sharp edge here: only a host may import
   `registry.ts`, and eslint enforces that *by file name*. So `work/links.ts`
   (the contribution) must never import the registry, while the host code does.
   Two files, one direction each. Check this in the slice that lands links, not
   after.
3. **`src/lib/attention-sources/`** — Work registers a source and slots in
   **second**, behind scheduling. Scheduling leads because it is the only section
   with a time attached; Work goes ahead of CRM follow-ups because it has the
   same real assignee and a wider catchment.


## What builds on this

The reason to build Work before the first pack — each of these needs a work item
underneath it, and none of them should ship its own.

| Later thing | What it adds | What it needs from core |
| --- | --- | --- |
| **`jobs` pack** (Layer 2a, next) | A job is a work item `kind` with extra `metadata` fields and its own view | Item kinds, item fields, and a view seam — **exactly scheduling's deferred slices 6 and 7** |
| **`dispatch` pack** | Assign work to a person *and* a time window | Work items + scheduling's availability, which shipped in its slice 9 and has had no caller since |
| **`estimating` pack** | An accepted estimate becomes work items | Bulk create + links back to the estimate |
| **Time tracking** (core, the likely next tool) | Hours against a person and a work item | `work_time_entries (tenant_id, work_item_id)` and **nothing else** — zero core migration is the acceptance test |
| **Billing the work** | Billable work → invoice lines | Accounting's invoices exist; this is a link plus a query |
| **Recurring work** | "Service this unit every 90 days" | An RRULE. `src/modules/scheduling/core/recurrence.ts` already parses one — but **a module may not import another module**, so that file moves to `src/lib/` first, in its own PR |
| **Client portal** (much later) | "Here is what we are doing for you" | A visibility concept for one work item; the link to the party already exists |
| **Inspections, punch lists, checklists** | A template of children under a parent | `parent_id` + `kind`. No new primitive at all |

**The load-bearing observation:** the `jobs` pack needs item kinds, item fields
and a pack-contributed view — and those are precisely the three primitives
scheduling deferred in its slices 6 and 7, because shipping them with zero
implementors would have meant a seam nobody had tested. Work gives them a second
caller. Build them **once, here, in a shape scheduling then adopts** — a seam
with two users is the bar this repo set for itself.

**And one thing that must NOT build on this:** approvals. Accounting's
`awaiting_approval` bills already reach an owner through the attention source. If
Work also held an "approve this bill" item, one obligation would exist in two
places, disagree eventually, and the digest would count it twice. Obligations
that a module can already derive stay derived — see the attention contract's own
header on why an obligation is never stored.


## Decisions & gotchas

**Work is visible by default; a calendar is not.** Scheduling's containers are
private until shared, Work's are visible to members until restricted. That looks
inconsistent and is not: CRM already pinned the reason — *"a follow-up is the
business's work, not private correspondence, and whoever covers for somebody on
holiday has to see what is outstanding."* The mechanism copied here is
`document_folders`', not `schedule_calendars`', for exactly that reason.

**No grants table in v1.** `members` | `owners` covers "the owners' list" without
the machinery. If per-person work lists are ever needed, 0077's pattern is the
proven shape — and it carries two traps written into scheduling.md: the grants
table's policy must never read back into the container (Postgres policy
recursion kills the module), and `WITH CHECK` is not consulted for DELETE.

**An expert sees `members` lists.** They are not an owner, so an `owners` list
is hidden from them — identical to Documents, and consistency with a shipped
module beat inventing a third answer. A tenant whose outside accountant should
not see operational work puts it in an `owners` list. That is coarse; it is an
open item, not a surprise.

**`state` and `status` are not the same column twice.** The temptation is to
merge them into one open text field so a profile can define its own workflow.
Do not: the moment "done" is a string a tenant chose, no query in the product
can ask whether work is finished, and the digest, the board and every report
break in the same week. Jira separates category from name for this reason.

**The board moves items with a MENU.** conventions §8: a real share of usage is
one-handed, in the field, on a phone, and dragging a card between columns that
do not fit the screen is the one board interaction with no good touch story.
CRM's deal board already made this call. A menu also names every destination.

**"My work" is the mobile screen.** It is the surface a field user opens, so it
gets designed narrow-first and everything else adapts. If it needs two hands, it
is wrong.

**Calendar-day comparisons are `yyyy-mm-dd` STRINGS, never Dates.** Overdue is a
question about days in the reader's timezone, and comparing a `date` column
against a server `Date` is wrong by up to a day for anybody off UTC — which the
user experiences as the product nagging about something due tomorrow. The
attention contract already passes `ctx.today` as a string for this reason.

### The CRM follow-up migration, which is the one genuinely risky slice

`crm_tasks` is a work item wearing CRM's name: title, notes, `due_on` DATE,
`assignee_clerk_user_id`, a completion timestamp pair, and an optional
party/deal. Once Work ships, **leaving both is the failure mode** — two task
tables, two "my work" lists, two digest sections, and a tenant who cannot say
where a thing they typed went.

So it migrates, and it migrates in its own slice after Work is proven, not in
slice 0. What has to move: the Follow-ups page (becomes a filtered work view on
`entity_type IN ('crm_party','crm_deal')`), the automation rule action
`create_task`, the note-extraction proposal path, and CRM's attention source —
which is **deleted**, not left running beside Work's.

**The trap that makes this a founder decision rather than a refactor:**
`crm_tasks`' policy branches — an attached follow-up inherits the CRM record's
visibility, so a follow-up on a restricted account is invisible to staff who
cannot see the account. A work item inherits its *list's* visibility instead.
Under the established link behaviour (a contributor's `resolve()` runs on the
caller's tx, so an entity RLS refuses simply does not resolve) the chip would go
blank for those staff — **but the item's title would become visible to them,
and today it is not.** That is a real widening of who sees what. Either the
migration routes attached follow-ups into a list whose visibility matches, or
the widening is accepted deliberately. It must not be discovered afterwards.

**During the gap between Work shipping and CRM migrating, both sources run.**
They are different rows, so nothing double-counts — but the digest will have two
sections that look like the same thing, and that is a reason to keep the gap
short rather than a reason to panic.


## Roadmap

Slices, in order. Each is a PR that leaves `main` green and shippable.
Migrations start at **0104**.

| # | Slice | Why here |
| --- | --- | --- |
| 0 | ✅ **Shipped.** Schema + RLS + 12 isolation tests + the read path. Default list auto-provisioned. `withWork()` | The visibility rules are the expensive part; certify them against two tenants before any UI exists |
| 1 | ✅ **Shipped.** Lists and items: create, edit, assign, close, nest. **"My work"**. Module registered, seed row `coming_soon` | The per-person surface first, because it is the one that gets opened daily and the one that proves the shape |
| 2 | ✅ **Shipped.** The list view with filters, and the board grouped by `state`, moved by menu | Two views over one dataset — the Notion lesson made concrete. It did not need a second query builder; `listWorkItems` grew two filters |
| 3 | ✅ **Shipped.** Saved views as URL parameter sets. Links: Work as host **and** as contributor | The seam work. Documents' saved-view decision is reused, not re-derived |
| 4 | ✅ **Shipped.** Attention source, second in the digest. Seed row flips to `available` | The module goes live once the obligation it creates can reach a person |
| 5a | ✅ **Shipped.** Shared write path in `src/lib/work/`, `version` column | CRM cannot import Work, so the write path had to move before CRM could raise a follow-up |
| 5b | ✅ **Shipped.** CRM writes and reads work items; data copied; CRM's source deleted | Must be ONE deploy — copying while CRM still reads `crm_tasks` double-counts every follow-up in the digest |
| 5c | ✅ **Shipped.** `DROP TABLE crm_tasks` | conventions §4: a drop goes out AFTER the deploy that stopped reading it |
| 6 | Recurring work (RRULE moved to `src/lib/` first, in its own PR) | Needs a real consumer; a maintenance schedule is the obvious one |
| 7 | ⏸ Item kinds, item fields, pack views — **shared with scheduling's deferred 6 and 7** | Build with the first pack in hand, so the seam ships with two users rather than none |
| 8 | ⏸ Work on the calendar | Deferred until `dispatch` needs it. The mechanism is scheduling contributing a linkable type and the calendar reading an overlay — not a second source inside `app_schedule_range()` |

A trade pack (`jobs`, then whatever the profile lists) is Layer 2a and starts
after 7. Its board columns, progress fields and dependency edges all land in
`src/packs/`, and nothing in `src/modules/work/` changes to accommodate them. If
something does, the boundary was drawn wrong.


## UI: 2026-08-10 — the module had no heading (branch `claude/ui-work-scheduling`)

Presentation and IA — no query, action, schema or policy changed. Recorded here
rather than only in a build log because two of these are usability defects, not
restyles, and they are the kind a module nobody has clicked accumulates.

- **`WorkModule` had NO `<h1>`.** It opened straight onto the filter bar, so the
  page was unnamed, had no heading for a screen reader to land on, and carried no
  module identity. It has a `PageHeader` now — "Work", with the coral accent.
- **`Lists` was the last button in the filter bar's right-hand cluster**, after
  Saved views / Hide finished / Clear — a navigation control hidden among filter
  controls, and the *only* route to that page. It is a header action now.
- **The Lists page's `<h1>` was invented inside `ListManager`** as a bare
  `text-xl`, so that page had no page-level title either and its heading matched
  nothing else in the product. It is a `PageHeader`, and the list sits in a
  `Panel`.

Worth keeping in mind when the deferred slices land: both defects are the sort
that only show up when somebody opens the screen, and **[the note below about
nobody having clicked this is still true](#open-items)** — a header and a moved
button do not change that.

## Open items

- **`listWorkItems` has no pagination, and slice 2 gave it a second caller that
  needs one.** The board reads without the open-only filter so its Done and
  Cancelled columns are not permanently empty, which means those two columns
  grow without bound. The fix is a limit plus a cursor on `(due_on, created_at)`
  — the index is already in that order — and the board additionally wants a
  per-column cap with a "+N more".
- **Search is `ilike` over two columns with no index behind it.** Honest at this
  size, and it will not stay honest; Documents needed a generated tsvector for
  the same question. When it bites, extend `listWorkItems` rather than adding a
  second query builder — that is the property slice 2 exists to preserve.
- ~~**Nothing keeps `updated_at` current.**~~ — **fixed in slice 1.** Every op
  sets it. There is still no trigger, so a future op that forgets will not fail
  any test; the guard is that all of them go through `list-ops`/`item-ops`.
- **NOBODY HAS CLICKED ANY OF THIS.** Slice 1 compiles, its ops are covered and
  the build renders the routes, but the dashboard is behind Clerk auth and no
  agent can reach it. The highest-value thing a human can do is switch the
  module on for one tenant and try: adding work from "my work" versus from a
  list, closing and reopening, handing work to somebody else, and an
  owners-only list seen from a staff account.
- **The seed row only exists after `npm run db:seed` runs.** Until then
  `requireModuleEnabled(tenant, "work")` has no row to find and the module
  cannot be switched on, however green the deploy is.

Beyond slice 0, and deferred on purpose:

- **`priority` is deferred.** Nothing in v1 would read it. Revisit when a
  surface exists that would order by it and cannot use due date and state.
- **Manual ordering (`position`) is deferred**, and is coupled to the
  no-drag-and-drop decision. If it comes back, it needs a touch story first.
- **Watchers are deferred.** One assignee is the digest's model; "keep me
  informed" is a different feature and probably a notification, not a row.
- **The expert role sees every `members` list.** Coarse. The upgrade is 0077's
  grants pattern, and it should wait until a tenant actually complains.
- **No workflow engine, and no plan for one.** State transitions are
  unconstrained on purpose; a pack that needs "cannot close until inspected"
  enforces it in its own action, not in core.
- **The `kind`/`status` columns will sit empty until a pack exists**, exactly
  like `schedule_items.kind` did. That is the design working, not a gap.
