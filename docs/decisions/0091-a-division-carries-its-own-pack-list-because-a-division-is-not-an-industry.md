# 0091. A division carries its own pack list, because a division is not an industry

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the founder — *"Shrock Premier has 3 divisions within it. Construction, Excavation, and Cabinet Shop. These are all on the premier books. Not separate books… it would be nice for the cabinet shop division to only see the cabinet shop modules."*

## Context

[ADR 0090](0090-which-side-of-the-business-the-rail-shows-is-a-view-and-the-books-are-not-in-it.md)
gave a COMPANY a line of business, and the rail a switcher built from it. Within
a day it met the case it could not express.

Shrock Premier is **one company, one set of books, three divisions**:
Construction, Excavation, Cabinet Shop. They want different tools — the cabinet
shop needs runs and materials, the excavation crew needs equipment — and
`entities.industry` cannot say so, because the company is one thing and it is in
construction.

The obvious repair is wrong. **A division is not an industry.** There is no
cabinet-shop profile and there should never be one: a profile is a manifest
listing packs for a whole trade, and "cabinet shop" is a way of working inside
one. Inventing profiles for every division is how the industry layer becomes a
dumping ground.

## Decision

**A DIVISION CARRIES THE LIST ITSELF.** `enterprises.packs`, a `text[]`
defaulting to empty. The company's tag stays an INFERENCE — a company is in a
line of business, so its packs follow from the profile — and the division's is
a CHOICE, because nothing can infer it.

Both become the same thing before anything reads them. `railContexts` returns a
context carrying `packs`, and everything downstream reads that and never asks
which kind it came from.

**CORE TOOLS ARE NEVER IN THE LIST.** The founder's own words — *"It will need
all of the core tools too"* — and the reason is structural: every division posts
to the same books, raises the same documents and sends the same mail. Only
Layer 2a packs are ever put away, and the picker does not even offer the rest.

**EMPTY MEANS NOT SAID, AND NOT SAID MEANS NOT OFFERED.** A division with no
packs ticked is in every view and is never a side of its own. That is what keeps
the whole idea invisible to a business with one way of working — the same rule
`railContexts` already keeps for companies, and the one accounting's company
picker states in its own words: *the single-company client never learns the
concept exists.*

**THE CONTEXT KEY IS PREFIXED BY KIND** — `industry:construction`,
`division:<uuid>` — because a division's id and an industry's slug share one
cookie and must not be able to collide. Values written before this read as
"everything", which is the safe fallback rather than a migration.

**TEXT, NOT A FOREIGN KEY.** A pack is a slug in a registry, not a row. A slug
for a pack that was never built, or one switched off later, is ignored when the
rail reads the list rather than made to break a division.

## Consequences

- One company's books can present three different menus, which is what the
  founder asked for and what no amount of per-company tagging could give.
- Everything stays wrong in the safe direction: an unknown context, a retired
  division, a stored choice no longer on offer — all hide nothing. Proved by
  accident while testing: clearing a division's packs dropped the switcher back
  to Everything with the full rail.
- `enterprises` gains a column that has nothing to do with reporting. That is a
  little untidy — the table's own header calls it a reporting dimension — and it
  is still the right home, because a division is the thing the founder points at
  when he says "the cabinet shop", and a second table keyed on the same row
  would be a join for one array.
- The settings screen for divisions gets its first guide, which it did not have.

## What this does NOT do, and the next question it raises

It changes **which tools are in the menu**. It does not change how a tool
behaves inside a division, and the founder asked about that in the same
conversation: *"there has to be a cabinet shop layer to change orders and a
cabinet shop layer for excavating."*

That is a third rung on the config ladder — `profile packConfig` → `tenant_modules.config`
→ *division config* — and it is deliberately **not** built here. Two reasons:

1. **The minor half is cheap but shapeless without a case.** Whether a
   division's config replaces a list or extends it is obvious with one real
   example and a coin-flip without one, and it is expensive to change once three
   packs depend on it.
2. **The major half must not be built in advance at all.** A general
   behaviour layer is a plugin system, and the model already refuses it: Layer 3
   is *"data only, never code."* The sanctioned route is P5, a declared
   extension point — and the lesson written into the last one is that **what a
   provider may do is deliberately tiny**, *"because anything wider unbalances a
   report"*. You cannot design that before you know what the first real case
   needs to be allowed to do; the value is in what it forbids.

**When a real difference turns up, the question is one sentence:** *what is the
smallest thing this division must be allowed to change here?* The answer is the
slot.

## Alternatives rejected

**A profile per division.** Turns Layer 2b into a dumping ground and makes
"cabinet shop" a trade.

**Infer a division's packs from its `kind`.** The kinds are seeded by the
profile (`cabinetry`, `excavation` and four more already exist for
construction), so this looks free. It is not: the kind is a label somebody
picked for reporting, and quietly making it decide menus means changing a
report's grouping changes everybody's navigation.

**Put the list on `enterprises.metadata`.** That bag is P2, for a PACK
extending a core row. This is a core feature of the core table, and a
first-class field in a metadata bag is a migration waiting to happen.
