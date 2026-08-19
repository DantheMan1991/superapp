# Scheduling

> The business's calendar: what is happening, when, and who is on it. Modelled
> on Outlook and Google rather than on a work-order queue — a **calendar** is the
> unit of sharing, private by default, grantable to named people or to the whole
> business. Core owns time, sharing and attendance; capability packs own
> everything a particular trade calls that work. **Live from slice 4**: schema
> and RLS, calendars and sharing, a week/day/month calendar with events and
> attendees, links to the records an event is about, and the morning digest's
> leading section. Recurrence, availability and the subscribe feed are the
> remaining slices.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

### 2026-08-18 — Driven for the first time, and the ICS feed holds up (no code change)

The module was carried as compiled-and-tested. This is the record of somebody
actually using it, and of two open items that turn out to be closed.

- **The feed IS subscribed from a real device.** The Calendars page shows a
  token named **Android, last used 8/18/2026** — the open item saying "nobody
  has actually subscribed to this from a real phone yet" has been overtaken by
  events. Leave the token alone; it is somebody's live calendar subscription.
- **The `.ics` extension worry is answered in practice.** The route path has no
  extension, but the response carries `Content-Type: text/calendar; charset=utf-8`
  and `Content-Disposition: inline; filename="yosher.ics"`, and the Android
  client has been polling it happily.
- **THE GENERATOR IS RFC 5545 CORRECT WHERE IT IS EASIEST TO BE WRONG.** Tested
  with a title built to break it — 106 characters containing both a comma and a
  semicolon. The output:

  ```
  SUMMARY:Quarterly walkthrough\, roof and gutters\; bring the ladder\, the m
   oisture meter and the north elevation notes
  ```

  Commas and semicolons escaped, and the line folded at 75 octets with a
  leading-space continuation. Both are the details ICS writers usually miss, and
  an unescaped comma would have made every client read the summary as a list.
- Also exercised: the week grid, creating an event (landed in the right slot and
  in the feed at `13:00Z` = 9am America/New_York), the calendars page, minting a
  feed token, and revoking one.

**One thing to decide, not a defect.** *Cancel event* is a single click, sits
directly beside *Save* in the same dialog, and asks nothing. `cancelItem` is a
SOFT cancel — it sets `cancelled_at`, so the row survives — but there is no
un-cancel in the UI, so from a person's side one misclick removes an event with
no way back. Accounting made every confirmation a real dialog on 2026-08-12;
this is the same question, unanswered here.

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-08-10 — UI: the only h1 was the date range (branch `claude/ui-work-scheduling`)

Presentation and IA — no query, action, schema or policy changed. Two of these
are usability defects rather than restyles.

- **The module had no title.** Its only `<h1>` was the date range in
  `calendar-view.tsx` ("August 2026"), which meant the page was unnamed *and* its
  heading changed every time you paged a week — a screen reader landing on the
  page would hear a date rather than what the screen is. There is a `PageHeader`
  ("Schedule", teal accent) now, and the range is a `<p>` that keeps its visual
  weight and gained `aria-live="polite"` so paging is announced.
- **`Calendars` was an icon-only cog with `sr-only` text**, and it is the only
  route to the screen that decides who can see which calendar. It is a labelled
  `Calendars` button now.
- **`CalendarManager`'s `<h1>` was a bare `text-xl`** invented inside the
  component, so that page had no page-level title either. Now a `PageHeader`.
- Chrome moved onto the tokens: `--divider` for in-container hairlines, the
  rounder radius, elevation on the feed-subscription panel, and two hardcoded
  amber warning banners onto `--warning`.

**The calendar colour palettes were deliberately left alone.** `COLOR_CLASSES` in
`calendar-view.tsx` and `calendar-manager.tsx` (`amber: "bg-amber-500"`, etc.) are
a user's chosen calendar colours — a fixed palette, not theme tokens — and
"modernising" them onto semantic tokens would collapse distinct calendars into the
same colour.

### 2026-08-09 — Free/busy and availability (branch `claude/scheduling-availability`)

The last slice of the roadmap. **No migration** — it is pure interval maths over
the read path that already exists, which is what the four access levels were
built for.

- **THE NAMED SEAM the design promised.** `src/lib/schedule/availability.ts`
  splits into three pieces on purpose — `mergeIntervals`, `invertIntervals`,
  `findFreeSlots` — because a booking pack needs "given these people, this
  window and this duration, what is open?" and that has to be reachable without
  a rewrite. Nothing customer-facing ships; the shape does.
- **BUSY MEANS `show_as`, NEVER MERE EXISTENCE.** An all-day note, a blocked-out
  reminder, a deadline pinned to a Tuesday — all events, none of them meaning
  the person is unavailable. This is the payoff for putting `show_as` on the
  item back in slice 0, and there is a test that a `free` item does not make
  somebody busy.
- **A `busy`-level share is ENOUGH, and reveals nothing.** Availability reads
  through `listRange`, so it inherits the levels exactly: a colleague sharing at
  the lowest level contributes their times and no titles, because the projection
  already nulled them. There is a test asserting the returned objects have only
  `startsAt` and `endsAt` — there is nowhere for a title to leak.
- **AN UNSHARED CALENDAR IS `unknown`, NOT FREE**, and that distinction is the
  most important thing in the file. `BusyForPerson.visible` is separate from an
  empty `busy` array so every caller has to decide what to say. Telling somebody
  a slot is open when the truth is "we cannot see" would be the worst lie this
  feature could tell, and there is a test where the invisible person genuinely
  has a meeting at that exact time.
