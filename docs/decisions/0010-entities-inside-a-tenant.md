# 0010 — A tenant holds many legal entities; the entity owns the books

- **Date:** 2026-08-16
- **Status:** Accepted (slice 1 built 2026-08-16)
- **Affects:** Layer 0 tenancy; the ledger (`journal_entries`, reporting,
  close); banking, invoicing, payables, assets; billing; `docs/architecture.md`
  §4

## Context

Tenancy today is one grain: **tenant = Clerk Organization = one set of books**.
Every one of the 110 tenant-scoped tables hangs off it, and Postgres RLS FORCE
makes it the hard wall (ADR [0001](0001-rls-force-and-separate-app-role.md)).
That has been right for every client so far, because every client so far has
been one business.

Real estate breaks it, and not at the margin. **One LLC per property is the
standard asset-protection structure**, so a landlord with ten doors plausibly
has ten LLCs — ten returns, ten balance sheets, ten bank accounts, one owner,
one bookkeeper, one Saturday morning. QuickBooks answers this with ten
subscriptions and ten logins, which is a large part of why that segment leaves
for Buildium or AppFolio, or stays and separates the ten with Classes in a
single file.

Founder, 2026-08-16: *"I am worried about having a client that say has 10 LLCs
with properties. They are not going to want to have 10 separate accounting
accounts."*

They will not, and tenant-per-LLC gives them exactly that: ten workspaces, ten
chart-of-accounts to keep in step, ten vendor lists, ten subscriptions. Worse,
it makes the one thing such a client does constantly — **paying one LLC's bill
out of another's account** — impossible to record correctly. `withTenant` opens
one transaction with one tenant context, so an atomic write spanning two
entities has no path except `withSystem`, the superadmin god view. A structure
that forces routine bookkeeping through the god view is the wrong structure.

The pressure to make entity a **dimension** is the trap sitting next to the
right answer. `dimension_members` already exists, the migration is one row type,
and it would ship in a week. It is also Classes: it yields a P&L per LLC and
never a balance sheet per LLC, because nothing requires a dimension's debits to
equal its credits.

**The test that separates the two:** a dimension slices one set of books; an
entity *is* a set of books. Ask whether the trial balance has to balance within
it. North Pasture — no, and nobody expects it to. An LLC — always, or it is not
a legal entity.

## Decision

**A tenant is the client relationship. A legal entity is a first-class thing
inside it, and the entity owns the books.**

- `entities` belongs to a tenant. Every tenant has at least one; the common case
  is exactly one and the client never learns the word.
- **`entity_id` goes on `journal_entries`, not on `journal_lines`.** An entry
  belongs to one entity and balances on its own, so the ledger's central
  invariant is untouched.
- **An intercompany transaction is a linked PAIR of entries**, one per entity,
  sharing an `intercompany_id`, written together or not at all. The due-to /
  due-from lines are generated when it is recorded, and consolidation eliminates
  them by following the link rather than by matching amounts.
- The chart of accounts, vendors, customers and contacts stay **tenant-wide and
  shared**. That sharing is most of what "manage it in one place" means.
- Anything with a balance belongs to exactly one entity: bank accounts,
  invoices, bills, fixed assets, period closes.
