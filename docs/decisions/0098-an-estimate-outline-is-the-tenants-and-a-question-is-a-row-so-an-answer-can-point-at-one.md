# 0098. An estimate outline is the tenant's, and a question is a row so an answer can point at one

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** founder, with the estimate interview (X1) as the forcing case

## Context

The founder asked for a layer over estimating: instead of typing an estimate
line by line, you walk the house with the software and answer questions —
*"Let's start with the foundation. Are you doing this in-house or bidding?
Block or poured? Looks like the footer is 24 inches, is that right? Any
rebar?"* — and the estimate fills itself in behind the conversation. His
target is **a bid done in forty-five minutes**, and his constraints were
explicit: it must be a layer that can be turned off, it starts with one
client to prove the idea, and it must be able to reach everybody later.

Most of what such a tool needs already exists in the pack. The takeoff pushes
a measured quantity onto an estimate line (ADR 0074), assemblies drop a saved
item at another size (ADR 0086), price memory fills a cost from what this
business charged last time (E4a), and `updateEstimate` writes a whole estimate
— groups, lines and all — in one call (ADR 0082). What is missing is the
conversation, and before the conversation, **what it says**.

Three questions had to be answered before a word of the interview was written:
**whose the script is**, **what a question is made of**, and **how a business
gets the layer at all**.

## Decision

**AN OUTLINE IS THE TENANT'S DATA, NEVER A SCRIPT IN THE PACK.** Three tables
— `job_estimate_outlines`, its steps and their questions — owned by the
tenant, seeded from a profile the way cost code lists are (ADR 0057), and
editable to nothing from the first day. The tempting shape was a function with
the founder's own conversation inside it, and it is wrong twice over: a remodel
is not a new build and neither is a tenant fit-out, so one business needs
**several**; and a pack must never carry one business's sizes or prices, which
`tests/packs.test.ts` scans for. The construction profile therefore ships a
**New build** and a **Remodel** starter whose questions ask and never answer —
*"How wide is the footing?"* ships, *"24 inches"* does not.

**A COST CODE IS TEXT, NOT AN ID.** `resolveCostCode`'s call for assemblies
(ADR 0086), for its reason: a code's id belongs to ONE cost code set, and an
outline is walked on every job this business runs, some on the residential
list and some on CSI. The digits are matched when the interview reaches a job,
and no match means no code rather than a near one.

**A QUESTION IS A ROW.** The cheap shape is a `jsonb` array of strings on the
step; it costs nothing today and everything later. An answer recorded against
a question ID is what lets an interview be resumed exactly, lets a finish gate
say *"you answered this and no line came of it"*, and lets a builder ask in
six months why a bid never covered the sump. A string in an array has no
identity to point at. The same reasoning makes the editor's save **keep a
row's id** — given by id it is updated, absent inserted, left out removed
(ADR 0082's rule) — because a save that re-created its rows would orphan a
transcript every time somebody fixed a typo, and nothing would fail.

**NOTHING BRANCHES.** There is no condition column and there will not be one.
**Coverage is the outline's job and judgement is the interview's**: *"any
rebar?"* is skipped when the answer was block, and the skip is recorded with
its reason rather than encoded here in a rule language a builder would have to
maintain. A question's `notes` carries *"only when they are pouring"* as prose,
for the interviewer to read. This is the division the whole feature rests on —
the outline promises that nothing is missed, the model decides what to say.

**TWO FLAGS, BECAUSE THERE ARE TWO DECISIONS.**
`config.estimateInterviewGranted` is ours, superadmin-only: which businesses
have the layer. `config.estimateInterviewOff` is theirs, owner-only. Collapsing
them into one switch was the obvious move and the wrong one — *"we are piloting
this with one client"* and *"any client may switch on a feature we have not
priced"* are different statements and one flag can only make one of them. The
tenant's key stores the REFUSAL, `tabsOff`'s rule: a granted tenant has it on
without clicking anything, because a pilot that arrives invisible is a pilot
nobody runs.

## Consequences

- Two new screens behind the gate — the outline list and its editor, at
  `/dashboard/m/jobs/estimate-outlines` — and a 404 for a business without the
  grant, because a screen that says "you do not have this" advertises something
  nobody can buy yet. Owner-only to write, member-wide to read: an estimator
  being walked through an outline has to be able to read it, and RLS is
  row-level rather than verb-level, so the split is `requireWrite` in the ops
  and a member-wide policy underneath.
- A new outline can be **read off a cost code list**, because a business's
  chart of cost is already its phases in the order it builds them; every
  generated step asks the one question that is true of every phase of every
  job — who is doing it — and the builder writes the rest.
- Two migrations: `0389_motionless_paladin.sql`, hand-reordered so both
  parents' unique indexes precede the composite keys that reference them
  (0379, 0356 and 0352 all had to be), and `0390_job_estimate_outlines_rls.sql`.
  **No `AS RESTRICTIVE` company-scope clause** (ADR 0094), unlike
  `job_estimates`: an outline belongs to the tenant and to no company, exactly
  as a cost code list and an assembly do.
- **The writes batch, and they have to.** A loop that inserted a step, selected
  its questions and inserted each one is a round trip per row; the two starters
  are 56 steps and 150 questions, and a profile install took past thirty
  seconds and timed the seed test out. Ids are minted in the application so the
  whole tree is known before a single write, and each table takes one multi-row
  insert.
- The estimate editor is **not touched by any of this**. That is the claim of a
  layer and it is what makes the pilot safe: switching the grant off leaves
  ordinary estimates behind with nothing orphaned.
- Not built, on purpose: the interview itself, which reads an outline and holds
  the conversation; bid requests to subcontractors, which the *Bidding it out*
  answer implies and which is a feature of its own; quantities imported from a
  Revit schedule; and a takeoff opened inline from a question. Each is its own
  slice, and each is worth less than this one without it.
