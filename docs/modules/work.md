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
| `work_lists` | The container, and the unit of sharing | `visibility` is `members` \| `owners`, text + CHECK, default `members`. Policy is `document_folders`' shape exactly: `tenant_id = app_current_tenant() AND (visibility = 'members' OR app_current_tenant_role() = 'owner')`. **No `effective_visibility` column** — lists do not nest, so there is no ancestor chain to roll down. One list per tenant is auto-provisioned (`Work`), the way scheduling provisions a primary calendar. `archived_at`, never deleted |
| `work_items` | The unit of work | Inherits its list's visibility through an `EXISTS` against `work_lists` — RLS applies inside policy subqueries, so the visibility term is written once and cannot drift (the trick 0024 documents for `document_versions`). Columns below |
| `work_item_links` | What a work item is about | Modelled on `schedule_item_links`/`mail_links` **exactly**: `entity_type` carries a FORMAT check (`^[a-z][a-z0-9_]{0,62}$`) and **no value whitelist**, plus `extension_slug`. Inherits from the item. Registering a new linkable type needs no migration to core |

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

Nothing exists yet. The intended layout, matching `src/modules/scheduling/`:

- `src/modules/work/WorkModule.tsx` — renderer, registered in `src/modules/index.ts`
- `src/modules/work/list-ops.ts` · `item-ops.ts` · `link-ops.ts` — server actions
- `src/modules/work/core/` — pure, no db: state labels, urgency, view params
- `src/modules/work/attention/source.ts` — the digest contribution
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
| 0 | Schema + RLS + isolation tests + the read path. Default list auto-provisioned | The visibility rules are the expensive part; certify them against two tenants before any UI exists |
| 1 | Lists and items: create, edit, assign, close, nest. **"My work"** | The per-person surface first, because it is the one that gets opened daily and the one that proves the shape |
| 2 | The list view with filters, and the board grouped by `state`, moved by menu | Two views over one dataset — the Notion lesson made concrete. If this needs a second query builder, slice 1 built the wrong read path |
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

Everything here is designed-and-not-built until slice 0 lands. Beyond that:

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