- **Adjacent blocks MERGE.** 9–10 and 10–11 back to back is one busy block from
  9 to 11; leaving them separate lets a slot finder offer the instant at 10:00.
- **Working hours apply PER LOCAL DAY**, not as one UTC band, so "9 to 5" stays
  9 to 5 across a DST change — the same rule recurrence follows, with a test
  spanning 2026-11-01.
- **Slots align to the half hour**, not to the end of the previous meeting. An
  opening at 10:47 is technically true and nobody books it.
- **The event form warns before saving.** Conflicts and unknowns are shown
  separately as the times and guest list change, so a clash is visible while
  somebody is still choosing rather than discovered by whoever turns up to an
  empty room.
- 21 unit tests over the maths, 6 through real RLS.

### 2026-08-09 — Recurrence (branch `claude/scheduling-recurrence`)

Repeating events, expanded on read. Slice 6 (the pack seam) is **deferred** by
the founder — it would have shipped three primitives with zero implementors, and
this repo's own rule is that a seam with one user has never been tested. Packs
get built with their first real consumer in hand.

- **THE SERIES IS ONE ROW.** A year of a daily standup is one row and 365
  renders, not 365 rows that would need regenerating every time somebody edited
  the rule. `schedule_item_overrides` holds only the handful of occurrences
  somebody moved or cancelled.
- **EXPANSION WALKS LOCAL DATES, NOT MILLISECONDS**, which is the whole
  correctness story. "Every Tuesday at 8am" means 8am on the wall clock, and
  adding 7 × 86,400,000ms to an instant lands at 7am the week the clocks change.
  Tests assert a weekly 8am series moves from `13:00Z` to `12:00Z` across
  2026-03-08 while staying 8am local, and that the one occurrence a year landing
  inside the spring-forward gap falls FORWARD to 03:30 rather than vanishing.
- **A monthly series measures from the SERIES START, never from the previous
  occurrence.** Starting on the 31st, February clamps to the 28th — and stepping
  from *that* keeps it on the 28th for the rest of the year. Found by a test
  that failed on the first run; the drift is the classic monthly-recurrence bug
  and it was written in straight.
- **The parser REFUSES what it does not implement** — `BYSETPOS`, ordinal
  `BYDAY` ("the third Tuesday"), `BYMONTHDAY` lists — rather than dropping the
  clause. A rule that quietly ignored "third Tuesday" would generate a series on
  the wrong days, which is worse than not offering it. `item-ops` refuses it at
  the write boundary too, so an unsupported rule never reaches storage.
- **`app_schedule_range` CANNOT EXPAND, AND MUST NOT TRY.** Expansion needs the
  zone's offset at each instant; reimplementing that in SQL would be a second
  copy of the hardest logic in the module. The function now returns the series
  row with its rule and zone attached, and `range.ts` expands BOTH sources with
  one expander. **There is a test that a `titles`-level colleague sees all four
  occurrences of a weekly meeting** — without it, the redacted path would show a
  recurring event once and never again.
- **The override key is a LOCAL DATE, not an instant.** The occurrence somebody
  edited is "the one on the 12th", and it stays that occurrence when the series
  moves from 9am to 10am. Keying on the instant would orphan every override the
  first time the rule changed.
- **The destructive default on a repeating event is the NARROW one.** "Cancel
  just this one" sits before "Cancel the series", because somebody cancelling a
  standup means Friday.
- **The feed emits OCCURRENCES, not `RRULE`+`EXDATE`.** Bigger — up to 395
  VEVENTs for a daily series — but it means the expansion `range.ts` already got
  right is the one the phone displays, rather than the client re-expanding with
  its own idea of the timezone. Correctness over bytes; a shorter window is the
  fix if size ever matters.
- **A DOM key must carry the occurrence date.** Every occurrence shares the
  item's id, so keying a row on `id` alone collapses a whole series into one and
  React reuses the wrong node when the week changes.
- 17 unit tests over the expander, 7 through the read path with real RLS.

### 2026-08-09 — Slice 5: the subscribe feed (branch `claude/scheduling-slice-5`)

A per-person iCalendar URL, for the phone that will never open Yosher.

- **THE URL *IS* THE CREDENTIAL, and everything here is shaped by that.** A
  calendar app cannot log in, so the token in the path is the only thing between
  a stranger and somebody's schedule — and it will end up in a clipboard, a
  screenshot and an IT ticket.
  - **Only the HASH is stored** (SHA-256, unique GLOBALLY rather than per
    tenant, because the route has no tenant context until the hash resolves).
    A dump of the table hands nobody a working feed.
  - **The token is returned exactly once**, from the mint action, and held in
    component state. There is no second chance to display it and the UI says so.
  - **The audit row does NOT carry the token.** It would be a working feed link
    sitting in a table superadmins read.
- **ONE `withSystem`, DOING ONE THING.** `feed-serve.ts` resolves the hash to a
  person outside RLS — it has to, since there is no session — and then reopens
  as that person for every event it serves. A feed that selected items under the
  system context would serve whatever the token named, including calendars that
  person cannot see. The two phases are kept visibly apart in the file for
  exactly that reason.
- **Unknown, revoked, and owner-has-left all return the same 404.**
  Distinguishing them would confirm which tokens exist to somebody guessing.
- **A feed token has NO role term in its policy at all** — the only table in the
  module like that. Every other one lets an owner do something; being the boss
  is not a way into somebody's phone. Tests assert an owner can neither read nor
  revoke a colleague's.
- **ICS is hand-written and tested, because its two real failure modes are
  invisible.** Folding is counted in **octets**, not characters — 40 emoji is a
  160-byte line some parsers stop reading — and a raw newline in a description
  reads as the end of the property, silently truncating the event. 14 tests,
  including one that asserts no split lands inside a multi-byte character.
