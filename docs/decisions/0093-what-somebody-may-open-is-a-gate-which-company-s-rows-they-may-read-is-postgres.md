# 0093. What somebody may open is a gate; which company's rows they may read is Postgres

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** the founder — *"I'm going to want to be able to assign users to a company or even just a division… We need to start building a permission tool for users. Turn off certain features for certain users. Like maybe im fine with an employee seeing the purchase feature in accounting but I don't want them to have the reports."*

## Context

The workspace has had three roles since the beginning — `owner`, `staff`,
`expert` — and nothing between them. A staff member reaches every tool the
business has switched on.

[ADR 0090](0090-which-side-of-the-business-the-rail-shows-is-a-view-and-the-books-are-not-in-it.md),
[0091](0091-a-division-carries-its-own-pack-list-because-a-division-is-not-an-industry.md)
and [0092](0092-a-company-may-override-the-tools-its-trade-implies.md) put rows
away from the RAIL, and every one of them says in its own words that it scopes
nothing and is a view the person chose. That was right for what they were, and
it is not what is being asked for here. **A view somebody can undo is not a
permission.**

The founder asked for three things in one breath, and they are not one thing:

1. Turn features off for a person — *"Purchases yes, Reports no"*.
2. Assign a person to a COMPANY, so they see only that company's information.
3. Assign a person to a DIVISION, likewise.

He was asked how hard the boundary needed to be and chose **enforced in the
database**, and whether permissions should be per-person or named sets and
chose **named sets**.

## Decision

### The split that decides everything else

**WHICH SCREENS SOMEBODY MAY OPEN IS A GATE. WHICH ROWS THEY MAY READ IS RLS.
The two cannot be swapped, and trying is how a permission system becomes
theatre.**

RLS answers questions about ROWS. "Dave may not open Reports" is not a question
about rows: Reports, Journal, Trial balance and the bill detail page all read
the same `journal_lines`, and the only difference between them is which screen
is asking. Postgres has no concept of which screen is asking. Passing one down
as another setting would make the application the thing deciding, with a great
deal more machinery and a false sense of enforcement.

So:

- **Areas are a server-side gate**, in one predicate, called from one place.
- **Companies are RLS**, because "this bill belongs to Prefab" genuinely is a
  fact about a row — and there a leak matters, because it is money.

This ADR builds the first half and the record both halves hang off. The second
half is the next slice and is deliberately not started here.

### A level is a named set of what somebody may NOT reach

`access_levels` — `name`, `notes`, `denied text[]` — and
`memberships.access_level_id`, nullable.

**NOT CALLED A ROLE.** `memberships.role` is already owner/staff/expert and
Clerk owns half of it; a second thing called a role in the same table would be
read wrongly by somebody inside a year. "Job" was the other candidate and
collides with the `jobs` pack, where a job is a construction project. The screen
is **Access** and one row is **an access level**.

**NULL IS UNRESTRICTED, AND THAT IS WHAT MAKES IT SHIPPABLE.** Every membership
that exists today reads as null and keeps exactly the access it has. An owner
takes things away deliberately, one person at a time. A permission system that
changed everybody's access on the day it deployed would be found out by a
client rather than by us.

**STORED AS WHAT IS OFF**, the same direction [ADR 0089](0089-a-job-tab-is-configuration-not-a-pack.md)
chose for job tabs, and for a reason that is about people rather than
principle: a screen built next year would otherwise be missing for every level
in every workspace, silently. Stored this way it is reachable and an owner takes
it away — visible and correctable. An area sensitive enough to want the other
direction says so **in code**, where the area is declared, so the decision is
made once by whoever builds it.

**A DENIED MODULE DENIES EVERY AREA IN IT.** A level written today names
`accounting` because that is all there is to name; the areas ship next month,
and without this rule every one of them would be reachable by everybody who was
denied the whole tool.

### The set says what; the membership says where

The level does **not** hold which companies. Three companies by four jobs is
twelve levels to maintain and four more the day a company is added. A job and a
place of work vary independently, so they are stored independently — the level
says what Dave does, his membership will say whose books he does it in.

### The gate goes where the convention already is

`requireModuleEnabled(tenantId, moduleId)` has **349 call sites**, because it
has been step 4 of the add-a-module workflow since the beginning. The person
check goes inside it. Every page and every action that follows the existing
convention is gated without being edited, and a module page written next year is
gated by following the same convention rather than by remembering a new one.

The alternative is 349 edits now and one forgotten call later, and the forgotten
one is a silent hole.

