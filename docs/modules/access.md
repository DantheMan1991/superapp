# Access — what each person may open

> Platform-level, not a module. Named sets of what somebody may reach, given to
> people on the Team page. Read [ADR 0093](../decisions/0093-what-somebody-may-open-is-a-gate-which-company-s-rows-they-may-read-is-postgres.md)
> first — the whole design turns on one distinction and the file makes no sense
> without it.

**FOURTEEN TOOLS, SIXTY-ONE AREAS, AND 49 POLICIES.** Three slices, three
ADRs: 0093 the levels and the module gate, 0094 the company scope in Postgres,
0095 the parts of every tool.

**THE DISTINCTION.** Which SCREENS somebody may open is a gate in application
code. Which ROWS they may read is RLS. Reports, Journal, Trial balance and a
bill's detail page all read the same `journal_lines`; the only difference is
which screen is asking, and Postgres has no concept of that. So areas are gated
(ADR 0093) and companies are scoped (ADR 0094), and swapping the two is how this
becomes theatre.

## Build log

### 2026-09-19 — A route handler is a door too (`claude/gate-route-handlers`, ADR 0096)

Asked to make the restrictions finer, the first thing worth doing was auditing
what the existing ones actually cover. **Nineteen route handlers read tenant
data and NOT ONE called `requireModuleEnabled`.** Twelve called
`isModuleEnabled`, which asks whether the BUSINESS has the tool and never
whether this PERSON may reach it.

So somebody whose level denied Accounting outright could still
`GET /api/accounting/invoices/<id>/pdf` and be handed the invoice. They need the
uuid, and uuids are in URLs, in emails, and in lists the same person can see on
screens they do have.

ADR 0093 and 0095 both argued from "349 call sites, the universal chokepoint".
It is the universal chokepoint for PAGES and SERVER ACTIONS. It is not one for
route handlers, and nobody checked — including
`tests/module-gate-scan.test.ts`, which looked at `page.tsx` and `"use server"`
files and had the same blind spot the convention did.

`routeGate(tenantId, moduleId, areas?)` returns null or a `Response`, because a
handler cannot `notFound()`. Nine signed-in data routes now use it. **Every
area mapping came from the screen that LINKS to the route**, never from its
name: `/api/accounting/documents/[id]/file` sounds like Documents and is linked
only from the accounting Inbox. Guessing from names is how `0387` attached a
policy to `journal_entries` because a column was called `entry_id`, two
migrations ago.

`areas` is ANY-OF: a commitment PDF is linked from both Ordered and
Commitments, and demanding both would refuse people who should not be.

The scan test now covers handlers in both directions — every one that reads
tenant data calls `routeGate`, and none settles for `isModuleEnabled`. Proved by
deleting the call from the invoice PDF route: 1 of 228 failed.

**And the thing that matters more than the fix:** a screen gate is not a data
gate. Denying `accounting:reports` hides the Reports pages; the same money is in
the Journal, the trial balance and a bill's detail. If the intent is "must not
see what we spend", areas do not deliver it and an owner who believes otherwise
has been misled by a tick box. Only a row rule does, which is ADR 0094's kind of
work, per dimension.

### 2026-09-19 — Every tool, not just accounting (`claude/tool-areas`, ADR 0095)

The founder, correcting me: *"you said accounting areas after that, but it is
much more than just accounting areas. every tool needs to have the ability to
have features restricted."*

Right, and it changes the SHAPE rather than the size. One accounting list would
have made areas a thing core knows about; **a tool declaring its own** makes
them a property of the tool. `AreaDefinition` sits on `ModuleDefinition` and
`PackDefinition` beside the slug and the icon, filled in for all fourteen
renderable tools **from the real route tree** under `src/app/dashboard/m/<slug>/`
rather than from imagination — sixty-one areas.

Not a central registry, because a central registry is a file somebody has to
remember to edit, and this codebase has the cautionary tale: five packs shipped
rendering a generic box because nobody added their key to the icon registry.

**THE GATE READS THE STAMPED PATH, SO NO PAGE WAS EDITED.** `src/proxy.ts`
stamps `x-yosher-path` on every request from the request's own URL, overwriting
anything a client sent — which is what makes reading it safe.
`requireModuleEnabled` derives the area and checks the same `reaches`. All 349
call sites gained it the way they gained the person check: by not being touched.

**THE MENU IS FILTERED IN `CategoryStrip`**, the one primitive eight nav strips
render through. It is a client component holding only hrefs, and turning an href
back into `accounting:reports` needs the feature registry — which imports every
module's `Component`. So the server translates once in the layout and hands down
finished route prefixes through `AccessProvider`; the client compares strings.
Never the section you are standing in, the rule the rail already keeps.

**A CIRCULAR IMPORT BIT IMMEDIATELY AND IS WORTH KNOWING ABOUT.**
`@/lib/features` merges the registries, which import every module's `Component`,
which import `src/lib/modules.ts`. A static import of `getFeature` there closed
the loop: `packRegistry` was `undefined` when `features.ts` initialised and
**five suites failed to LOAD** with *"Cannot convert undefined or null to
object"*. `await import()` inside the already-async gate breaks it without
moving the declarations away from the tools that own them.

