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

**What slice 1 does NOT do, and it is worth knowing before selling it.** Only a
hand-written journal entry can name a company. Invoices, bills, bank rows,
receipts and recurring journals all post to the tenant's DEFAULT company,
because no document carries an entity yet — that is slices 2 and 4. So a
ten-LLC landlord can keep ten separated sets of books, but only by journaling
into them. The eleven posting sites that call `getDefaultEntityId` explicitly
are the list of what the document slice has to revisit.

One rule was added that this file did not anticipate: **a document's entries all
land in the company its FIRST one did** (`entityForDocument`). It is not
headroom — the default can be moved, so without it an invoice issued under one
default and paid under another would split its AR across two balance sheets.

**What would make us revisit:** a client needing one entity's data genuinely
hidden from another's staff — a joint venture where a partner sees one LLC and
not the rest. That wants the database wall back and points at tenant-per-entity
with a group layer, which is a new ADR superseding this one rather than a quiet
widening of it.
