# Personal space

> A private workspace of one, beside the business: the person's own tools
> (workouts first, then diet) in a tenant nobody else can join and the
> platform's support view can never open. Also sold on its own, to people who
> have no business on Yosher at all. The decision is
> [ADR 0111](../decisions/0111-a-personal-space-is-a-workspace-of-one-and-support-view-never-opens-it.md);
> the first tool in it is [fitness](fitness.md).
> Status: `coming_soon` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-27 — The plan (`claude/personal-space-plan`)

The founder asked for Yosher to be an "everything app": a personal space next
to the workspace everyone already has, starting with diet (recipes, meal
planning) and workouts. His own case is a purchased program (a 59-page PDF,
four two-week phases, breath-counted drills) that he needs a platform to
start, follow and track.

Four decisions, his, taken 2026-09-27:

1. **The container is a workspace of one** (a tenant), not data keyed to the
   person and not rows inside the business tenant. ADR 0111.
2. **It is also a consumer product.** Somebody with no business can sign up
   for the personal space alone.
3. **Support view never opens it.** Health and diet data is the person's.
4. **Fitness slice 1 is his program, runnable**, before a generic builder.
   Diet comes after fitness.

No code yet. This entry is the plan; the slices are below and in
[fitness.md](fitness.md).

## The slices

| # | Slice | What it proves |
| --- | --- | --- |
| P0 | The container | A person has one personal space, can switch to it and back, nobody can be invited into it, support view refuses it, and the isolation suite says so |
| P1 | The consumer door | A new sign-up is asked "for my business, or just for me", and "just for me" never sees the business setup |
| F1–F6 | Fitness | See [fitness.md](fitness.md) |
| D1 | Recipes | A recipe by hand or pasted from a link (ingredients, steps, servings, tags, photo), scaled to a serving count |
| D2 | The week | A meal plan: recipes on days and meals, dragged about, repeated from a past week |
| D3 | The shopping list | Built from the week, ingredients merged across recipes, ticked off in the shop on a phone |
| D4 | Nutrition | Per-recipe calories and macros, and a day's total. Later, and only if asked |

### P0 — the container, in detail

- **`tenants.kind`**, enum `business | personal`, default `business`, set at
  creation and never updated. It is what everything else reads. The operator
  flag stays separate; an operator tenant is always a business.
- **One per person.** `tenants.personal_owner_clerk_user_id`, with a partial
  unique index `WHERE kind = 'personal'`. A person asking for a second one gets
  the first.
- **Provisioning is ours, not the webhook's.** A server action creates the
  Clerk organization through the backend API (`maxAllowedMemberships: 1`,
  `publicMetadata.kind = 'personal'`), inserts the `tenants` row under
  `withSystem` with `kind = 'personal'` BEFORE returning, and switches the
  session to it. `organization.created` then arrives and `upsertTenantFromOrg`
  must find the row by `clerk_org_id` and leave `kind` alone. **The trap:** the
  webhook can win the race, and today's upsert inserts with the defaults, which
  would make a personal space a business. The upsert reads
  `publicMetadata.kind` on insert and never writes `kind` on update, and a test
  runs the two in both orders.
- **Its tools are switched on at creation**, in the same trusted code, from a
  fixed list (`fitness` first). A personal space has no superadmin setting it
  up, and today only a superadmin can enable a module.
- **Nobody can be invited.** The Clerk cap is the first lock; the members
  screen not rendering for `kind = 'personal'` is the second; a
  `organizationMembership.created` for a second person is refused and logged
  by the webhook as the third.
- **Support view refuses it**, through one pure predicate beside
  `operator-guard.ts`, called in `openSupportViewAction`, on the admin tenant
  page (no form), and in `resolveSupport` in `auth.ts`, which ends any session
  it finds on a personal space. The third call is the one that matters: the
  first two are the UI.
- **The rail.** A personal space shows its personal tools, the guides and the
  person's own settings. No business group, no billing-as-a-business, no
  members. A business workspace never shows a personal tool: which category a
  module is in and which kind the tenant is are checked by one predicate on
  both the rail and `requireModuleEnabled`.
