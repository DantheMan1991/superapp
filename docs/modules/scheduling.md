# Scheduling

> The business's calendar: what is happening, when, and who is on it. Modelled
> on Outlook and Google rather than on a work-order queue — a **calendar** is the
> unit of sharing, private by default, grantable to named people or to the whole
> business. Core owns time, sharing and attendance; capability packs own
> everything a particular trade calls that work. Nothing is built yet: this file
> is the design, written before the first slice so it is not improvised.
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-08-08 (later) — Checked the design against Outlook; three things were wrong

Walked the real product rather than reasoning about it. Most of the design held;
these did not, and two of them would have been expensive to find later.

- **Access levels are FOUR, not three.** The missing one — *can view titles and
  locations* — is a partial redaction, which the design had assumed away. It
  turns free/busy from an edge case into the general case and changes what the
  definer helper returns. See Decisions.
- **`show_as` belongs on the item.** Availability cannot mean "an item exists
  here" or every all-day note makes somebody look unavailable.
- **A pack ships SEVERAL calendars, not one.** Confirmed against a real
  integration doing exactly that, split by kind of work.
- Smaller: a **bookable resource is just a calendar with no person owner**, so
  no `resources` table is needed; per-user show/hide of each calendar is real UI
  state we had no table for; and booking lives on its own surface ("go to my
  booking page"), which is independent support for keeping it out of core.
- Confirmed as designed: calendar is the unit of sharing and the picker asks
  which calendar *first*; business-wide sharing is a grantee row using the same
  control as a person, not a second mechanism; per-item private flag; required
  vs optional attendees; response state visible on the grid item itself. And
  **"subscribe from web" is exactly how slice 5's feed gets consumed** — the
  same route that construction platform already takes into his Outlook.

### 2026-08-08 — Design settled, nothing built

No code, no migrations. Recorded now because the two decisions that are
expensive to reverse — the sharing model and the pack seam — were made here,
and a later session should read them rather than re-derive them.

- **Sharing follows Outlook/Google**, settled with the founder: private by
  default, shared per calendar with named people or business-wide. Explicitly
  NOT the three shapes first proposed (business-wide with an owners-only flag,
  per-person like mailboxes, or flat).
- **The mechanism is `0077`'s, reused rather than reinvented** — a `visibility`
  column plus a self-contained grants table, with everything downstream
  inheriting through one EXISTS. See Decisions.
- **The pack seam is the reason the module exists in this shape.** A pack must
  be able to add its own item kinds, its own fields, its own calendars *and its
  own views* over the same items. The first three already have primitives; the
  fourth (a pack contributing UI) does not exist anywhere in the codebase yet
  and is designed below.
- **Two v1 scope calls, settled the same day.** No customer self-booking — but
  availability ships as a named seam so a booking pack can call it without
  reshaping anything. And the field surface is **both** an in-app list and a
  subscribe feed for phone calendars: the feed is not a nice-to-have, it is the
  only surface that reaches somebody who will never open the app.

## Data model

Nothing exists yet. This is the proposed shape; the migration that creates it
should carry these invariants as comments, in the style of `0077`.

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `schedule_calendars` | The container and **the unit of sharing** | `visibility` = `private` \| `members`, exactly as `crm_party_details` uses it. `owner_profile_id` NULL means the business owns it, not a person — **which is also how a bookable resource is modelled**, so do not add a `resources` table. `kind` is an OPEN taxonomy (P1) — core writes `personal` and nothing else. `extension_slug` records the pack that provisions and manages it; NULL means a person made it in the core UI, and it is the discriminator the UI groups on. One `is_primary` calendar per person, auto-created, undeletable |
| `schedule_shares` | One grant: this calendar, to this person, at this level | `access` = `busy` \| `titles` \| `details` \| `write` — **four, not three**; see Decisions. **Its policy must never read `schedule_calendars`** — see the recursion trap in Decisions. Grantee is a `clerk_user_id`, matching `crm_record_collaborators` rather than a profile FK, because that is what `app_current_user()` returns |
| `schedule_calendar_prefs` | Which calendars one person is currently showing, and in what colour to them | Per user in both directions, like `crm_view_pins`. Trivial table, but the toggle is used constantly in practice and its absence is felt immediately |
| `schedule_items` | One thing on a calendar | `starts_at`/`ends_at` timestamptz + `all_day` + `time_zone` (the zone it was authored in — needed for all-day and recurrence across DST; see [timezone.md](timezone.md)). **`show_as` = `free` \| `busy` \| `tentative` \| `away`** — availability reads this, not mere existence; see Decisions. `kind` OPEN taxonomy (P1). `metadata` jsonb NOT NULL DEFAULT `'{}'` (P2). `parent_id` self-FK, nullable — see Decisions. `sensitivity` = `normal` \| `private`. `cancelled_at` rather than a delete |
| `schedule_item_attendees` | Who is on it | `profile_id` XOR (`external_email` + `external_name`), enforced by CHECK. `response` = `needs_action` \| `accepted` \| `declined` \| `tentative`. **This is the assignment data the digest needs**, and it ships in the same slice as the items table — see Decisions |
| `schedule_item_links` | What it is about | Modelled on `mail_links` exactly: `entity_type` carries a FORMAT check and **no value whitelist**, plus `extension_slug`. A pack registers its own linkable types with no migration to core (P3) |
| `schedule_item_overrides` | One occurrence of a recurring item, moved or cancelled | Only exists once recurrence lands. Series live as an RRULE on the item and are expanded on READ — nothing is materialised |

## Key files & seams

Proposed layout. The three-file dependency graph is copied from
`src/lib/mail-extensions/`, because that shape is already enforced by eslint and
already proven by three implementors.

- `src/db/schema/scheduling.ts` — tables, re-exported by the `@/db/schema` barrel.
- `src/lib/schedule-extensions/types.ts` — **the contract. Imports nothing from
  `src/modules/**` or `src/packs/**`, and must not.**
- `src/lib/schedule-extensions/registry.ts` — `server-only`. The single
  composition root for data and action hooks; the only file here that may import
  a module or a pack.
- `src/lib/schedule-extensions/views.ts` — **NOT `server-only`**, because a view
  contribution is a React component. Precedent is
  [src/modules/index.ts](../../src/modules/index.ts), which already maps slug →
  `Component` and is not server-only; this is that pattern one level down, not a
  new one.
- `src/lib/schedule/with-schedule.ts` — the `withTenant` wrapper that always
  passes `{ role, userId }`. See Decisions; CRM added `withCrm()` for this after
  49 call sites had to remember.
- `src/lib/schedule/range.ts` — the ONE read path every surface goes through.
- `src/modules/scheduling/` — renderer, views, server actions.
- `src/modules/scheduling/attention/source.ts` — the digest contribution.

## Decisions & gotchas

**A calendar is the unit of sharing, not an item.** This is the founder's call
(2026-08-08) and it is what makes the module feel like the thing people already
use. It also happens to be the cheaper design: permissions attach to a handful
of calendars rather than to thousands of items, and every downstream table
inherits visibility through one join instead of carrying its own copy.

**The sharing mechanism is `0077`'s, deliberately.** CRM already answered
"private by default, shareable with named people": a `visibility` column on the
container, a separate grants table, and a three-term OR in the container's
policy. `schedule_items`, `schedule_item_attendees`, `schedule_item_links` and
`schedule_item_overrides` then resolve visibility through a positive EXISTS
against `schedule_calendars` and never restate the rule — which is exactly what
`crm_affiliations`, `crm_deals`, `crm_activities` and `crm_tasks` do against
`crm_party_details`. Two copies of a visibility rule drift. This is the
arrangement that stops there being two.

**Four access levels, and two of them are PROJECTIONS rather than grants.**
Checked against Outlook on 2026-08-08, which offers: *can view when I'm busy* ·
*can view titles and locations* · *can view all details* · *can edit*. The
design had three and was missing the middle one, and the middle one is the
interesting case — it is neither "you may read this row" nor "you may not", but
"you may read four of its columns".

This is the same wall free/busy hits, so it is one problem and not two: **an RLS
predicate can grant or refuse a row, but it cannot return a redacted one.** So
the read path resolves *my access level for this calendar* first and projects
accordingly, and the definer helper returns a **projection chosen by access
level** rather than a busy/free boolean. Designing it as a boolean and widening
it later means rewriting every caller, which is exactly what the one-read-path
rule below exists to prevent — so it lands that way in slice 0, before anything
reads it.

App-layer redaction is not an acceptable fallback here. `titles` must be a
column list the database applies, not a `delete row.description` somewhere in a
server action that the next surface forgets to copy.

**`show_as` is a property of the ITEM, not of the share.** Outlook's compose
form has a Busy/Free/Tentative/Away control, and conflating "an item exists in
this range" with "this person is unavailable" is a real bug rather than a
simplification: every all-day informational item — a reminder, a note, a
deadline somebody blocked out — would make its owner look booked solid, and
availability would be wrong from the first week. Availability (slice 9) reads
`show_as`, never mere existence.

**THE RECURSION TRAP, inherited with the pattern.** `schedule_calendars`'
policy reads `schedule_shares`, so **`schedule_shares`' policy must never read
`schedule_calendars`.** Postgres evaluates policies inside policy subqueries;
two tables naming each other produce `infinite recursion detected in policy for
relation` on the first SELECT and take the module down. `0077` spent this same
one-way promise and said so in capitals.

This bites harder here than it did in CRM, because of a requirement CRM did not
have: **the calendar's owner must be able to share their own calendar**, not
just a tenant owner — that is the whole Outlook model. The write policy on
`schedule_shares` therefore wants to ask "do I own this calendar?", which is a
read of `schedule_calendars`, which is the trap. `0077` already named the
sanctioned way out: *"the answer is a SECURITY DEFINER helper, not an EXISTS."*
So a narrow `app_owns_calendar(uuid) → boolean` that leaks nothing but a
boolean, with its own isolation test. Do not solve it by denormalising the
owner's id onto the share row — that copy goes wrong the day a calendar changes
hands, and it goes wrong silently.

**`WITH CHECK` IS NOT CONSULTED FOR DELETE.** The role/ownership test goes in
`USING` as well, or somebody revokes every grant they cannot create. `0067` and
`0077` both document this; it has already been shipped wrong once in this
codebase. The isolation test deletes as an unauthorised user and asserts zero
rows.

**No tenant-owner override on a personal calendar** — and this departs from CRM
on purpose. A CRM record is a business record, so an owner seeing all of them is
right. A personal calendar is correspondence-shaped, and the precedent for that
is mail (`0043`), which gave owners no override at all. An owner who needs to
see somebody's schedule gets granted `busy` or `read`, which is a decision
recorded as a row rather than a silent capability. Pack-managed calendars are
unaffected: they carry `visibility = 'members'`, so everyone sees them anyway.

**An attendee sees the item without seeing the calendar.** The item policy
carries a fourth OR term — an attendee row for `app_current_user()`. This is
what makes "Dave is on this" work when Dave has no access to the office
calendar, and it is why attendance and sharing are separate concepts rather than
one table doing both. A `sensitivity = 'private'` item on a *shared* calendar is
narrowed the other way: calendar owner and attendees only.

**`app_current_user()` returns NULL when unset, and `= NULL` is NULL, not
true** — so a transaction that forgets the user id sees nothing rather than
everything. A forgotten opt-in denies. That fail-closed direction is only free
if every call site passes it, which is why `withSchedule()` exists from the
first slice instead of after the 49th caller.

**`parent_id` is in core; dependencies are not.** The neutrality test
([extension-model.md §3](../extension-model.md)) splits these cleanly. Nesting
is universal — a bookkeeping firm's month-end close has steps inside it, a
dental practice's new-patient visit has stages. A finish-to-start relationship
with a lag is not; it is project-management vocabulary and fails the test.

The asymmetry is what decides it, not taste. Shipping `parent_id` unused costs
one nullable column and a cycle guard. Omitting it forces a pack to keep a
parallel tree that core's calendar cannot render — and then the pack's view and
the calendar disagree about what exists, which is the one bug class this whole
seam is meant to prevent. Dependencies have no such problem: an edge table is
pack-owned (P4), and core never needs to know it is there.

**Core never learns the word for the work.** Item kind is an open taxonomy, so
`milestone`, `site_visit` and `inspection` are values a pack registers, exactly
as `documents.doc_kind` already works. A zero-duration item is
`ends_at = starts_at`; core renders it as a point in time and a pack's view
renders it as whatever that trade draws. The table stays `schedule_items` while
the UI says "event", because a bar spanning three weeks is not colloquially an
event and the table name is the one that has to survive contact with packs.

**A pack contributes a VIEW, and that primitive does not exist yet.** Mail's P5
lets a module contribute data and actions; nothing in the codebase lets a layer
contribute UI over another layer's data. That is what a timeline or chart view
is — the same items, drawn differently — so the seam has to carry it:

```ts
export interface ScheduleExtension {
  slug: string;
  moduleSlug: string;
  name: string;
  /** Kinds of record an item can be attached to. Same shape as MailEntityType. */
  entityTypes?: ScheduleEntityType[];
  /** Item kinds this layer registers: value, label, icon. */
  itemKinds?: ScheduleItemKind[];
  /** Extra fields on the item form, read and written through `metadata`. */
  itemFields?: ScheduleItemField[];
  /** Calendars this layer provisions and owns. */
  managedCalendars?: ManagedCalendarSpec[];
  /** Extra ways to draw the same items. */
  views?: ScheduleView[];
}
```

**A view receives items core has already fetched and RLS has already scoped.**
It gets no `tx` and issues no query of its own for core data — the same reason
`collect` and `search` take the caller's transaction, which is invariant S12
expressed as a function signature. A view that fetched for itself could draw a
row RLS had refused. For its *own* tables the pack opens its own `withTenant`
under the caller's tenant and role, never `withSystem`, and merges.

**`managedCalendars` is how a layer ships calendars everyone can see — plural,
and that matters.** The founder named this case directly: a shared schedule that
is business-wide by default rather than private. It is also observable in the
wild. His own Outlook carries three calendars published by the construction
platform he runs the business on, grouped under "Other calendars", separately
coloured, each toggled independently — split not by team but by *what kind of
work it is*: the schedule, sales activity, and to-dos.

So a pack provisions a SET, and the array is not decoration. The spec carries
`visibility: 'members'` and core provisions on module enable, idempotently keyed
on `(tenant_id, extension_slug, key)`. `extension_slug` being non-null is also
what lets the UI group them apart from a person's own calendars without knowing
which pack it is looking at. The pack supplies each calendar's NAME, which is
where its vocabulary lives and where core's must not go. Uninstalling leaves the
rows untouched — same as an uninstalled pack's mail links, which are simply
ignored.

**Ship the view seam with two real implementors or it is untested.**
`email.md` records the day three Migadu assumptions turned out to be baked into
supposedly shared code, and concluded that *a seam with one user is a seam that
has never been tested*. The view seam is the most speculative thing in this
design, so the slice that introduces it must move a **core** view onto it — not
add a placeholder — so that the first pack is the second user and not the first.

**The digest is the reason attendees ship in slice 2 rather than being
deferred.** [notifications.md](notifications.md) records that its slices 1 and 2
shipped a
per-person digest into a product where nothing set an assignee, so every staff
member's digest was empty by construction and no test could have caught it.
Scheduling is the single best source that feature will ever have — "here is your
day" beats a list of overdue invoices — and it would reproduce that exact
failure if attendance arrived late.

**The subscribe feed is the only surface with no session, and that makes it the
sharpest edge in the module.** A phone's calendar app cannot log in, so the URL
*is* the credential — a bearer token in a string that will end up in somebody's
clipboard, a screenshot, and an IT ticket. Three rules follow, and none of them
is optional:

- **The token is random, per person, per feed, and revocable**, stored as a hash
  with the lookup done on the hash. Never a row id, never derived from anything
  guessable, and rotating it is a button rather than a support request.
- **The request resolves the person, then acts as them.** `withSystem` to turn
  the token into a profile and tenant, and everything after that inside
  `withTenant(tenantId, fn, { role, userId })` for that person. This is the
  shape the digest cron already uses, and the reason is the same: a background
  caller with no session must narrow to somebody before it reads anything.
- **The feed carries exactly what that person can see, private items included.**
  It is their own calendar, so redacting it would make the feed lie about their
  day. The protection is the token's revocability, not a second visibility
  model — a feed that shows a different schedule from the app is a feed nobody
  will trust twice.

It leans on role barely at all, which is deliberate: with no owner override on
personal calendars (above), a stale `memberships.role` cannot widen what the
feed returns. Do not add a term that makes it able to.

**One read path from the first commit.** Every surface goes through one
`listRange(from, to, ctx)`. It is a passthrough at first and looks like
ceremony. It stops looking like ceremony when recurrence lands, because
expand-on-read is not something that can be retrofitted across a dozen call
sites that each built their own query.

## Roadmap

Slices, in order. Each is a PR that leaves `main` green and shippable.

| # | Slice | Why here |
| --- | --- | --- |
| 0 | Schema + RLS + isolation tests. `withSchedule()`. **Access-level projection in the read path.** Primary calendar auto-provisioned on membership | The visibility rules are the expensive part; prove them against two tenants before any UI exists. The projection lands here because widening a boolean later means rewriting every caller |
| 1 | Calendars: create, rename, colour, archive. Share with a person, share business-wide | Sharing is the module's defining behaviour and everything else assumes it works |
| 2 | Items + attendees. Month/week/day. `listRange` | Attendees are NOT deferred — see Decisions |
| 3 | Links, and entity types from Accounting, CRM, Documents and Mail | Reuses `mail_links`' primitive; makes the calendar part of the product rather than beside it |
| 4 | Attention source + "my day". Registry entry, seed row flips to `available` | The digest gets its strongest source; the module goes live |
| 5 | Per-person subscribe feed: hashed revocable token, ICS, revoke button | Same query as 4, no session. Reaches the person who will never open the app |
| 6 | Extension seam: item kinds, item fields, managed calendars | First three pack primitives, all with existing precedent |
| 7 | The view seam, with a core view moved onto it | The new primitive, shipped with two users |
| 8 | Recurrence: RRULE + overrides, expanded on read | Hardest slice; deliberately after the seam is stable. The feed emits the RRULE and the phone expands it |
| 9 | Free/busy + availability, reading `show_as` | Settled scope: no booking page, but a booking pack can call this. Mostly assembled from slice 0's projection rather than built fresh |

A trade pack (`jobs`, then whatever the profile lists) is Layer 2a and starts
after 7. Its Gantt-style view, dependency edges and progress fields all land in
`src/packs/`, and nothing in `src/modules/scheduling/` changes to accommodate
them. If something does, the boundary was drawn wrong.

## Open items

- **The projection needs an isolation test per access level**, not one for
  free/busy. Four levels means four assertions — `busy` returns no title,
  `titles` returns a title and no body, `details` returns everything, `write`
  can update — and the interesting failures are at the boundaries between them.
- **Categories are not `kind`, and both probably want to exist.** Outlook has
  user-created coloured categories alongside the structural type of an item.
  `kind` is registered by a pack (P1); a category would be tenant configuration
  (Layer 3). Nothing here designs the second one; noted so the first is not
  stretched to do both jobs.
- **A revoked feed token keeps working for as long as the phone caches it**, and
  there is nothing we can do about that from this side. Worth saying out loud in
  the revoke UI rather than implying the link is dead the instant it is
  rotated.
- **External calendar sync is not designed.** Stalwart offers calendars and
  contacts alongside mail, and the OAuth scopes deliberately exclude them
  ([email-build-log.md](email-build-log.md)). Our own tables are the source of
  truth regardless — CalDAV cannot carry links to invoices, per-tenant RLS, or
  pack metadata — so any sync is additive and none of it changes this schema.
- **Timezone handling is the likeliest source of quiet wrongness.** All-day
  items, recurrence across DST, and a tenant whose people are in two zones.
  [timezone.md](timezone.md) already has the primitives; what is missing is a
  decision about whether an item's zone or the viewer's zone wins on display.
- **Nothing here has met a real week of a real business.** Every claim above is
  about mechanism. Whether the calendar is the surface people actually open is
  not knowable until slice 4 is in front of somebody.
