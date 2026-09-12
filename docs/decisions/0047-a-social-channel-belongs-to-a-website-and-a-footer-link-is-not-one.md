# 0047 — A social channel belongs to a website, and a footer link is not one

- **Date:** 2026-09-11
- **Status:** Accepted
- **Affects:** Marketing (social), `social_channels`, `sites.settings.social`, migrations 0302/0303

## Context

The founder asked for a social media tool, and opened it with the constraint
rather than the feature: *"most businesses will only have one set of social
media, but the Yosher app business will for example have a facebook for each
industry."*

That is a question about what a social account HANGS OFF, and it has to be
answered before the first table, because every screen in the tool is scoped by
the answer and the writer reads the answer to decide how to sound.

**Most of it was already decided.** [ADR 0045](0045-a-business-may-have-several-websites-and-a-kit-may-belong-to-one.md)
made a tenant hold many websites, each with its own address, logo, look,
domain, enquiries and visitor counts, and its rejected-alternatives table said
in as many words: *"A site is the thing that has a logo, a domain and social
accounts."* Yosher Homestead is a site; the next industry will be another. A
per-industry Facebook is a row keyed on `site_id` and nothing more exotic.

**One thing was in the way.** Since 6c a site's `settings.social` has held up
to eight `{ network, url, label }` links — the marks in the footer. They name
the same networks a channel would, and point at the same accounts. Two places
holding the same URL is the shape that drifts, so the honest options were to
merge them or to say clearly why they are different things.

**And a business with no website can still have an Instagram.** Scoping a
channel to a site with no escape hatch would refuse the most ordinary client
there is: one account, no site yet, Yosher building them one next month.

## Decision

**A social channel belongs to one of the business's websites, or to the
business itself.** `social_channels.site_id` is nullable, the same
nullable-owner shape `brand_kits` already uses, minus the company leg. The
site is the brand; the null is "the business's own account, not any one
brand's". `chooseSite` decides which site a screen is about, so a client with
one website never learns the plural exists.

**A footer link is not a channel, and neither becomes the other.**
`settings.social` stays exactly as it is — a link an owner chose to DISPLAY,
of which `other` is a legitimate kind. A channel is an ACCOUNT THE BUSINESS
POSTS TO. Adding a channel offers, in one tap, to add the matching footer mark;
nothing keeps the two in step afterwards, on purpose.

**The channel carries the two things only a person knows** — who reads it
(`audience`) and how this brand sounds there (`voice`). They are what the
writer will read, and they are the whole reason the homestead Facebook and the
trades Facebook can differ without a line of forked code, which is the
per-client-differences-live-in-config rule applied to a brand.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A channel belongs to the TENANT only | The founder's opening sentence is the plural. A per-industry Facebook would have nowhere to hang, and the writer no brand to read — it would be one voice for every industry, which is the thing being asked to avoid |
| Migrate `settings.social` into `social_channels` and render the footer from it | A jsonb-to-rows migration and a renderer change, to conflate a display choice with a publishing one. An owner may post to five accounts and show two marks, and `other` is a footer link that nothing could ever post to |
| A `brands` table above `sites` | ADR 0045 already answered this by making the site the brand. A second owner means every consumer — kit, domain, enquiry, channel — must ask which one it obeys |
| Hang a channel on `entities` (a company) | ADR 0045 rejected exactly this for logos, and the reason has not changed: a fabricated company in the books, in the entity picker and on the invoice's company selector, to borrow a column |
| One channel shared by several sites | Nothing is asking. A genuinely shared account is one channel with a null `site_id`, and it can be marked in both footers by hand |
| `site_id NOT NULL`, no business-level channel | Refuses the most ordinary client there is: one Instagram and no website yet |

## Consequences

**What it buys.** Yosher's per-industry Facebook is one row, on one set of
books, in one CRM, with one login — and the same table is a single Instagram
for a farm that will never have two of anything. Nothing about the tool's
screens changes between those two businesses except how many rows come back.

**What it costs.**

- **`site_id IS NULL` now means a third thing in the schema.** On `brand_kits`
  a null `site_id` may still be a company's kit, which is why that table needs
  `brand_kits_one_owner` and a two-column predicate (an ADR 0045 consequence,
  and it shipped two live bugs the moment the column existed). Here there is no
  second owner column, so null means exactly one thing — but a reader coming
  from `brand_kits` will expect the harder rule, and the schema comment says so.
- **The drift between a footer mark and a channel is real and accepted.** An
  owner who changes their Instagram handle changes it twice. The alternative
  was a migration plus a false equivalence, and the screen puts the two side by
  side so the mismatch is visible where it matters.
- **`other` is a channel a machine can never post to.** It is allowed anyway —
  a Nextdoor or a Substack belongs in the plan, and in a tool whose first
  version is copy-and-paste there is nothing it cannot do. It can never be
  connected, and the schema comment and the screen both say so rather than
  letting somebody discover it at connection time.
- **Nothing posts yet.** This decision buys the shape; publishing to a real
  network is gated on app review at Meta and elsewhere, not on this table.

## Notes

**What would make us revisit:** a business that wants ONE Facebook page shared
by two websites and shown in both footers with a single handle to maintain.
Today that is a channel with a null `site_id` and two footer marks; if it
becomes common, a join table is the answer and it brings the sharing question
this deliberately avoids — the same question ADR 0045 sidestepped for kits.

**The lesson worth carrying:** the expensive half of this design was done a day
earlier, by somebody writing down in ADR 0045's rejected-alternatives table a
sentence about accounts that the slice itself did not need. A rejected
alternative that explains the SHAPE rather than the slice is the cheapest
documentation there is.