- **The switcher.** Clerk's `OrganizationSwitcher` already lists every
  organization the person is in, so the personal space appears there. It is
  labelled as theirs (`Personal`) rather than by the org name, and it opens on
  its own home, not the business dashboard.
- **Clock.** `tenants.timezone` is set from the browser at creation. A
  personal space's "today" is the person's today.
- **Isolation tests** (`tests/isolation/personal-space.test.ts`): a second
  tenant sees nothing, the business tenant of the same person sees nothing of
  the personal one and the reverse, a support session cannot resolve into it,
  and the provision/webhook race lands one row of the right kind.

### P1 — the consumer door

- `/onboarding` with no organization asks one question first: `For my
  business` or `Just for me`. "Just for me" provisions the personal space and
  lands on it; the Clerk `CreateOrganization` form ("Set up your business")
  stays the business path, unchanged.
- A business user reaches their personal space from the switcher: the first
  click provisions it.
- Sign-up stays refused inside the native app, as it is today. A consumer signs
  up on the web and then signs the app in.
- **Price is not decided.** Nothing in the product gates on billing today (a
  tenant with no subscription uses every enabled module), so P1 can ship free
  and the plan can come when somebody other than the founder uses it.

## Data model

Planned, P0:

| Table / column | Purpose | Notes |
| --- | --- | --- |
| `tenants.kind` | `business` or `personal` | Enum, default `business`, never updated. Read by the rail, the module gate, support view |
| `tenants.personal_owner_clerk_user_id` | Whose personal space it is | Partial unique index where `kind = 'personal'` |
| `modules.category` | Gains `personal` | Personal tools are only ever enabled on a personal tenant |

No new RLS shape: a personal space is a tenant, and every table in it is an
ordinary tenant-scoped table under `withTenant`.

## Key files & seams

Nothing built yet. Where each piece lands:

- `src/lib/tenant-sync.ts` — the upsert learns `kind` on insert only.
- `src/lib/personal-space.ts` (new) — `provisionPersonalSpace(clerkUserId)`.
- `src/lib/operator-guard.ts` or a sibling pure file — the support refusal.
- `src/lib/auth.ts` `resolveSupport` — the defence-in-depth end of a session.
- `src/app/onboarding/page.tsx` — the chooser.
- `src/app/dashboard/layout.tsx` — the rail and the switcher label.

## Decisions & gotchas

- **Why not Clerk's own "personal account".** Clerk has one, and the switcher
  hides it (`hidePersonal`). With no organization there is no `orgId`, and
  `requireTenant()`, `withTenant()` and every RLS policy key on the tenant. A
  personal account would have been a second tenancy model; an organization of
  one is the model we have. ADR 0111.
- **Never is a product promise, not a database one.** Support view refuses a
  personal space. `withSystem` code (crons, the notification digest) still
  reads it, as it reads every tenant, and the database owner can read any row.
  The guide and the privacy page must say "Yosher staff cannot open your
  personal space from the product", not "nobody can ever see it".
- **Health data law.** A consumer app holding workout, body and diet data is a
  consumer health app. In the US that is the FTC's Health Breach Notification
  Rule, and in some states (Washington's My Health My Data Act) consent and a
  health-data privacy policy. P1 must not open to the public before that
  policy exists. This is a note for the founder to take to a lawyer, not legal
  advice.
- **Deleting it.** A consumer must be able to delete their personal space and
  have its rows gone, not marked `churned` the way a deleted business
  organization is today.

## Open items

- Clerk plan limits on organizations per user and total organizations, once
  every consumer is one. Check the current Clerk pricing before P1.
- Consumer pricing, and how it is sold given that the native app does not sell
  plans (the billing page there shows status only).
- A personal space shared with a partner (a household meal plan) is a real ask
  waiting to happen. It would be a second member, which P0 forbids on purpose;
  it needs its own decision, not a raised cap.
- Diet dossier (`docs/modules/diet.md`) when D1 starts.