- **`UID` is the item's own id.** A client treats a changed uid as a different
  event, so regenerating with fresh ids would delete and re-add somebody's whole
  calendar on every refresh, alarms included.
- **A `busy`-level item serialises as "Busy"** — the same word the app shows,
  for the same reason. The feed carries what that person can see, private items
  included: it is their own calendar, and redacting it would make the feed lie
  about their day.
- **Revoking cannot reach a copy a phone already has**, and the UI says so
  rather than implying the link died the instant it was pressed.

### 2026-08-09 — Slice 4: the module goes live (branch `claude/scheduling-slice-4`)

The digest gets its strongest source, and the seed row flips to `available`.

- **`schedulingAttentionSource` LEADS the registry**, ahead of CRM follow-ups
  and accounting. What is on today is the thing somebody opens a morning email
  to find out, and it is the only section with a time attached — a 7am digest
  that opens with an overdue invoice buries the 8am site visit under it.
- **Two populations, and only one of them is an obligation.**
  `notifications.md` is strict that an item must SELF-CLEAR. An **unanswered
  invitation** is a true obligation — you owe a reply and answering makes it
  vanish, with a test that accepts and asserts it disappeared. **Today's
  schedule** is not something you owe; it clears because tomorrow arrives.
  Included anyway because it is the reason the channel is worth opening.
- **WHOSE DAY, EXACTLY: an attendee, or a calendar you OWN.** Deliberately not
  "any calendar you can see" — a workspace calendar shared with everybody would
  otherwise put the entire company's week into every person's morning email,
  which is precisely the untrustworthy noise the derived-obligation design
  exists to avoid. There is a test where a colleague can READ the Team calendar
  at `details` and it is still not in their digest.
- **A consequence worth noticing: nothing here is ever redacted.** Everything
  returned is the reader's own calendar or their own invitation, so the four
  access levels never come into it. A `busy`-level glimpse of somebody else's
  afternoon is not an obligation.
- **An unanswered invitation for TODAY is reported once, as the invitation** —
  the more actionable of the two framings. Reporting it twice would make the
  count wrong, and "one number everywhere" is what the feature trades on.
- **The seed description said "Jobs, appointments, calendar." and had to be
  rewritten.** `extension-model.md` §8 names "job" as its worked example of a
  word that sounds generic and is not: it is what electrical calls its work
  while plumbing says Service Call and a GC says Project. A profile supplies
  that label; a core module's catalog copy must not. It now reads *"The
  business's calendar — what is happening, when, and who is on it. Private until
  you share it."*
- **`status` is `available`**, so the module is sellable and appears in the
  catalog as a real thing rather than an empty slot. `npm run db:seed` is what
  applies that to a database; the code change alone does nothing.
- 8 attention tests through real RLS.

### 2026-08-09 — Slice 3: links, and a contract that stopped belonging to Mail (branch `claude/scheduling-slice-3`)

An event can now be attached to a customer, an invoice, a file — nine entity
types across Accounting, CRM and Documents, none of which scheduling knows
anything about.

- **THE LINKABLE-RECORD CONTRACT MOVED OUT OF MAIL.** Nine implementations
  already existed, written against `MailEntityType`, and their `search`/`resolve`
  were entirely generic — only `templateFields`/`templateValues` are really
  mail's. Scheduling wanted the same nine, because an event is attached to an
  invoice for the same reason a thread is. The generic half is now
  `src/lib/entity-links/types.ts`; `MailEntityType extends LinkableEntityType`
  and re-exports the shared names, so **not one implementation or importer
  changed** — only the type they satisfy. The alternative was nine second
  implementations to keep in sync, which is what ADR 0004 exists to prevent.
- **TWO HOSTS NOW, AND THE DISTINCTION IS ENFORCED.** A host DECLARES an
  "attach to…" surface and therefore runs the wiring: mail and scheduling. A
  contributor that imported `entity-links/registry` would pull in every other
  module through it — rule 1 defeated by one indirection. eslint carries the
  split, and it was **verified by planting a violation in Accounting and
  watching it fail**, not by assuming; `ENTITY_LINK_HOSTS` is the list, and
  adding to it means that module now renders a picker over everybody else's
  records.
- **`scheduling` was missing from `MODULE_SLUGS` entirely**, so it had no
  isolation rules at all — it could have imported another module and nothing
  would have said so. Added.
- **`schedule_item_links` is `mail_links` copied down to the format checks.**
  `entity_type` carries NO value whitelist, only a format CHECK: that is
  primitive P3, and a pack registers `rfi` by writing the string with no
  migration to core. There is a test that writes `rfi` and one that refuses
  `"Not A Valid Type"`.
- **The policy graph gains one edge and stays acyclic.** links → items →
  calendars → shares → (definer). `schedule_items` does not read links, so
  there is no cycle to cut and no new `SECURITY DEFINER` helper. Visibility
  INHERITS through one EXISTS, which means the four-level model applies to
  links for free — somebody at `titles` cannot see the item row, so they see
  none of its links either, and there is a test that walks all three levels.
- **A LINK DOES NOT CHECK WHETHER YOU MAY SEE THE OTHER END, deliberately.**
  `entity_id` is an opaque uuid and core has no idea what an invoice is. The
  protection is on the read path: `resolve` runs inside the caller's own
  transaction, so a record they may not see simply does not come back and
  renders as *"no longer available"*. S12 doing the work — and the reason
  resolution must never be moved to `withSystem` for convenience.