The tool's front door is never an area, so a level that takes every area away
leaves a working overview rather than a tool whose only page 404s. And
`Settings → Companies` now checks `accounting:companies`, since it is a section
of Accounting.

Driven with a temporary log in a real request, because the resolution is the one
link no unit test covers: `/dashboard/m/accounting/reports` →
`accounting:reports`, `/dashboard/m/accounting` → `null`,
`/dashboard/m/jobs/warranty` → `jobs:warranty`.

### 2026-09-19 — The company scope, enforced by Postgres (`claude/companies-per-person`, ADR 0094)

The other half, and the half RLS can actually answer. `memberships.entity_ids
uuid[]`, empty = every company, so every membership that exists keeps what it
has.

**THE HARD PART WAS NOT THE POLICIES. IT WAS GETTING THE CALLER INTO THEM.**
`withTenant` has 877 call sites, and an optional argument that grants every
company when omitted is not a boundary — it is a boundary with 877 chances to be
forgotten, in the direction that leaks. Making it mandatory is a
compiler-checked sweep of 877 files that buries the change and cannot be
reviewed. So the transaction resolves the caller itself, from `auth()`, in
`src/db/acting-user.ts`. Not `requireTenant()` (circular import, already noted in
`withTenant`'s own header) and not `AsyncLocalStorage` (it needs a callback
enclosing the work, and `requireTenant()` returns a value rather than wrapping
the render).

A separate GUC from `app.clerk_user_id`, whose documented contract is *forgot
it, saw nothing* on the mail tables. Filling that in from the session would have
turned it into *forgot it, saw their own*, on private correspondence, with
nothing asserting the difference.

**EVERY POLICY IS `AS RESTRICTIVE`, SO NOTHING EXISTING WAS TOUCHED.** 49 tables
each gained one policy and kept every rule they had — owners-only folders,
per-user mail scoping, register-scoped bank rules. Rewriting 49 policies by hand
is how one of those disappears. 31 of the 49 are child tables inheriting through
a parent by `EXISTS`, because `journal_lines` has no company of its own and
scoping only the parents would leave every line amount readable alone.

**A RESTRICTIVE POLICY APPLIES TO THE SUPERADMIN TOO**, so the predicate starts
with `app_is_superadmin()`. Without it every webhook, cron, seed and migration
stops seeing rows.

**The clause order was measured, not guessed.** Postgres inlines a `STABLE` sql
function, and a first version mentioning `app_entity_scope()` twice appeared in
the real plan as the full `string_to_array` FOUR TIMES per row. The unrestricted
case now short-circuits on a string compare and never builds the array.

The app layer mostly did not change: `resolveReportEntity` reads `listEntities`
under the caller's own tx and inherits the scope, so a person limited to one
company gets no picker at all — accounting's own rule, for free. One thing did:
`getDefaultEntityId` threw a developer's error when the tenant default was
outside somebody's scope, which would have met them on every "new bill". Their
default is their own now.

Proved on Hilltop Farm before any test existed: scope none → 2 companies, 65
entries, 162 lines, 10 invoices; scope Shrock Premier (which owns nothing) →
1 company and zero of everything. `journal_lines` going to zero is the child
inheritance working.

`tests/isolation/entity-scope.test.ts` certifies the lookup and the policies
separately, because a test of one would pass while the other was broken. All
four enforcement assertions were proved by replacing the predicate with
`SELECT true` — **and one of them did not bite**: `REFUSES an entry posted into
a company they are not on` was a bare `rejects.toThrow()` catching some other
error entirely. It names the row-level-security violation now, off the driver
error's `cause`, where Postgres actually writes it.

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
| `memberships.entity_ids` | Which companies' books this person may read | `uuid[]` default `{}`; **empty = every company**. Not a menu: 49 restrictive policies (`0387`) mean the rows are not returned at all. Guarded by the same owners-only UPDATE as the column above — empty is the unrestricted value, so a staff member who could write this row would be one statement from every set of books |
| `app_entity_ids_for(uuid, text)` | Membership → company list | `SECURITY DEFINER`, because it reads `memberships`/`profiles` while establishing the context their own policies read. Called once per transaction, inside the `set_config` statement `withTenant` already issues |
| `app_entity_scope()` / `app_entity_allows(uuid)` | The per-row predicate | `app_entity_allows` starts with `app_is_superadmin()` — a RESTRICTIVE policy applies to the god view too. Clause order is a measured decision; see the migration header |
| `memberships.entity_ids` | Which companies' books this person may read | `uuid[]` default `{}`; **empty = every company**. Not a menu: 49 restrictive policies (`0387`) mean the rows are not returned at all. Guarded by the same owners-only UPDATE as the column above — empty is the unrestricted value, so a staff member who could write this row would be one statement from every set of books |
| `app_entity_ids_for(uuid, text)` | Membership to company list | `SECURITY DEFINER`, because it reads `memberships`/`profiles` while establishing the context their own policies read. Called once per transaction, inside the `set_config` statement `withTenant` already issues |
| `app_entity_scope()` / `app_entity_allows(uuid)` | The per-row predicate | Starts with `app_is_superadmin()` — a RESTRICTIVE policy applies to the god view too. The clause order is a measured decision; see the migration header |
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
- `src/modules/types.ts` — `AreaDefinition`. A tool's parts are declared with
  the tool, in `src/modules/index.ts` and `src/packs/index.ts`.
