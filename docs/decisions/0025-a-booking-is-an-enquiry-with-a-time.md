# 0025 — A booking is an enquiry with a time, on a calendar the platform provisions

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 8)
- **Affects:** Marketing (the `booking` section, `site_enquiries`'s booking
  columns, `src/lib/sites/bookings.ts`, the `/api/sites/slots` route, the
  booking island), Scheduling (`src/lib/schedule/bookings-calendar.ts`, the
  first managed business calendar), `docs/security.md` trust boundaries
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md),
  [0021](0021-a-website-enquiry-lands-as-a-party.md) (the public write
  path), the scheduling module's availability seam and its everyone-share

## Context

"Book a time" is the second thing a visitor wants to do on a small
business's site after "send a message", and it is the first feature of the
site that crosses into another module's data: the times come from a
calendar, and a booking has to land on one. Three questions had to be
settled before a line was written.

**Where does the record live?** A new `site_bookings` table with its own
policies and its own panel, or the enquiry? A booking is a message with a
time attached — the same person, the same follow-up, the same email to the
business, and the same place on the Website screen. The difference is four
columns.

**Which calendar, and who may write to it?** The public path runs as
`staff` with no user (ADR 0021), and the scheduling policies grant a write
through `app_calendar_access`, which reads the calendar's shares. A person's
calendar cannot be written by nobody. Letting the owner pick any calendar
would mean silently widening its sharing, or a `withSystem` insert that
steps around the policies the module was built on.

**Where do the rules live?** A structured availability setting on the
scheduling side (which has none yet — working hours are a constant), or on
the section itself?

## Decision

**A booking is an enquiry with a time.** `site_enquiries` gains
`booking_starts_at`, `booking_ends_at`, `booking_title` and a soft
`schedule_item_id`; `receiveSiteBooking` does everything `receiveSiteEnquiry`
does — the party, the CRM record when CRM is on, the follow-up ("Confirm the
booking with …", due today), the row, the audit, the email to the business's
own addresses with Reply-To the visitor — and also writes the calendar item
with the visitor as its attendee. The Messages panel shows a booking as a
message with a `booking` badge and the time.

**It lands on a Bookings calendar the platform provisions.** Owned by the
business (`owner_clerk_user_id` null), made once through the managed unique
index (`extension_slug = 'marketing'`, `extension_key = 'bookings'`) when an
owner saves a page with a booking section while Scheduling is on, and
**shared with everyone at `write`**. That share is the whole mechanism: the
anonymous write goes through the same member policies that bound a
colleague, and every member can see and change bookings, which is what a
business calendar is for. A page save puts the share back at `write` if it
was lowered, because without it bookings would stop landing and nothing
would say why.

**The rules live on the section, the busy time on the calendar.** How long,
which days and hours, how much notice and how far ahead are the offer's,
and the offer is a section of a page — read from the PUBLISHED page on every
request, never from the request, like the form's questions. What is taken is
whatever is on the Bookings calendar with `show_as` that occupies time, so a
member blocks a time by putting anything on that calendar. The open times
are `findFreeSlots` over the two, the seam the scheduling module built for a
booking pack that never came.

**A time is offered, never trusted.** The visitor's chosen start is checked
against the times that would be offered at the moment of writing, under a
per-calendar advisory lock, and refused as "just taken" otherwise; the form
then fetches what is left. Two visitors cannot both have 9:00.

**Scheduling off means no bookings.** The section can be added only while
Scheduling is on, the open-times route answers nothing without it, and the
receiver refuses. The guard is the owning feature.

## Consequences

- No booking is confirmed by email to the visitor. The business's addresses
  are the only ones the platform mails to from a public form (security
  table), and a confirmation to an address a stranger typed is a decision
  about outbound mail, not about bookings. The page says "we'll confirm by
  email" and the follow-up is what makes that true.
- The open-times route is the third unauthenticated door into a tenant, a
  read: instants and labels for a published site, an empty list for
  everything else, capped per IP like the others.
- A per-calendar availability setting in Scheduling would let a booking
  section say "as the calendar" instead of carrying its own hours. When that
  setting exists, the section's rules become an override of it, not a
  replacement, and nothing here has to move.
- A business with two things to book (a visit and a consultation) adds two
  sections; both land on the one Bookings calendar. Separate calendars per
  offer is a picker on the section, a later slice.
