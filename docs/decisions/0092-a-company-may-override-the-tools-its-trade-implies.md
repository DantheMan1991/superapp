# 0092. A company may override the tools its trade implies, because a trade is not a business

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the founder — *"i don' see where you set set industries per company. nor the modules per company"*

## Context

[ADR 0090](0090-which-side-of-the-business-the-rail-shows-is-a-view-and-the-books-are-not-in-it.md)
gave a company a line of business and inferred its tools from the profile.
[ADR 0091](0091-a-division-carries-its-own-pack-list-because-a-division-is-not-an-industry.md)
gave a DIVISION an explicit list, and drew the line between them in one
sentence: *a company IS in a line of business, so its packs follow from the
profile; a division is not, so it picks.*

The founder asked for "modules per company" the day after, and the half of that
sentence about companies does not survive the question.

**A profile lists the packs a TRADE uses. A company is one business inside
one.** His three are all Shrock and all, loosely, construction: Premier builds,
**Prefab is a factory**, Restoration is something else again. Tagging Prefab
`construction` gets it `assets`, `inventory`, `jobs` and no Production — a menu
that is not its menu, with nothing anywhere to say so. The limitation
`enterprises.packs` fixed one rung down was still sitting at the company level.

The other half of his message was a findability problem with the same root: the
field ADR 0090 added is real and always renders, and the only way to the screen
holding it was a stat card on the accounting overview.

## Decision

**`entities.packs`, a `text[]` defaulting to empty** (migration `0383`) — the
same column `enterprises.packs` already is, because it is the same question one
rung up.

**THE INFERENCE STAYS THE DEFAULT.** `industry` is not demoted to decoration: it
still names the trade, still supplies the list most companies want, and is still
the only thing most clients ever touch. `packs` is the override, and **empty
means not said**, which is what keeps an unrelated rename from quietly
converting an inference into a frozen choice that never sees the next pack a
profile gains.

**A COMPANY THAT HAS SAID ITS OWN TOOLS IS A SIDE NAMED AFTER ITSELF.** It
cannot stay in its trade's row: that row is labelled *Construction* and gathers
every company in it, and two companies with different menus cannot share one.
So it splits out, labelled by its own name with the trade as the line
underneath — *Shrock Prefab / Construction*. A company with tools and no trade
at all is offered under its name alone, which is how Restoration gets a menu
without anybody inventing a profile for it.

**CORE TOOLS ARE NEVER IN THE LIST**, for the reason ADR 0091 gives and one
more: every company here is in ONE workspace, sharing a chart of accounts,
contacts, mail and documents. Only Layer 2a packs are ever put away.

**AND THE SCREEN GETS A ROW IN THE RAIL.** `Companies`, under `Settings`,
directly above the divisions row — whatever the profile calls that one. An
accounting page listed outside the accounting module is unusual
and is the point: it is where the shape of the business is described, a division
is configured one row below it, and the company that holds the division should
not be somewhere else entirely. The stat card stays — a screen may be reachable
twice — and the module row gives the path up so the two never light at once.

**ALWAYS, NOT ONLY ABOVE ONE COMPANY.** Every other control in this family
renders nothing below two, and this one deliberately does not: *the button to
make a second only existed on a list that needed two* is a catch-22 this
codebase has already shipped once, and the companies page exists at one company
precisely so a client can get to two.

## Consequences

- Shrock Prefab can be a factory inside a construction group, which is the thing
  that could not be said before, in any layer.
- The rail's three kinds of side — industry, company, division — arrive at
  `hiddenPacks` as one shape. Nothing downstream asks which kind it came from.
- `RailContext.companies` became `hint`: with a company labelling itself, the
  line underneath is no longer always a list of companies, and a field named for
  one of the three things it carries would be a lie. A division draws no second
  line now instead of an empty one.
- Everything stays wrong in the safe direction. Proved by driving it: a cookie
  naming a company whose packs were then cleared fell back to Everything with
  the full rail.
- `NavItem` gained `excludes`. Every other pair in the rail is separated by
  making the PARENT `exact`, which a module row cannot be — every page inside
  Accounting must light Accounting — so the one sub-path that belongs to another
  row says so, and the module defers.

## What this does NOT do

It changes **which tools are in the menu** and nothing else. No query filters on
`packs`, no policy reads it, no report groups by it, the books are untouched and
every page stays reachable by URL. **The shell filters tools, the page filters
books** (ADR 0090) is unchanged and this does not go near it.

It also does not touch how a tool BEHAVES for a company or a division. That is
still the open thread ADR 0091 ends on, still held for the same reason, and the
question is still one sentence: *what is the smallest thing this division must
be allowed to change here?*

## Alternatives rejected

**Leave it, and tell him to split the companies by trade.** They are one group
on one workspace sharing contacts and a chart of accounts. "Run two tenants" is
the answer when two businesses never share a screen; these share every screen.

**Make `packs` extend the profile's list rather than replace it.** Additive
cannot express *Prefab is construction but not Assets*, and "how do I take one
away" is then a question with no answer. Replace has the honest failure mode:
you see exactly the list you ticked.

**Infer a factory from something the company already has** — a pack with rows, a
division underneath it. Every version of this makes an unrelated act change
everybody's navigation, which is the reason ADR 0091 refused to infer a
division's packs from its `kind`.

**Drop `industry` now that `packs` exists.** It is the shortcut that keeps this
invisible to the single-trade client, it supplies the label a group of companies
shares, and it is what the profile's seed and vocabulary already key on.
