# Access — what each person may open

> Platform-level, not a module. Named sets of what somebody may reach, given to
> people on the Team page. Read [ADR 0093](../decisions/0093-what-somebody-may-open-is-a-gate-which-company-s-rows-they-may-read-is-postgres.md)
> first — the whole design turns on one distinction and the file makes no sense
> without it.

**THE DISTINCTION.** Which SCREENS somebody may open is a gate in application
code. Which ROWS they may read is RLS. Reports, Journal, Trial balance and a
bill's detail page all read the same `journal_lines`; the only difference is
which screen is asking, and Postgres has no concept of that. So areas are gated
and companies will be scoped, and swapping the two is how this becomes theatre.

## Build log

### 2026-09-19 — Access levels, and the gate that covers 349 doors (`claude/access-levels`, ADR 0093)

The founder: *"assign users to a company or even just a division… Turn off
certain features for certain users. Like maybe im fine with an employee seeing
the purchase feature in accounting but I don't want them to have the reports."*
Asked how hard the boundary had to be he chose **enforced in the database**, and
asked per-person or named sets he chose **named sets**.

Three things were asked for and they are not one thing: features per person,
companies per person, divisions per person. This slice is the first, plus the
record the other two hang off.

**`access_levels`** (`name`, `notes`, `denied text[]`) and
**`memberships.access_level_id`**, nullable — migrations `0384` and `0385`.
Null is unrestricted, which is what lets this ship into live workspaces without
changing anybody's access on the day it deploys. Stored as what is OFF, so a
screen built next year is reachable rather than silently missing everywhere.

**THE GATE WENT INSIDE `requireModuleEnabled`**, which already had 349 call
sites because it has been step 4 of the add-a-module workflow from the
beginning. Every page and every action that follows the existing convention is
gated without being edited. The alternative was 349 edits now and one forgotten
call later, and the forgotten one is silent.

**The action surface came free, and it was checked rather than assumed.** Every
`"use server"` file under `src/modules` and `src/packs` that opens a transaction
reaches `requireModuleEnabled` — most through a module-local `gate()`, the
shape `marketing/gate.ts` writes down. `tests/module-gate-scan.test.ts` now
pins that, and the page rule beside it, so the convention is a test rather than
a habit. Proved by deleting the call from one real page and watching 1 of 193
fail.

**TWO ESCALATIONS ARE REFUSED BY POSTGRES, and the second one was one UPDATE
wide.** `drizzle/0085` left tenant context a general UPDATE on non-owner
membership rows — inert while the only meaningful column was the accountant
flag, and not inert at all once `access_level_id` lives there, because null
means unrestricted. `0385` narrows it to owners, and narrows `access_levels`
the same way. Proved by reverting the policy on dev and watching *"REFUSES
staff taking themselves off their own level"* fail, then restoring it.

**The narrowing caught a real call site on day one.**
`setMemberAccountantAction` was `requireTenantOwner()` in app code and passed no
`{ role }` to `withTenant`, so `app.tenant_role` defaulted to `staff` and
Postgres would have refused it. Fixed in the same PR — which is the policy doing
its job on the first day rather than the hundredth.

**Naming.** Not "role": `memberships.role` is already owner/staff/expert and
Clerk owns half of it. Not "job": the `jobs` pack means a construction project.
The screen is **Access** and one row is **an access level**.

Driven on Hilltop Farm: a level called *Field crew* with Jobs, Time and
Documents ticked stored `denied` as the other eleven, and the screen lists what
it cannot open. The gate itself could not be driven through the browser — that
workspace has one member and they are the owner — so it is certified by
`tests/isolation/access-levels.test.ts` instead.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `access_levels` | **One named set of what somebody may not reach.** "Field crew", "Bookkeeper" | `tenant_id`, FORCE RLS. `superadmin_all`; `member_select` tenant-wide; **INSERT/UPDATE/DELETE owners-only** (`app_current_tenant_role() = 'owner'`), because a level is a capability and the people it restricts are inside the tenant. UNIQUE on `(tenant_id, id)` is the target of the composite FK below. Name uniqueness is enforced in code, case-insensitively — two rows an owner named the same thing deserve a sentence |
| `access_levels.denied` | The keys this level may not reach | `text[]` default `{}`. A key is a module slug (`marketing`) or an area (`accounting:reports`). Text, not an FK: a module is a slug in a registry and an area is a constant in code, so a key for something retired is ignored rather than made to break a workspace |
| `memberships.access_level_id` | Which level this person is on | Nullable; **null is unrestricted**. Composite FK `(tenant_id, access_level_id)` → `access_levels (tenant_id, id)`, **NO ACTION** — a SET NULL cascade would hand everybody on a deleted level the run of the workspace |
| `memberships` UPDATE policy | Narrowed to owners (`0385`) | Was non-owner-rows-only (`0085`). Both halves of that are restated rather than dropped, plus `app_current_tenant_role() = 'owner'` |

