# 0011 — Machine-posted entries ride the authorisation of the act

- **Date:** 2026-08-21
- **Status:** Accepted
- **Affects:** accounting module — `core/guards.ts`, `core/posting.ts`; every pack that posts (`inventory` first, `retail`, `production` and `livestock` through it)

## Context

`postEntry` has always required the owner role to post:

```ts
if (input.status === "posted") requireOwnerRole(ctx);
```

That was right while every posting was a person writing a journal, an owner
issuing an invoice, or an owner running depreciation. Nothing in the ledger was
a side effect of somebody else's work.

**Perpetual inventory ends that.** `inventory` slice 3 posts on every movement —
each receipt debits inventory, each issue credits it against cost of goods — and
those movements are deliberately *not* owner-level:

- `livestock` settled the write levels on 2026-08-15: "Movements and merges are
  chores; items, lots, archiving and splits stay with the owner because each of
  them creates or retires a cost object." A farm hand feeding animals is not
  making a financial decision.
- `retail`'s till exists so a **staff member** rings up sales at a market stall.
  Its whole design is one person, one phone, no signal.
- `production` runs are recorded by whoever ran them.

So the owner check and the write levels now contradict each other. Under the
existing rule, adding perpetual posting silently makes feeding animals,
selling at a market and processing a batch all owner-only — reversing three
decisions that were each made deliberately, for a reason recorded at the time,
and breaking features already shipped and live.

The question is not whether staff may cause a journal line. It is where that
authorisation is decided.

## Decision

**Authorisation for a machine-posted entry happens at the operational boundary,
not at the ledger.** A small, explicit set of entry sources —
`MACHINE_SOURCES` in `core/guards.ts` — posts without the owner check;
everything else, including anything that does not name a source, still requires
an owner.

`requireOwnerRole` is replaced at the one call site by `requirePostingRight(ctx,
input.source)`. The reasoning it encodes: a staff member allowed to issue feed
was allowed by `requireModuleEnabled` plus the pack's own write level, and the
journal line is a **consequence** of that decision rather than a second
decision to be authorised separately. Refusing at the ledger would not add a
control; it would only make the act fail after the operational check had already
said yes.

**An expert never posts, machine-sourced or not.** That role is read plus
close-review by definition, and an outside accountant issuing feed is not a
thing that should happen.

**What keeps this from being a privilege escalation is that `source` is not user
input.** It is absent from `entryInputSchema`, so nothing arriving over the wire
can name one, and a caller that does not set it gets `"manual"`. Only trusted
server code inside a pack's ops can put a string in this set.

The set is deliberately minimal. `depreciation` is a machine source by every
argument above and is **not** in it, because nothing needs it to be — it runs
from an owner's screen today, and loosening a rule no caller is asking about
only widens what has to be reasoned about later.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Raise inventory writes to owner-only** | Honest, simple, and it reverses `livestock`'s write-level decision, breaks `retail`'s till at the stall it was built for, and makes production runs an owner errand. Three deliberate decisions undone to preserve a check that was never protecting anything at this boundary. |
| **Post machine entries as DRAFT for an owner to sweep** | Keeps the gate on anything that reaches the books, and gives up most of what perpetual was chosen for: the ledger sits behind the stock ledger by however long nobody has swept. If the sweep is monthly it *is* the periodic method, with extra steps and a second thing to forget. |
| **Elevate the pack's `ctx.role` to `"owner"` before calling `postEntry`** | The cheap version, and a lie in the audit trail: `created_by_clerk_user_id` would record a staff member holding a role they do not have, and every later reader of that row would be misled. The seam should say what is true — this entry was machine-produced — not misrepresent who asked. |
| **Give staff the owner role in tenants that use inventory** | Solves it by deleting the distinction, and takes bank connections, period close and manual journals with it. |
| **A separate `postMachineEntry` entry point that skips the guard** | Two doors into the ledger, one of them explicitly the unchecked one. Every future caller then picks, and the wrong pick is invisible in review. One door that asks what produced the entry is harder to get wrong. |

## Consequences

**What it buys.** Perpetual inventory is possible without reversing three
write-level decisions or breaking shipped features. The rule that emerges is
also a clearer statement of what the ledger's role check was ever for: journals
are decisions and need an owner; postings that merely record an authorised act
do not.

**What it costs.**

- **`MACHINE_SOURCES` is now a privilege boundary, and it does not look like
  one.** It is a `Set` of strings; adding an entry to it is a one-line diff that
  grants unowned posting rights to a whole class of entries. The comment above
  it says so in capitals, and that is a weaker control than a type or a test.
- **The safety depends on `source` staying out of user input.** It is out today
  and there is no reason to put it in, but nothing *enforces* that — if a future
  action ever accepts a source from the wire, this set becomes an escalation and
  the check has to move. That is the single thing to re-examine before adding
  any client-settable field to an entry.
- **Staff can now cause postings they cannot see.** `inventory` writes to the
  books from screens that do not mention the books. The audit trail records who
  and what, so it is traceable rather than anonymous, but "I did not know
  feeding the pigs touched the ledger" is now a true statement somebody may
  make.
- **A staff member can push a company into a period that is open and should not
  be.** `assertPeriodOpen` still runs, so a closed period is still closed; an
  open one that an owner *intended* to close is not protected by anything here.
- **It sets a precedent packs will reach for.** `retail`'s revenue posting and
  `production`'s work-in-progress are the obvious next two, and both have a good
  claim. That is the intended reading — but each addition should be argued in a
  PR rather than assumed from this ADR.

## Notes

The distinction worth keeping: **a control that fires after the decision it was
meant to influence is not a control.** The owner check at `postEntry` was
protecting the act of choosing to record something. By the time `inventory` calls
it, the choosing already happened, was already authorised, and the stock ledger
already recorded it. What was left was a check that could only produce a
half-written transaction — the movement in, the journal line refused.