- **Billing is per tenant**, so ten LLCs is one subscription.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Tenant per LLC** (today's grain) | Ten logins, ten charts of accounts, ten subscriptions. Intercompany becomes impossible to write atomically without `withSystem`, putting routine bookkeeping through the god view. It is the QuickBooks answer and the reason that segment leaves. |
| **Entity as a `dimension_members` type** | Cheapest by far and wrong: nothing requires a dimension to balance, so it gives a P&L per LLC and never a balance sheet. This is Classes. It would also overload a seam that means "cost object inside one set of books" with something that *is* a set of books. |
| **`entity_id` on `journal_lines`** | Lets one entry span entities, which sounds tidier and forces the balance check to become per-entity-within-entry, plus auto-generated balancing lines inside a single entry. It rewrites the invariant at the heart of the module to save writing two rows. |
| **A `tenant_groups` layer above tenants** | Keeps RLS as the wall between LLCs, but every shared thing — chart of accounts, vendors, consolidated reports — becomes a cross-tenant read needing its own authorization story, and intercompany still cannot be atomic. All the cost of separation, none of the benefit of sharing. |
| **Defer until a client asks** | The concept is an afternoon at three test tenants and a backfill of one entity each. After fifty clients it is every report, every export, every reconciliation — plus any client who has already jammed two LLCs into one tenant, whose data comes apart by hand. |

## Consequences

**What this buys.** One login, one bill, one chart of accounts, one vendor list
across ten LLCs, with a real balance sheet for each. Intercompany becomes an
ordinary atomic write inside one `withTenant`. Consolidated reporting is a sum
across entities minus the linked pairs, which is mechanical rather than a
judgement call. The single-entity client — every client today — sees none of it.

**What it costs, honestly.**

- **RLS stops being the wall between LLCs.** Today the database separates
  tenants absolutely. Between two entities of one client, separation becomes
  application code. This is judged acceptable because they share an owner, a
  bookkeeper and a login, so a bug leaks the client's data to the client. **The
  wall that must stay absolute is between clients, and that is untouched.** It
  is still a real reduction in what the database guarantees, and it is the
  strongest argument against this ADR.
- **Every report grows a required scope.** Trial balance, P&L, balance sheet,
  close, reconciliation and every export must state which entity — or that they
  are consolidated. A report that forgets is silently wrong across entities and
  correct for the single-entity client who is testing it, which is the worst
  possible failure signature.
- **Period close becomes per entity.** Ten LLCs can close in different months,
  and `period_closes` currently cannot express that.
- **`architecture.md` §4 needs rewriting.** "Tenant = Clerk Organization" stays
  true; "one tenant, one set of books" stops being true and is currently
  implicit everywhere.
- **Nothing about this helps the client who wants two *unrelated* businesses in
  one place.** A farm and a SaaS company under one owner are still two tenants,
  and the overlap they want is operational (calendar, work, mail) rather than
  financial. That is a different problem and needs its own decision.
- **Migration is not just a column.** `entity_id` must become NOT NULL on
  `journal_entries` after a backfill, and the composite-FK pattern this codebase
  uses means the entity reference has to be `(tenant_id, entity_id)` to keep
  cross-tenant references unrepresentable.

## Notes

**The lesson worth keeping: "how many of these are there?" is a weaker question
than "does it have to balance?"** Entity and dimension look alike from the UI —
both are a thing you group reports by, both want a picker. The invariant is what
tells them apart, and only one of them is a set of books.

**This ADR fixes only the grain.** It deliberately does not decide the entity
picker's UX, whether consolidated is a toggle or a separate report, how
eliminations are presented, or whether an `expert` can be scoped to some
entities and not others. That last one is a real question — a client may well
give their CPA two of ten LLCs — and it is the most likely reason somebody
returns to this file.

**Slice order, so the expensive half can wait.** (1) `entities` + `entity_id` on
entries + picker + per-entity trial balance, P&L and balance sheet. (2)
Intercompany pairs. (3) Consolidation with eliminations. (4) Per-entity banking
and close. **Slice 1 is the one with the leverage** — it is what sells to the
ten-LLC landlord, and 2–4 can be a year later.

**Slice 1 landed on 2026-08-16**, which is what flipped the status. What it
turned into, and the two decisions this file deliberately left open that it had
to close (the ADR is immutable, so they are recorded here rather than above):

- **The scope is a required argument, not a defaulted one.** `EntityScope` is
  `{ kind: "one", entityId } | { kind: "combined" }` and every report engine
  takes it — no optional field, no `undefined` meaning everything. That is the
  answer to "a report that forgets is silently wrong": forgetting is a compile
  error. `"combined"` rather than `"consolidated"` because it eliminates
  nothing, which stays true when slice 2 arrives.
- **The picker is a URL parameter per report, not an ambient selection.** A
  report inheriting its scope from a control on another screen is a report whose
  reader cannot tell whose books they are looking at. The chosen company is
  stamped on the page and in every CSV, exactly where the basis stamp goes, and
  an unknown id 404s rather than falling back.

**Slice 1b followed the same day** and closed the gap slice 1 left, which was
worth having but not sellable on its own: `invoices`, `bills` and
`bank_accounts` each carry an `entity_id` of their own, so every entry a
document posts reads it from the document rather than from the tenant default.
A/R aging, A/P aging and the tax summary take a scope now, having declined one
only because the documents they read had no company.

That slice forced one rule this file did not anticipate, and it is the more
interesting half: **a journal line may not touch a register owned by a different
company than the entry.** Paying Oak Row's bill out of Maple Street's checking
account, as a single entry, leaves Oak's balance sheet showing cash leaving an
account it does not own and Maple's showing nothing — *while the ledger still
balances*. That is exactly the failure signature above, reached from the write
side rather than the read side. It is intercompany, it needs the linked pair
this ADR describes in slice 2, and until that exists the posting engine refuses
it rather than recording it wrongly. The chart of accounts is deliberately not
constrained the same way: two companies' receivables share account 1200 and are
separated by the entry's company, because AR is not a thing anybody reconciles
to a statement.

**Slice 2 landed the same day.** `intercompany_id` links the two halves; the
due-to/due-from legs are generated against ONE shared account per side rather
than one per counterparty, because ten LLCs would otherwise be ninety accounts
and "who owes whom" is a property of the transaction — derived from the links,
the way this module derives everything else. A deferred trigger enforces exactly
two entries in two different companies, and neither leg can be voided or
reversed alone.

The thing this file did not anticipate, and it is worth recording: **the pair
needs no exception to the register guard slice 1b added.** Each leg touches only
its own company's accounts plus a shared affiliate account, so the guard that
refuses a single cross-company entry is exactly what makes the two-entry form
the only representable one. The constraint turned out to define the solution.

**Slice 3 landed on 2026-08-17.** Consolidation with eliminations, and the thing
this file did not anticipate is where the elimination had to LIVE. A scope had
been an ENTRY-level predicate since slice 1 (`journal_entries.entity_id`), and an
elimination is a LINE-level exclusion — so a consolidated scope reusing that
shape would have eliminated nothing while producing a statement that looks right,
balances, and double-counts every intercompany transaction. The answer is the
same instrument slice 1 used: `entityScopeCondition` narrowed to a `FilterScope`
that cannot express consolidation, which turned every existing call site into a
compile error until it said what it does about it, and `ledgerScopeConditions`
returns the filter and the elimination together so no report can take one and
forget the other.

**Consolidated is a THIRD kind, not a redefinition of `combined`** — that
promise, made when `combined` was named, is kept and tested. And **it carries no
`entityId`**: eliminating one side of a pair while keeping the other leaves that
company short, so a consolidated single company is not representable.

**The residual is surfaced.** A manual journal into an affiliate account has no
link to follow, so consolidation leaves it standing — and it has no counterparty
leg to remove with it either, so hiding it would require inventing an equity
plug. That, rather than a preference for candour, is why the report names it.

**Slice 4 landed on 2026-08-17**, which completes the slice list this file set
out. The lock became `entities.closed_through` — a property of a set of books,
which is what this ADR says an entity is — and `period_closes` gained the
company it covers. `assertPeriodOpen` takes a required entity for the same
reason every report engine does, and the failure it forecloses is the sharper
one: a tenant-wide check refuses a write to a company whose books are open, and
accepts one into a company whose books are closed.

**The thing this file did not anticipate: the lock could not be DERIVED.**
Deriving closed-through from `max(period_end)` over the close rows is the
tidier design and the one this module's habits point at — but production held a
lock that came from the old scalar with a single close row on a two-company
tenant, so deriving would either silently unlock the second company or require
fabricating a close nobody performed. The data decided the design, and the
lesson generalises: **derive-on-read is only free when the history is complete.**

**The expand/contract pair closed the same day** (`0152`/`0153`): the column
went NOT NULL and the tenant-wide `accounting_settings.closed_through` was
dropped, once the deploy that stopped reading it was live. The half worth
recording is what did NOT re-run — `0152`'s backfill from the scalar. By then
the scalar was stale against a company that had since closed a further month, so
repeating it would have reopened somebody's July. **A backfill is only safe to
repeat while it is still the source of truth.**

**The mirror case landed on 2026-08-17** — an invoice paid into another
company's account is a linked pair like the bill, with the INVOICE's company
holding the Due-from because it is the side that ends up owed. Building it
exposed something slice 2 had left open: `assertNotIntercompanyLeg` was enforced
in the action layer only, so unapplying an intercompany payment voided one leg
and left the other posted. The guard belongs in the engine, and that is where it
is now. **The generalisable half: a pair is only as atomic as its least-guarded
undo.**

**What is still not built:** a company on fixed assets (the assets pack is
`entityForDocument`'s last caller, including for its period lock). One rough edge worth knowing: a company whose lock
was INHERITED from the tenant-wide scalar has no close row to reopen, so it can
only be closed forward. **And what this deliberately is not:** full GAAP consolidation. No
investment-in-subsidiary elimination, no minority interest, no purchase
accounting. These are commonly owned LLCs rather than a parent holding
subsidiaries — combining them and eliminating intercompany is the whole job, and
most of the rest would be wrong here.

**What would make us revisit:** a client needing one entity's data genuinely
hidden from another's staff — a joint venture where a partner sees one LLC and
not the rest. That wants the database wall back and points at tenant-per-entity
with a group layer, which is a new ADR superseding this one rather than a quiet
widening of it.