## Key files & seams

- `src/lib/access/can.ts` — **pure, no imports.** `reaches`, `moduleOf`,
  `normaliseDenied`. The whole model, and the one file to read if the rules are
  unclear.
- `src/lib/access/current.ts` — `deniedFor(tenantId)`, React-`cache`d per
  request. Reads the caller from `auth()`, never `requireTenant()` (which
  redirects). Returns `[]` for an owner, before any row is read.
- `src/lib/access/levels.ts` — the single door onto the table. Takes the
  caller's `tx`; never opens a transaction and never reaches for `withSystem`.
- `src/lib/modules.ts` — `requireModuleEnabled` (both questions),
  `requireAreaReachable`, `canReach`.
- `src/app/dashboard/settings/access/` — the screen. Owners only.
- `src/app/dashboard/team/team-roles.tsx` — `AccessLevelPicker`, where somebody
  is put on one.
- `tests/module-gate-scan.test.ts` — the convention, as a test.
- `tests/isolation/access-levels.test.ts` — the two escalations.

## Decisions & gotchas

- **The screen ticks what somebody CAN reach; the database stores what they
  CANNOT.** The inversion happens in exactly one place,
  `access-controls.tsx`'s `deniedFromTicked`. Ticked-is-allowed is the sentence
  an owner is thinking; stored-as-denied is what keeps a new tool reachable.
- **`{ role: ctx.role }` is load-bearing on every `withTenant` that writes
  here.** Leave it off and the option defaults to `staff` (security.md S3) and
  Postgres refuses the write. That is the correct direction and it will look
  like a bug the first time it happens.
- **`deniedFor` returns nothing-denied when it cannot identify a caller.** It is
  additive, never the only gate — nobody reaches a module page without
  `requireTenant()` having answered first — so failing open here is right and
  failing closed would break support views and route handlers.
- **An unrecognised key is reachable, but a denied module closes everything
  beneath it.** The first keeps a retired module from bricking a level; the
  second keeps a level written today from springing a leak when areas ship.
- **The Access screen states its own limits on the screen.** It does not yet
  limit which company's books somebody sees, and an owner who assumes otherwise
  will act on that assumption. Keep that card honest as the slices land.

## Open items

- **Companies per person is not built.** The next slice, and different
  underneath: `app.entity_ids` in the RLS context, a policy clause on the 17
  tables carrying `entity_id`, and `resolveReportEntity` intersecting with the
  allowed set (about five call sites, which is the good news).
- **Divisions per person has no agreed meaning yet.** `line_dimensions` tags
  LINES, so one journal entry can sit in Cabinet Shop and Excavation at once.
  The fork — reports only, records whose lines are all in one division, or pack
  records only — goes back to the founder with a real case in front of it.
- **Areas inside a module are declared but unbuilt.** `reaches` and
  `requireAreaReachable` take `accounting:reports` today and nothing calls them
  with one. The founder's own example needs the area registry and the twelve
  accounting keys, which is the second slice.
- **No area declares `deniedByDefault` yet**, because nothing has needed the
  other direction. The field is described in `can.ts` and is not a type on
  anything until an area wants it.
- **An owner cannot be restricted**, and this is structural rather than an
  omission — Clerk owns owner-vs-member. If a limited co-owner is ever wanted,
  it is a change to what security.md S6 rests on, not a feature here.
- **Nobody has driven the gate as a restricted person.** Hilltop Farm has one
  member and they are the owner, so the refusals are certified by the isolation
  suite and the predicate by `tests/access-can.test.ts`. The first real staff
  member on a level is the thing still to watch.
