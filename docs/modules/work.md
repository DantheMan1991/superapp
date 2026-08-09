# Work

> What has to be done, who it is on, and whether it is done yet. One dataset of
> work items — a list, a board and a per-person "my work" are three views of it,
> never three containers. Layer 1 — industry-blind: a plumbing profile labels a
> work item a Service Call, a GC calls it a Project, a dental practice calls it
> a recall, and core learns none of those words.
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
| `work_item_links` | What a work item is about | *Not built.* Slice 3. Modelled on `schedule_item_links`/`mail_links` **exactly**: `entity_type` carries a FORMAT check (`^[a-z][a-z0-9_]{0,62}$`) and **no value whitelist**, plus `extension_slug`. Inherits from the item. Registering a new linkable type needs no migration to core |

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

Still to come, and where it goes:

- `src/modules/work/link-ops.ts` — the "attach to…" surface (slice 3)
- `src/modules/work/attention/source.ts` — the digest contribution (slice 4)
- `src/modules/work/links.ts` — Work's own contribution to `entity-links` (see below)
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
| 3 | Saved views as URL parameter sets. Links: Work as host **and** as contributor | The seam work. Documents' saved-view decision is reused, not re-derived |
| 4 | Attention source, second in the digest. Seed row flips to `available` | The module goes live once the obligation it creates can reach a person |
| 5 | CRM follow-ups migrate onto work items; `crm_tasks` is deleted | Its own slice, after the core is proven. Read the trap above before starting |
| 6 | Recurring work (RRULE moved to `src/lib/` first, in its own PR) | Needs a real consumer; a maintenance schedule is the obvious one |
| 7 | ⏸ Item kinds, item fields, pack views — **shared with scheduling's deferred 6 and 7** | Build with the first pack in hand, so the seam ships with two users rather than none |
| 8 | ⏸ Work on the calendar | Deferred until `dispatch` needs it. The mechanism is scheduling contributing a linkable type and the calendar reading an overlay — not a second source inside `app_schedule_range()` |

A trade pack (`jobs`, then whatever the profile lists) is Layer 2a and starts
after 7. Its board columns, progress fields and dependency edges all land in
`src/packs/`, and nothing in `src/modules/work/` changes to accommodate them. If
something does, the boundary was drawn wrong.


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