- **A dangling link is SHOWN, not hidden.** A link that silently disappears
  looks like it was never made.
- **Attaching is only offered on a saved event.** A link needs an item id to
  point at, and queueing them client-side until the first save would mean two
  code paths for one feature.

### 2026-08-09 — Slice 2: events, attendees, and the calendar itself (branch `claude/scheduling-slice-2`)

Week, day and month over `listRange`. Create an event, put people on it, accept
or decline. **The module home is now the calendar**; managing calendars moved to
`/dashboard/m/scheduling/calendars`.

- **The shared calendar arithmetic finally landed in `src/lib/timezone.ts`**,
  where that file's own note said it belonged "the moment a second module wants
  the same one". `zonedTimeToInstant`, `startOfDayInTimezone`, `addDays`,
  `startOfWeek`, `minutesIntoDay`. No date library, and this is not the place to
  add one — a dependency that owns the meaning of "midnight" is one you cannot
  reason about at 2am on the second Sunday in March.
- **THE DST GAP MOVED EVENTS BACKWARDS, and it took a check to notice.** The
  standard two-pass wall-clock→instant conversion, asked for 02:30 on the
  spring-forward morning, returns an instant that renders as **01:30** — earlier
  than requested, silently. Verified rather than reasoned about: two passes give
  06:30Z and 06:30Z is 01:30 EST. There is now a third step that renders the
  result back, and falls FORWARD to 03:30 when the requested time does not
  exist, like Google and Outlook. The autumn ambiguity needs no special case;
  the passes settle on the first occurrence.
- **A cluster's width is maximum CONCURRENCY, not how many events are in it.**
  A 9–10, B 9:30–10:30, C 10–11 is three chained events but two columns, because
  C reuses A's. The first version of the layout TEST asserted three and the code
  was right — worth recording that the mistake was in the expectation, since the
  same wrong mental model is what produces cascading-column calendars.
- **A month grid is 4, 5 or 6 rows and never assumed to be 5.** It shows whole
  weeks, so February starting on a Sunday needs four and a 31-day month starting
  on a Saturday needs six. `shiftAnchor` steps months by name rather than by 30
  days, or stepping from the 31st skips one.
- **Attendees are DIFFED, not deleted and reinserted.** Reinserting resets
  `response`, so saving an unrelated title change would quietly un-accept
  everybody who had already replied. There is a test that accepts, edits, and
  asserts the acceptance survived.
- **All-day events are stored end-EXCLUSIVE** — local midnight to local midnight
  — so a one-day event occupies exactly one column and a three-day event three.
  Storing 23:59 leaves a one-minute hole every overlap query would have to know
  about. The form shows the day before as the last day, or a one-day event reads
  as two.
- **A redacted item renders as "Busy", not as a placeholder.** At `busy` access
  the title is NULL by construction, and inventing "(private)" would claim the
  event is marked private when it is simply not shared at that level.
- **An item somebody sees only by being an attendee comes back with
  `access: null`**, which is how the renderer knows it is an invitation rather
  than something on a calendar they can open.
- **Nothing is emailed.** The form says so, because "add a colleague" reads as
  "send an invitation" and it does not — it puts the event on their Yosher
  calendar and nothing else.
- 37 pure tests (timezone, layout, ranges) and 10 ops tests through real RLS.

### 2026-08-09 — Slice 1 broke the superadmin tenant page in production

Enabling **any** module 500'd. `src/modules/scheduling/actions.ts` carries
`"use server"` and exported `CALENDAR_COLORS`, a const array. A `"use server"`
file may export only async functions; anything else throws *"A 'use server' file
can only export async functions, found object"* when the module graph is
evaluated. The admin tenant page reaches that file through `moduleRegistry` →
`SchedulingModule` → `calendar-manager` → `actions`, so the whole page's server
actions died — nothing to do with scheduling being enabled.

Moved to `src/modules/scheduling/core/colors.ts`, which carries the reasoning.

**THE PART WORTH REMEMBERING: nothing in the pipeline caught it.** `tsc`,
eslint, the full suite and **`npm run build` all passed.** AGENTS.md says the
build is what catches server-boundary violations — that is true of `server-only`
imports and false of this. The error surfaces only when a REQUEST evaluates the
server-action graph, which no CI step does.

`tests/use-server-exports.test.ts` now scans every `"use server"` file for
runtime value exports. It was confirmed to FAIL on the original bug before being
kept — a checker never seen to fail is not a checker. Exported `type` and
`interface` are still allowed and several action files rely on that; they are
erased before runtime, so Next never sees them.

Found by the founder clicking the toggle on the live site, minutes after #99
made it clickable. Diagnosed from `vercel logs`, not from the browser: the
console showed only a digest and "an error occurred in the Server Components
render", which names nothing.

### 2026-08-08 — Slice 1: calendars and sharing (branch `claude/scheduling-slice-1`)

The four access levels stop being a schema decision and become something a
person clicks. Create, rename, recolour, archive; share with a colleague or with
the whole workspace, at any of the four levels.

- **The module is REGISTERED from this slice, not slice 4.** The roadmap put the
  registry entry with the seed-row flip; that was wrong, because slices 1–3
  build UI and UI needs somewhere to live. `src/modules/index.ts` now has
  `scheduling`, while the seed row stays `coming_soon`. Slice 4 still flips the
  seed row.

  **This shipped with a claim that was FALSE: that a superadmin could switch it
  on to try it.** `requireModuleEnabled` gates on `tenant_modules` and ignores
  `modules.status`, which is where the claim came from — but the admin console's
  toggle was disabled by `mod.status === "available"`, so nothing could reach the
  UI on the one tenant allowed to see it. Found by the founder on the live site
  the morning after. Fixed separately by splitting "implemented" from "sellable"
  on the tenant page; the reasoning lives there.