- `src/lib/access/areas.ts` — **pure.** `areaForPath` turns a pathname into a
  key, on segment boundaries so `report` cannot claim `reports`.
- `src/components/app/access-provider.tsx` — the server hands the client
  finished route prefixes; `CategoryStrip` filters on them.
- `src/db/acting-user.ts` — who is making this request, resolved from `auth()`
  rather than passed, because 877 call sites cannot all remember.
- `drizzle/0387_entity_scope_rls.sql` — the 49 policies and the three functions.
  Its header is the reference for why each is shaped the way it is.
- `tests/isolation/entity-scope.test.ts` — the lookup and the policies, apart.
- `src/db/acting-user.ts` — who is making this request, resolved from `auth()`
  rather than passed, because 877 call sites cannot all remember.
- `drizzle/0387_entity_scope_rls.sql` — the 49 policies and the three functions.
  Its header is the reference for why each is shaped the way it is.
- `tests/isolation/entity-scope.test.ts` — the lookup and the policies, apart.
- `src/lib/modules.ts` — `requireModuleEnabled` (pages and actions),
  `routeGate` (route handlers, which cannot `notFound()`),
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

- ~~**Companies per person is not built.**~~ — **done 2026-09-19**, ADR 0094.
  It was 49 tables rather than the 17 first counted: 31 children inherit a
  company through a parent, and a policy on the parents alone would have left
  every line amount readable on its own.
- **The scope rests on every real request having a session.** True because
  `auth()` is established by Clerk's middleware before any page or action runs,
  and nothing reaches a query without `requireTenant()`. A caller with none —
  script, seed, cron, the isolation suite — is unrestricted, which those callers
  have always been. Asserted rather than assumed, but it is the soft edge of the
  design and worth knowing before adding a new kind of caller.
- **Performance is measured only on a small book.** The plan shape is right — a
  pkey index scan per child row, and no array parse at all when unrestricted —
  but nobody has run a P&L over a hundred thousand lines with a scope set. Watch
  the `EXISTS` on `journal_lines` first.
- **What is shared stays shared.** The chart of accounts, contacts,
  customers and vendors are one list across the workspace (ADR 0010), so
  somebody scoped to one company still sees the vendor list. If that ever needs
  to change it is a different decision, not a missing policy.
- **Divisions per person has no agreed meaning yet.** `line_dimensions` tags
  LINES, so one journal entry can sit in Cabinet Shop and Excavation at once.
  The fork — reports only, records whose lines are all in one division, or pack
  records only — goes back to the founder with a real case in front of it.
- ~~**Areas inside a module are declared but unbuilt.**~~ — **done
  2026-09-19**, ADR 0095, and for every tool rather than the twelve accounting
  keys first imagined: fourteen tools, sixty-one areas.
- **Server actions are not gated by area.** The gate derives the area from
  `x-yosher-path`, and for an action that is the SUBMITTING PAGE's path, not the
  action's own — so it is defence in depth for writes rather than a boundary. It
  is only ever stricter (it can refuse somebody who could not have loaded the
  page; it never admits somebody who could not), and the module gate plus the
  role still apply. Doing it properly means each action naming its own area,
  which is roughly 300 call sites: worth it for genuinely sensitive verbs, not
  for all of them.
- **No area declares `deniedByDefault` yet**, because nothing has needed the
  other direction. The field is described in `can.ts` and is not a type on
  anything until an area wants it.
- **An owner cannot be restricted**, and this is structural rather than an
  omission — Clerk owns owner-vs-member. If a limited co-owner is ever wanted,
  it is a change to what security.md S6 rests on, not a feature here.
- **NOBODY HAS DRIVEN ANY OF THIS AS A RESTRICTED PERSON, AND IT IS NOT FOR
  WANT OF TRYING.** Hilltop Farm has one member and they are the owner. Seeding
  a fake staff membership does not work either: `reconcileTenantMemberships()`
  runs whenever an owner opens the Team page and **deletes members who are not
  in the Clerk org**, which is exactly what it is for — it removed the test
  member on the first page load. So the per-person dialog has never been opened
  in a browser, and neither gate nor scope has ever refused a real person.
  Everything is certified by `tests/isolation/access-levels.test.ts`,
  `tests/isolation/entity-scope.test.ts` and `tests/access-can.test.ts`
  instead. **The first real second user in a workspace is the thing to watch**,
  and the cheapest way to get one is a second Clerk account invited for real.
