# 0090. Which side of the business the rail shows is a view, and the books are not in it

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the founder — *"ideally you could tie certain industry packs to a specific company. So if I have multiple companies I can pick an industry for each one."*

## Context

A tenant may run more than one industry: installing a profile is additive and
does not bind ([ADR 0009](0009-packs-are-modules-profiles-install-them.md)), and
the founder's own workspace runs the seven homestead packs beside construction's
three. Every one of them is in the rail, all day, whichever half of the business
he is working on.

He asked for the mapping to hang off the COMPANY, and that is the right
instinct: `entities` is where "which business is this" already lives. The
question was how far the consequence should travel.

Three things were being bundled together, and the codebase already keeps them
apart:

| What differs | Where it lives | Verdict |
| --- | --- | --- |
| Which books | `entities` — a job already carries `entity_id` | already solved |
| Which words | `tenants.labels`, tenant-wide | leave it |
| Which tools are in the rail | nowhere | **this** |

## Decision

**A NULLABLE `entities.industry`, AND IT SCOPES NOTHING.**

One column holding an industry profile slug, or null for "not said". No query
filters on it, no policy reads it, no report groups by it. Its entire effect is
that the rail can put away the packs the chosen side of the business does not
use. Every page stays reachable by URL; the books, the reports and the
consolidation are exactly what they were.

It is deliberately **not a foreign key**: an industry profile is a manifest in
code (Layer 2b), not a row, and a slug whose profile was renamed should read as
"not said" rather than break the books' own table.

**THE CONTROL IS LABELLED BY INDUSTRY, NOT BY COMPANY — and that is the whole
decision, not a detail of wording.**

Accounting already has a company picker. It lives in the URL, `?entity=`, and
a bare URL means something precise: `resolveEntityScope` returns
`{ kind: "combined" }` — **all companies, for everybody**. If a rail preference
set the default for that picker, the same link would show two people different
numbers. In a product that keeps books, a link that does not mean one thing is
the kind of bug that ends in a wrong filing. The picker is also URL state for a
second stated reason — it carries the status filter and the money-bar bucket
alongside the company, and dropping them "would silently widen the list at the
same moment it narrowed it".

So the shell filters **tools** and the page filters **books**, and they are
named differently so nobody expects one to drive the other. The mapping
underneath is still per company; the control reads `Construction`, with
`Shrock Premier` beneath it, so the industry word is grounded in a name somebody
recognises without the control calling itself a company picker.

**A COOKIE, NOT `localStorage`.** The rail is server-rendered, so the preference
must be readable on the server or the first paint shows every row and then drops
half of them. Same weight and shape as the documents browser's view mode: a
display preference, readable by script, `Lax`, scoped to the app.

**NOTHING BELOW TWO INDUSTRIES.** `railContexts` returns an empty list and the
control does not render — the rule accounting's picker already states in its own
words: *the single-company client never learns the concept exists*. A company
that has not said what it does is in every view and is never a view of its own.

**AND IT NEVER HIDES THE PAGE YOU ARE ON.** A link into Jobs from an email,
opened while the rail is set to the farm, would otherwise land somebody on a
page with no row back to its list and no sign of why. `SidebarNav` keeps any row
whose href the current path is inside.

## Consequences

- A builder who also farms sees three industry rows instead of seven, and gets
  the other four back by switching or by opening one of them directly.
- Everything stays wrong in the SAFE direction: no context, an unknown context,
  a context with no profile behind it, or a stored choice that is no longer on
  offer all hide **nothing**. A row that should not be there is a row you
  ignore; a missing one is a feature somebody thinks was taken away.
- `entities` gains a column that the export deliberately does not carry — a rail
  preference is not part of a set of books.
- Enterprises are **not** in this. An enterprise is a reporting dimension, not a
  set of books (*"broilers do not keep their own books"*), and giving a dimension
  its own tool set is how it quietly becomes an entity.

## Alternatives rejected

**Scope modules per entity for real.** Every pack query gains an entity filter,
and `withTenant`/RLS is built on the tenant rather than the entity. A foundation
change for a chrome problem.

**Let the shell set accounting's default company.** The URL argument above. It
is the one option that can produce a wrong number rather than an untidy menu.

**Per-entity vocabulary.** Words changing under somebody as they move between
companies in one session, and a direct reversal of the 2026-08-15 correction
that made labels tenant-wide — `zone` is `land`'s word that `livestock` also
displays.

**Two tenants.** Still the right answer when the two businesses never share a
screen: different books, different people, no consolidated report. The test is
whether one person needs both at once. When they do, this is the cheaper half of
what they wanted.