- **The module home IS the calendar list**, for now. Slice 2 makes the week view
  the home and moves this to `/calendars`. A front door that only reported "you
  have 3 calendars" would be a dead end — the same reason CRM's home is the
  records list rather than an overview.
- **The sharing dialog pins "Everyone in this workspace" at the top, always**,
  even when nothing is shared, using the same control as a person. That is the
  UI consequence of there being one mechanism: sharing with everybody is not a
  separate feature to discover. Outlook does exactly this.
- **Level wording is Outlook's, minus its "I".** *Free/busy only · Titles and
  locations · All details · Can edit*. "Can view when I'm busy" reads as
  somebody's personal availability, which is wrong on a business calendar; the
  distinction the middle tier exists to make survives the rewording.
- **Colour is open text in the column, an enum at the action boundary, and full
  class strings in the component.** Three spellings of one idea, each for a
  reason: the column stays open so a palette changes without a migration, the
  Zod enum is what stops arbitrary text reaching a style attribute, and Tailwind
  scans source text so an interpolated `bg-${color}-500` produces a class that
  exists in no stylesheet.
- **Archive, never delete.** A deleted calendar takes its items with it by FK
  cascade. The primary cannot be archived at all — enforced in `calendar-ops`
  rather than the database, because it is a product rule and the message needs
  to explain itself. The UI omits the button rather than disabling it.
- **`NOT_FOUND` and `FORBIDDEN` are indistinguishable for an invisible
  calendar**, with a test that says so. A distinct "you may not see this" would
  confirm the calendar exists to somebody probing.
- **The guards in `calendar-ops` are NOT the security boundary** — 0097 is. They
  exist so a refused action says why instead of reporting that nothing happened.
  The ops tests run as a person through real RLS for exactly this reason: where
  a guard and a policy disagree, that is what catches it.
- 9 ops tests, run as a person rather than under `withSystem`.

### 2026-08-08 — Slice 0: schema, RLS, the read path (branch `claude/scheduling-slice-0`)

Four tables, twelve policies, four helper functions, thirteen isolation tests.
No UI, no module registry entry, no seed row — the module is still
`coming_soon` and slice 4 is what turns it on.

- **Four tables, not the six the design listed.** `schedule_calendars`,
  `schedule_shares`, `schedule_items`, `schedule_item_attendees`. Links and the
  per-person show/hide preference land with the slices that read them; a table
  with no reader is the speculative build this codebase avoids. Items and
  attendees are here because the property slice 0 exists to certify — that item
  visibility INHERITS from the calendar — cannot be proven without both.
- **The `visibility` column is gone. Everything is a share.** See Decisions;
  this is the one place the built thing departs from the design as merged.
- **`busy` and `titles` are not RLS at all.** Also Decisions. The row is
  invisible to a direct SELECT below `details`, and `app_schedule_range()`
  returns a projection instead, so nothing in application code redacts anything.
- **Two policy cycles, not one.** calendars ↔ shares was predicted. items ↔
  attendees was found while writing the policies: the item policy needs "am I an
  attendee?" and the attendee policy inherits from the item. Both cut with
  narrow `SECURITY DEFINER` booleans.
- **`withSchedule()` exists**, which `withCrm()` never did — 0077 named the fix
  and CRM still repeats the options at 49 call sites under a header comment.
- **Every member gets a primary calendar**, provisioned from `upsertMembership`
  on BOTH branches so people who predate the module get one on their next role
  sync.
- **drizzle-kit generated a migration that cannot run.** It emits every
  `ADD CONSTRAINT` before every `CREATE INDEX`, so the composite FKs referenced
  unique indexes that did not exist yet — Postgres 42830. Caught by running it
  against the dev branch, which failed and rolled back clean. 0096 is
  hand-reordered and says so; a regeneration would silently undo it.

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
| `schedule_calendars` | The container and **the unit of sharing** | **BUILT.** No `visibility` column — see Decisions. `owner_clerk_user_id` NULL means the business owns it, not a person — **which is also how a bookable resource is modelled**, so do not add a `resources` table. `kind` is an OPEN taxonomy (P1) — core writes `personal` and nothing else. `extension_slug` + `extension_key` record the pack that provisions it and make provisioning idempotent; NULL means a person made it in the core UI, and non-NULL is the discriminator the UI groups on. One `is_primary` calendar per person, partial unique index, auto-created |
| `schedule_shares` | One grant: this calendar, to this person **or to everyone**, at this level | **BUILT.** `access` = `busy` \| `titles` \| `details` \| `write` — four, not three, and **the enum's declaration order is load-bearing** because the policies compare with `>=`. Grantee `''` means everyone in the workspace; it is a sentinel rather than NULL so the unique index stays plain and the policy stays out of three-valued logic. **Its policy reads no other table** — see the recursion trap in Decisions |
| `schedule_calendar_prefs` | Which calendars one person is currently showing, and in what colour to them | *Not built.* Lands with the slice that renders the toggle |
| `schedule_items` | One thing on a calendar | `starts_at`/`ends_at` timestamptz + `all_day` + `time_zone` (the zone it was authored in — needed for all-day and recurrence across DST; see [timezone.md](timezone.md)). **`show_as` = `free` \| `busy` \| `tentative` \| `away`** — availability reads this, not mere existence; see Decisions. `kind` OPEN taxonomy (P1). `metadata` jsonb NOT NULL DEFAULT `'{}'` (P2). `parent_id` self-FK, nullable — see Decisions. `sensitivity` = `normal` \| `private`. `cancelled_at` rather than a delete |
| `schedule_item_attendees` | Who is on it | **BUILT.** `clerk_user_id` XOR (`external_email` + `external_name`), enforced by a `num_nonnulls` CHECK. `response` = `needs_action` \| `accepted` \| `declined` \| `tentative`. **This is the assignment data the digest needs**, and it shipped in slice 0 — see Decisions. Its policy inherits from the item; the item's policy calls `app_is_attendee()` rather than reading this table, and that asymmetry is what keeps the pair acyclic |
| `schedule_item_links` | What it is about | *Not built.* Slice 3. Modelled on `mail_links` exactly: `entity_type` carries a FORMAT check and **no value whitelist**, plus `extension_slug`. A pack registers its own linkable types with no migration to core (P3) |
| `schedule_item_overrides` | One occurrence of a recurring item, moved or cancelled | Only exists once recurrence lands. Series live as an RRULE on the item and are expanded on READ — nothing is materialised |