It reads the caller from `auth()` rather than `requireTenant()`, which
redirects — a redirect thrown from inside a module check would turn "this tool
is not yours" into a navigation somewhere else, from 349 places not expecting
one. And it returns NOTHING DENIED when it cannot identify a caller, which is
the right way round precisely because it is never the only gate: nobody reaches
a module page without `requireTenant()` having already answered for them.

**`notFound()` for both halves, and the same one.** A person who may not open
Reports gets what they get for a module the business never bought. Telling them
apart tells them what exists.

### The two escalations Postgres refuses

App code being the only thing between a restricted person and their own
restrictions is not "enforced in the database". Both of these are policies:

1. **Rewriting the level.** `access_levels` is owners-only for INSERT, UPDATE
   and DELETE (`drizzle/0385`), the shape `drizzle/0085` used one tier up.
   SELECT stays member-wide: the gate reads the caller's own level on every
   request, and what you may not open is not a secret from you.
2. **Rewriting your own membership.** This is the one that would have been **one
   UPDATE wide**. `0085` left tenant context a general UPDATE on non-owner
   membership rows, which was inert while the only meaningful column was the
   accountant flag. `access_level_id` is not inert, and null is unrestricted, so
   a staff member could have nulled their own. The policy narrows to owners.

Nothing is lost: the only tenant-context writer of `memberships` is
`setMemberAccountantAction`, already `requireTenantOwner()` in app code. It did
not pass `{ role }` to `withTenant`, so it would have started failing — which is
the policy doing its job on the first day rather than the hundredth.

**An owner is never restricted**, three times over: Clerk owns owner-vs-member
(security.md S6) and is read before any row is consulted; `0085` refuses tenant
context any write to an owner row; and the app says so with a sentence.

### Deleting a level is refused while anybody is on it

NO ACTION, not SET NULL. A cascade to null would hand everybody on the deleted
level the run of the workspace, silently — the one direction this feature must
never fail in. The database refuses and the screen says how many people to move
first.

## Consequences

- An owner can say "Field crew opens Jobs, Time and Documents" once and give it
  to as many people as they hire.
- The menu and the page cannot disagree: both read `deniedFor`, cached per
  request. A row hidden whose page still served would make the screen
  worthless; a row shown whose page 404s is a bug report.
- **The action surface came free**, and this was checked rather than assumed:
  every `"use server"` file under `src/modules` and `src/packs` that opens a
  transaction reaches `requireModuleEnabled`, most through a module-local
  `gate()`. `tests/module-gate-scan.test.ts` pins both that and the page rule,
  so the convention is now a test instead of a habit.
- `requireModuleEnabled` now does two things, and its name says one. Renaming it
  across 349 sites would bury the change it is part of; the header says what it
  does and the ADR is cited there.
- **It is not yet what the founder asked for.** He led with assigning people to
  companies, and that is the next slice. The Access screen says so in plain
  words on the screen itself, because the gap between what this does and what
  somebody will assume it does is where the harm lives: an owner who believes a
  level hides money will act on that belief.

## What this does NOT do

- **It does not limit which company's books somebody sees.** Next slice, and
  genuinely different underneath: `app.entity_ids` in the RLS context and a
  policy clause on the 17 tables that carry `entity_id`, plus intersecting
  `resolveReportEntity`.
- **It does not limit a division.** A division is not stamped on a record —
  `line_dimensions` tags LINES, so one journal entry can have lines in Cabinet
  Shop and Excavation. "Show only Cabinet Shop" has no obvious meaning for a
  record that is half somebody else's, and guessing would be expensive. The
  question goes back to the founder with a real case in front of it.
- **It does not restrict an owner**, and cannot. A limited co-owner would mean
  taking owner-vs-member off Clerk, which is a much larger change to the thing
  security.md S6 rests on.

## Alternatives rejected

**Per-person checkboxes.** Right at a handful of staff and the founder's own
example, but he chose named sets and the reasoning holds: twelve people drift
into twelve configurations, and a new hire is twenty decisions instead of one.

**Grants rather than denials.** What a security textbook asks for, and wrong
here for the reason given above — and because it would change every existing
member's access on the day it deployed.

**A second call beside `requireModuleEnabled`.** 349 edits, and the one that
gets forgotten is a hole nothing reveals.

**Enforcing areas in RLS.** Some areas map to their own tables and could be
done; Reports, Journal and Trial balance do not and cannot. A rule that is hard
for a third of its cases and soft for the rest is worse than a uniform, tested
gate, because it invites people to trust the soft two thirds.
