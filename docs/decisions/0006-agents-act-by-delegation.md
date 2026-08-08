# 0006 — An agent is a delegation from a person, not a principal of its own

- **Date:** 2026-08-06
- **Status:** Proposed
- **Affects:** Layer 0 — the data access seam, `memberships`, audit; every
  model-driven feature; anything that later runs unattended

## Context

The platform already runs model-driven work in five places — bill coding,
document extraction, the accounting narrative and suggestion helpers, the
Discovery copilot, the health-check interview. All of them are one turn, on
data gathered by the caller, with output that lands somewhere a human confirms.
Nothing yet takes several steps on its own behalf, and the moment something
does, it needs an answer to a question those five never had to ask: **whose
authority is it acting with?**

Two answers already exist in this codebase, and they disagree because the
circumstances differ.

**CRM automation borrows the triggering person.** A rule runs synchronously,
inside the transaction of the person whose action fired it, with their role.
[`automation.ts`](../../src/modules/crm/core/automation.ts) states the
consequence in capitals: an automation can never do something the person who
triggered it could not do themselves. No permission model is written, because
none is needed.

**Mail auto-filing takes the floor.** It rides a cron, reacting to something
that happened in somebody else's system, so there is no person and no session.
It runs as `staff` — the least-privileged honest value — and pays a documented
price: it can never file into an owners-only folder.

An agent is the case neither answer covers. It is asynchronous like the cron,
so there is no transaction to borrow. But the useful ones want a reach the
`staff` floor will not give them, and they take several steps over minutes
rather than one write inside somebody else's transaction.

The decision matters now, before any agent exists, because the third answer
writes itself if nobody stops it: a table of agents, each with a role column, so
an agent can be granted "just enough" permission. That is the shape most
products land on, it would arrive in a migration rather than in a discussion,
and it is the one this ADR closes off. `0085` has just finished making `owner` a
value only `withSystem` can write; whatever agents become, they must not quietly
reopen it.

## Decision

**An agent acts as a delegation from a named person, and never as a principal of
its own.** Every run records a `profile_id` as its principal and executes under
`withTenant(tenantId, fn, { role })` with that person's mirrored role — so it
can do exactly what its principal could do, and nothing else.

No agent record carries a role. No agent may be granted a permission its
principal lacks. Agent writes are audited with the principal in
`actorClerkUserId` and the agent named in `actorLabel`, the split
[`bill-code.ts`](../../src/modules/accounting/ai/bill-code.ts:224) already uses
for `system:` actors.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **An agent identity with its own role** | Requires a permission model the platform does not otherwise have, and creates an actor that outlives the person who configured it. The failure mode is slow rather than dramatic: the first time an agent needs to do slightly more, the cheap fix is to widen its role, and nothing in the system objects. Every RLS policy would need re-reading against a third kind of member. |
| **Always run as `staff`, like the auto-file cron** | Honest, cheap, and the right answer for anything with no person behind it. Rejected as the *general* rule because it makes an owner unable to delegate anything only an owner can see — the agent is permanently less capable than the person who asked for it, in ways that read as broken rather than as safe. |
| **`withSystem` plus an allow-list in agent code** | Moves the tenant boundary out of RLS and into the least trustworthy code in the building. Contradicts S1 and the stated purpose of `withSystem` (webhooks, sync, seeds). An LLM-driven loop is exactly what the backstop exists to catch. |
| **An agent as a real Clerk user** | Superficially free: identity, roles, offboarding and the existing mirror all come along. Rejected because it bills a seat per agent, puts a non-human in the customer's member list where they will click it, needs a mailbox that then receives mail, and makes Clerk the source of truth for something a cron has to reason about locally — which is the problem `0084`/`0085` were written to escape. |

## Consequences

**What this buys.** No permission model, again: the S12 property arrived at from
a fourth direction. RLS already enforces the ceiling and agent code cannot widen
it, because agent code never chooses the role. Offboarding is automatic — when
somebody leaves, their membership goes and their agents stop reading, with no
orphaned actor holding standing access. Every agent action names a human who
could have taken it. And it consumes the role mirror rather than duplicating it:
`0084`/`0085` made the stored role trustworthy so background jobs could rely on
it, and this is the consumer that justifies the work.

**What it costs, honestly.**

- **A principal's role is a ceiling, not a mandate.** A delegation from an owner
  gives that run owner-level reach for its whole duration. Narrowing what an
  agent may do is entirely the tool registry's job; the role will not do it.
  This is the real cost, and it lands on a part of the system that does not
  exist yet.
- **A stale mirror becomes a live security property.** `clerk_role_synced_at`
  was added as an input to a decision nobody was making. Now something reads it,
  a run needs a recency requirement, and "the mirror is stale" needs a defined
  behaviour — refuse, or fall back to `staff`. Deferred to the implementing
  slice, but it cannot be skipped there.
- **There is no platform-level agent in this model.** Anything acting across
  tenants, or with genuinely nobody behind it, has no home here and would need
  `withSystem` behind a superadmin. That gap is real and is the most likely
  reason somebody comes back to this file.
- **Delegations need lifecycle UI** — create, inspect, revoke — before anything
  runs unattended. Not free, and not optional.

## Notes

**The lesson worth keeping: the actor question is the security design, and the
model is almost irrelevant to it.** Two subsystems here answered it
independently and both got it right, for different circumstances and without
reference to each other. The third answer was going to be invented by accident,
in a migration, by whoever built the first agent.

This ADR fixes **only whose authority an agent uses**. It deliberately does not
decide where runs are queued (the single cron already carries four passengers
and a fifth is due with notifications), how spend is metered, what the tools
are, or whether a model may ever act without confirmation. Those are separate
decisions and at least one of them is due sooner than this one.

**Delegation bounds authority, not judgment.** An agent reading inbound mail is
reading attacker-controlled text, and nothing here makes prompt injection safe —
it bounds the blast radius to one person's reach. Structural mitigations
(read-only tools over untrusted content, no tool-set expansion from content,
approval on anything outbound) belong with the tool registry, not with this
decision.

**Status is `Proposed` because nothing is built.** It should flip to `Accepted`
when the first agent slice lands, or sooner if the founder signs it off — the
value of writing it now is that the next session cannot make this choice by
default.

**What would make us revisit:** a genuine platform-level agent, or a client
requiring one to keep working after the delegating person leaves. Both point
back at a principal of its own, and both deserve a new ADR superseding this one
rather than a quiet widening of it.