## Key files & seams

Proposed layout. The three-file dependency graph is copied from
`src/lib/mail-extensions/`, because that shape is already enforced by eslint and
already proven by three implementors.

Built for availability:

- `src/lib/schedule/availability.ts` — **the booking seam.** Merge, invert, find
  slots, and `busyForPeople`. Read its header before assuming what "busy" means.

Built for recurrence:

- `src/lib/schedule/recurrence.ts` — parse, format, describe, expand. **Pure.**
  Read its header before touching anything about dates.
- `src/lib/schedule/range.ts` — expands BOTH sources. One expander.
- `drizzle/0102_…sql` + `drizzle/0103_schedule_recurrence_rls.sql` (which also
  replaces `app_schedule_range`).

Built in slice 5:

- `src/modules/scheduling/core/ics.ts` — RFC 5545 serialisation. **Pure.** Read
  its header before touching folding or escaping.
- `src/modules/scheduling/feed-ops.ts` — mint, list, revoke. Never `withSystem`.
- `src/modules/scheduling/feed-serve.ts` — **the only `withSystem` in the
  module**, and the two-phase resolve that keeps it to one query.
- `src/app/api/schedule/feed/[token]/route.ts` — the unauthenticated route.
- `drizzle/0100_…sql` + `drizzle/0101_schedule_feed_tokens_rls.sql`.

Built in slice 4:

- `src/modules/scheduling/attention/source.ts` — what scheduling says needs you.
  Imports `@/lib/attention-sources/types` and nothing else from a module.
- `src/lib/attention-sources/registry.ts` — scheduling registered FIRST.
- `scripts/seed.ts` — `status: "available"`, and a description that passes §3.

Built in slice 3:

- `src/lib/entity-links/types.ts` — **the shared contract.** Imports nothing
  from `src/modules/**`. `MailEntityType` extends it.
- `src/lib/entity-links/registry.ts` — composition root. **Hosts only** —
  `ENTITY_LINK_HOSTS` in eslint.config.mjs is the list.
- `drizzle/0098_…sql` (table) and `drizzle/0099_schedule_links_rls.sql`
  (policies). 0099's header carries the updated policy graph.
- `src/modules/scheduling/link-ops.ts` — search, resolve, attach, detach.

Built in slice 2:

- `src/lib/timezone.ts` — the shared calendar arithmetic. **Read its DST notes
  before touching anything that turns a wall clock into an instant.**
- `src/modules/scheduling/item-ops.ts` — events and attendees.
- `src/modules/scheduling/core/layout.ts` — overlap column packing. Pure.
- `src/modules/scheduling/core/range.ts` — which days each view covers. Pure.
- `src/modules/scheduling/components/calendar-view.tsx` — the grid. Navigation
  is `<Link>`s, so a week is linkable and refresh-proof.
- `src/modules/scheduling/components/event-form.tsx` — create/edit/RSVP.
- `src/app/dashboard/m/scheduling/calendars/page.tsx` — slice 1's list, moved.
- `tests/timezone-calendar.test.ts`, `tests/scheduling-layout.test.ts`,
  `tests/scheduling-view-range.test.ts`, `tests/scheduling-item-ops.test.ts`.

Built in slice 1:

- `src/modules/scheduling/SchedulingModule.tsx` — the renderer, registered in
  `src/modules/index.ts`. Currently the calendar list; slice 2 replaces it.
- `src/modules/scheduling/calendar-ops.ts` — calendars and shares. Takes the
  caller's `tx`; its guards are for MESSAGES, not security.
- `src/modules/scheduling/actions.ts` — gate → Zod → `withSchedule` → audit →
  revalidate. `CALENDAR_COLORS` is the palette enum.
- `src/modules/scheduling/components/calendar-manager.tsx` — the list, the
  create/edit form and the sharing dialog.
- `tests/scheduling-calendar-ops.test.ts` — 9 tests, run as a person.

Built in slice 0:

- `src/db/schema/scheduling.ts` — the four tables, re-exported by the barrel.
- `drizzle/0096_…sql` — tables. **Hand-reordered after generation**; the header
  says why and a regeneration would undo it.
- `drizzle/0097_scheduling_rls.sql` — policies, the four helpers, and the
  projection. Its header carries the acyclic policy graph; read it before adding
  a policy to any of these tables.
- `src/lib/schedule/with-schedule.ts` — `withTenant` with the two options that
  are not optional here.
- `src/lib/schedule/access.ts` — pure. The level ordering and `accessAtLeast()`.
  Safe on both sides of the server boundary.
