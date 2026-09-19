# 0097. Accounting splits to the leaf, and a level has somewhere to start

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** the founder — *"a project manager might need the invoicing and bills but shouldn't see anything else. an office person might have access to journal entries, but not certain reports. it needs to be completely customizable."*

## Context

[ADR 0095](0095-a-tool-declares-its-own-parts-and-the-gate-reads-the-path.md)
gave every tool its parts, and gave Accounting twelve: the sections off its nav
strip. Neither of the founder's examples fits inside twelve.

*Invoicing and bills but nothing else* needs Sales and Purchases split from the
rest of Accounting **and from each other's neighbours** — Invoices without the
Catalogue, Bills without the bank. *Journal entries but not certain reports*
needs the seven reports to be seven things.

He was also asked how QuickBooks does it. Below its top tier QuickBooks ships
fixed user types — *Customers and sales*, *Vendors and purchases*, *Reports
only*, *Time tracking only* — and free-form per-area permissions are an Advanced
feature. Most small businesses pick a preset and configure nothing.

## Decision

### Accounting splits to the leaf: twelve areas become twenty-six

Every section that has children gets them: Banking into the registers, Deposits
and Bank rules; Sales into Invoices, Customers, Credit memos, Catalogue,
Recurring invoices and Reminders; Purchases into Bills and Vendors; and Reports
into its seven statements, each its own switch.

**A SECTION'S LANDING PAGE BELONGS TO NO AREA AND REDIRECTS PAST WHAT SOMEBODY
CANNOT OPEN.** `/accounting/sales` used to redirect flatly to `sales/invoices`.
Once each child was deniable, that sent anybody without Invoices into a 404.

Giving the landing page to the Invoices area was tried first **and was worse**:
denying Invoices then hid the Sales tab entirely, stranding Customers —
reachable by URL, with no door anywhere in the product. That is the failure
shape this codebase has shipped before, where the only way to a thing was
through a thing you did not have.

Landing on the first child the reader can open makes any combination work, and
`notFound()` when there is none is honest: every part of Sales is closed to
them, so Sales is closed to them.

**THE REPORTS INDEX FILTERS ITS OWN LIST.** It links to the seven reports
directly rather than through a nav primitive, so nothing else would filter it,
and a tile onto a page that refuses is the failure that makes a permission
screen worthless. With none reachable it says so rather than rendering an empty
grid.

**`FilterPills` FILTERS TOO.** Accounting's sub-navigation — Invoices /
Customers / Reminders — is pills, not the `CategoryStrip` ADR 0095 filtered. A
pill is exactly as much a menu as a tab. Applied to `solid` filter pills as
well, harmlessly: a filter's href is the page you are already on with a query
on the end, so it is never denied, and testing the variant would be a second
rule to keep in step with the first.

### A level has somewhere to start

Five starters — *Sales and customers*, *Bills and purchases*, *Invoicing and
bills*, *Bookkeeping*, *Time only* — offered under the table while their name is
free.

**PICKING ONE CREATES AN ORDINARY LEVEL.** Not a special row, not a template
that reasserts itself. The owner renames, reticks or deletes it like any other,
and after the click there is nothing left of the starter but a name. That is the
difference between a starting point and a policy.

**THE DENIED LIST IS COMPUTED ON THE SERVER FROM WHAT THAT BUSINESS ACTUALLY
HAS.** A starter names keys that *might* exist, so one list serves a farm and a
builder; the level it produces is everything on offer today minus what the
starter allows. Computing it on the client would bake in whatever that page
happened to know, and a stale tab would write a level missing a tool switched on
five minutes ago.

**THE NAMES ARE THE JOB, NOT THE TRADE.** A starter called "Field crew" would
put a construction word in Layer 0, which is the boundary ADR 0004 draws.
QuickBooks' own four are neutral for the same reason and cover the same ground,
which is some evidence the seam is in the right place.

## Consequences

- Twenty-six accounting areas, sixty-one across the product becoming
  seventy-five. The founder's two examples are both expressible, and the
  *Invoicing and bills* starter is the first one exactly.
- `tests/access-starters.test.ts` checks every starter's keys against the real
  registry. A starter naming `accounting:recievables` would allow nothing and
  produce a level quietly narrower than its own description — the opposite
  direction from a leak, and still wrong.
- **Naming a tool allows its parts**, and that line exists because the first
  version did not have it: `tools: ["documents"]` produced a level with
  Documents ticked and all seven parts unticked, so its only reachable page was
  the front door. Every test passed, because the TOOL was allowed. It was found
  by driving the screen and reading *"Documents (some)"* where it should have
  said nothing at all.

## What this does NOT do

- **It is still a screen gate, not a data gate** (ADR 0096). Somebody who keeps
  the Journal can read every entry a report would have summarised. Splitting
  Reports seven ways gives an owner real control over who opens what; it does
  not make a number invisible.
- **It is on or off, never view-versus-edit.** QuickBooks Advanced has that axis
  and this does not. Every case the founder has given is about visibility, which
  binary covers; the first case that genuinely needs *"can raise an invoice,
  cannot void one"* is when to design it, and not before.
- **An area's name is fixed in code**, so a tenant who renames customers to
  clients still sees "Customers" on this screen. The vocabulary machinery exists
  (`LabelDefinition`) and the areas do not use it yet.

## Alternatives rejected

**Leave accounting at twelve and tell him to use companies.** Company scoping is
about whose books, not which screen; it cannot express "bills but not the bank".

**Give the section landing page to its first child's area.** Tried, and it
strands every other child behind a hidden tab.

**Seed starter levels into every workspace.** Rows nobody asked for, in every
tenant, that an owner then has to delete. Offering them is the same help without
the cleanup.

**Ship only starters, no tick boxes.** That is QuickBooks below Advanced, and
the founder's requirement is the opposite: *"it needs to be completely
customizable."*