- `src/lib/schedule/range.ts` — `listRange()`, THE read path.
- `src/lib/schedule/provision.ts` — `ensurePrimaryCalendar()`, called from
  `upsertMembership`.
- `tests/isolation/scheduling.test.ts` — 13 tests.

Designed, not yet built:
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

**The INHERITANCE is `0077`'s, deliberately.** CRM already answered "private by
default, shareable with named people": a grants table, and everything downstream
resolving through a positive EXISTS against the container rather than restating
the rule. `schedule_items` and `schedule_item_attendees` inherit from
`schedule_calendars` exactly the way `crm_affiliations`, `crm_deals`,
`crm_activities` and `crm_tasks` inherit from `crm_party_details`. Two copies of
a visibility rule drift; this is the arrangement that stops there being two, and
it is what links and overrides will inherit for free when they land.

What did NOT survive from `0077` is the `visibility` column it puts in front of
the grants table — see the next decision.

**There is no `visibility` column. Everything is a share.** This is where the
built module departs from the design as merged, and the four access levels are
what forced it: a binary `members` flag cannot say *everyone may see titles but
not details*, which is precisely what a pack publishing a business-wide calendar
wants to say. Copying `crm_party_details.visibility` would have meant two
mechanisms for one idea — the thing `crm.ts` warns "teaches the next reader to
invent a third".

So workspace-wide sharing is a SHARE ROW with the sentinel grantee `''`,
carrying a level like any other grant. Outlook renders it exactly this way:
"People in my organization" is a row in the sharing list using the same dropdown
as a person, not a separate switch. What `0077` contributed is still the shape
of the thing — a grants table plus everything downstream inheriting through one
EXISTS — just without the binary column in front of it.

**Four access levels, and two of them are not RLS at all.**

Outlook offers: *can view when I'm busy* · *can view titles and locations* ·
*can view all details* · *can edit*. The design carried three; the missing
middle one is the interesting case, because it is neither "you may read this
row" nor "you may not" but "you may read some of its columns".

**An RLS predicate can grant or refuse a row; it cannot return a redacted one.**
So the levels split across two mechanisms, and this is the load-bearing fact
about the whole module:

| Level | Mechanism |
| --- | --- |
| `details`, `write` | The row is visible. Ordinary RLS. |
| `busy`, `titles` | The row is **invisible to a direct SELECT**. `app_schedule_range()` returns a projection with the uncovered columns already NULL. |

`busy` therefore appears in no policy. `listRange()` runs both and concatenates
two disjoint sets — the SQL function stops at `access < 'details'` so nothing
comes back twice. **No application code redacts anything**, which was the whole
objection to doing this at the app layer: a `delete row.description` in one
server action is a rule the next surface forgets.

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
`schedule_shares` therefore wants to ask "do I administer this calendar?", which
is a read of `schedule_calendars`, which is the trap.

**And there is a SECOND cycle the design did not predict**, found while writing
the policies: `schedule_items` needs "am I an attendee?" — that is what lets an
invitation show you an item on a calendar you cannot see — while
`schedule_item_attendees` inherits its visibility from the item. items ↔
attendees closes exactly like calendars ↔ shares.

Both are cut the way `0077` prescribed — *"the answer is a SECURITY DEFINER
helper, not an EXISTS"* — with the edge pointing one way in each pair:

| Helper | Rights | Why |
| --- | --- | --- |
| `app_can_admin_calendar(uuid)` | definer | Lets shares' policy ask about a calendar without running its policy |
| `app_is_attendee(uuid)` | definer | Lets items' policy ask about attendees without running theirs |
| `app_calendar_access(uuid)` | **invoker** | Reads only `schedule_shares`, whose policy is self-contained, so there is no cycle to break and no reason to reach for definer rights |
| `app_schedule_range(ts, ts)` | definer | Must read rows RLS deliberately refuses — that IS the projection |

Definer rights are acceptable here for a reason `0061` states precisely when it
refuses them: that file refused them for a trigger that **writes**, where they
would have let it insert a row for any tenant and bought nothing. These read,
return a boolean or an already-projected row, and pin themselves internally to
`app_current_tenant()` and `app_current_user()` — so none can answer a question
about another workspace or widen what the caller may see.

Do not solve the first cycle by denormalising the owner's id onto the share row:
that copy goes wrong the day a calendar changes hands, and it goes wrong
silently.

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

**The digest is the reason attendees shipped in slice 0 rather than being
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
| 0 | ✅ **Shipped.** Schema + RLS + 13 isolation tests. `withSchedule()`. Access-level projection in the read path. Primary calendar auto-provisioned on membership | The visibility rules are the expensive part; prove them against two tenants before any UI exists. The projection lands here because widening a boolean later means rewriting every caller |
| 1 | ✅ **Shipped.** Calendars: create, rename, colour, archive. Share with a person or the whole workspace, at any level. Module registered (seed row still `coming_soon`) | Sharing is the module's defining behaviour and everything else assumes it works |
| 2 | ✅ **Shipped.** Events + attendees + RSVP. Week/day/month over `listRange`. Calendar becomes the module home | Attendees are NOT deferred — see Decisions |
| 3 | ✅ **Shipped.** Links + the shared entity-link contract extracted out of Mail. Nine entity types, no new implementations | Reuses `mail_links`' primitive; makes the calendar part of the product rather than beside it |
| 4 | ✅ **Shipped.** Attention source leading the digest. Seed row flips to `available` | The digest gets its strongest source; the module goes live |
| 5 | ✅ **Shipped.** Per-person subscribe feed: hashed revocable token, ICS, revoke button | Same query as 4, no session. Reaches the person who will never open the app |
| 6 | ⏸ **Deferred** (2026-08-09). Extension seam: item kinds, item fields, managed calendars | Would ship three primitives with zero implementors. Build it with the first real pack in hand |
| 7 | The view seam, with a core view moved onto it | The new primitive, shipped with two users |
| 8 | ✅ **Shipped.** Recurrence: RRULE + overrides, expanded on read | Hardest slice. The feed emits OCCURRENCES rather than the rule — see the build log |
| 9 | ✅ **Shipped.** Free/busy + availability, reading `show_as` | Settled scope: no booking page, but a booking pack can call this. No migration — assembled from slice 0's projection, as designed |

A trade pack (`jobs`, then whatever the profile lists) is Layer 2a and starts
after 7. Its Gantt-style view, dependency edges and progress fields all land in
`src/packs/`, and nothing in `src/modules/scheduling/` changes to accommodate
them. If something does, the boundary was drawn wrong.

## Open items

- **The feed has no rate limiting.** A stranger guessing tokens costs a hash
  and an indexed lookup per attempt, which is cheap for them and cheap for us,
  but nothing throttles it. The token is 32 random bytes so guessing is not a
  realistic threat; a burst limit is still the obvious next thing.
- ~~**The route path has no `.ics` extension.**~~ **Answered 2026-08-18**: a
  real Android client has been subscribed and polling (the token's last-used
  date proves it), and the response's `filename="yosher.ics"` is evidently
  enough. Left here because a client that decides purely by path extension is
  still imaginable; it is no longer unverified.
- **The entity types still live at `src/modules/<slug>/mail/extension.ts`**,
  because that is where they were written when mail was the only consumer. The
  directory name now lies slightly. Moving them to `<slug>/links.ts` is a
  mechanical rename of three files, deliberately not done in the same change as
  extracting the contract — one is a type-level change that cannot alter
  behaviour and the other is a file move across a live module.
- **A mail THREAD is not linkable to an event.** Mail contributes no entity type
  of its own — it is a host, not a contributor — so you can attach an invoice
  to an event but not a conversation. The roadmap line said "and Mail"; that
  needs a `MailEntityType` for threads, which is a Mail change and was not made.
- **Nothing shows the links in the other direction.** There is an index for
  "every event on this invoice" and no reader for it: the accounting invoice
  page does not yet show its events. That is the reverse view, and it needs P5
  nav contribution to be done properly.
- **Working hours are a constant, not a setting.** `DEFAULT_WORKING_HOURS` is
  9–5 Monday to Friday for everybody. A tenant setting is the obvious fix and
  needs the same settings surface the week-start question is waiting on.
- **Nothing renders a "find a time" grid.** The seam computes slots and only the
  event form consumes it, as a conflict warning. A booking pack, or an
  internal scheduling assistant, is what would use `findFreeSlots` properly.
- **THE WEEK STARTS ON SUNDAY, HARDCODED.** A tenant setting is the obvious fix
  and there is no settings surface for this module to hang it on yet. Confirmed
  as acceptable for now rather than assumed.
- **A multi-day TIMED event is drawn on each day it touches**, clamped to that
  column. It is not drawn as one continuous bar across the header the way an
  all-day event is, which is what Google does for a two-day 4pm–11am booking.
  Nothing depends on it; it will look wrong the first time somebody logs an
  overnight job.
- **The month cell caps at three events and then says "+N more"**, and the
  "more" is not clickable. Clicking the day number opens a new event rather than
  expanding the day, which is the wrong instinct once a day is busy.
- **NOBODY HAS CLICKED THE SLICE 1 OR SLICE 2 UI.** It compiles, its actions are covered by
  9 tests through real RLS, and the RLS itself is covered by 14 more — but the
  dashboard is behind Clerk auth, so no agent can reach it and none of this
  says the sharing dialog reads correctly to a human. The questions still open:
  does "Free/busy only" read as a level or as a status, is the pinned
  everyone-row understood as sharing rather than a setting, and does anybody
  find the archive button before they look for delete.
- **`listShares` is loaded for every administrable calendar up front.** One
  query per calendar at page load. Right at a handful, wrong at hundreds, and
  the fix is to load them when the dialog opens rather than to paginate.
- **`app_calendar_access()` is called PER ROW**, both in the items policy and in
  `listRange`'s select list. It is `STABLE`, so Postgres may cache within a
  statement, but nothing has measured it and a busy month view is the query that
  will find out. If it bites, the fix is to resolve the caller's levels once per
  request into a `VALUES` list and join, not to cache a level on a row — the
  level is a fact about the reader, and storing it on the row is how the two
  drift.
- **Nobody has a primary calendar until their next membership sync.** Everyone
  who joined before slice 0 gets one when Clerk next fires a role webhook for
  them, which could be never. `findPrimaryCalendarId()` returns null for those
  people and callers must handle it. A one-off backfill script is the obvious
  fix and is deliberately not written yet — the first surface that needs it
  (slice 2) is where the null actually starts costing something.
- **An attendee-only item comes back with `access: null`**, meaning "you see
  this because you are on it, not because the calendar is shared with you".
  Renderers must treat it as read-only and must not offer to open the
  surrounding calendar. Nothing enforces that yet beyond the field's doc
  comment.
- **Nothing tests a grant on a calendar somebody also ADMINISTERS.**
  `app_calendar_access` short-circuits to `write` for an administrator before it
  looks at shares at all, so a lower grant on your own calendar cannot demote
  you — asserted by reading the function, not by a test.
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
