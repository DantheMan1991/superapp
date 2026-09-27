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

### 2026-09-27 — P0: the container (`claude/personal-space-p0`)

Migrations `0424` (the column, the index, two CHECKs) and `0425` (the trigger).

A person can open a personal space of their own, switch to it and back, and
nobody else can get in. It has nothing in it yet; fitness (F1) is the first
tool.

- **`tenants.kind`** (`business | personal`) and
  **`tenants.personal_owner_clerk_user_id`**, with the database enforcing
  every rule about them: one space per person (partial unique index), an
  owner exactly when personal (CHECK), the operator always a business (CHECK),
  and kind and owner never changing, even under `withSystem` (trigger
  `tenants_kind_immutable`).
- **The auth split** (`src/lib/auth.ts`). `requireTenant()` and
  `resolveTenantContext()` now refuse a personal space, sending it to
  `/personal`. That one line closes every business page, action and route to
  a personal space without editing any of them. The personal half has its own
  door, `requirePersonalSpace()` / `resolvePersonalContext()`, which refuses a
  business and anybody but the owner.
- **Provisioning** (`src/lib/personal-space.ts`, `provisionPersonalSpace`). It
  runs under a per-person advisory lock. It creates the Clerk organization
  (named `Personal`, a random `personal-xxxxxxxx` slug,
  `maxAllowedMemberships: 1`, and our mark in public metadata) and inserts the
  row through the same `insertTenantFromOrgInTx` the webhook uses. It sets the
  clock from the browser and switches on every available personal tool. If
  anything fails after Clerk has said yes, it deletes the organization again.
  The Clerk calls are injected, so the whole of it is tested without Clerk.
- **The webhook race, both orders.** The organization's public metadata
  carries the mark (`yosherKind: "personal"`, `personalOwner`), so
  `organization.created` landing BEFORE our insert mirrors it as a personal
  space. The upsert never writes kind on update. A second personal
  organization for one person is `DuplicatePersonalSpaceError`, which the
  webhook answers (audit, 200) rather than retrying forever.
- **Three locks on the door**: Clerk's one-member cap; `upsertMembership`
  returning `refused` for anyone but the owner, which the webhook and the
  reconcile record and never mirror; and the owner check in
  `requirePersonalSpace`. A personal space also gets no calendar or work list
  when its owner's membership syncs (`provisionBusinessRows`).
- **Support view never opens one**: refused in `openSupportViewAction`, and
  ended by `resolveSupport` if one is found anyway, with an audit row
  (`support.refused_personal`).
- **The module gate** (`isModuleEnabled`, `getActiveModules`) answers false
  for a tool in the wrong kind of workspace, whatever its row says
  (`moduleFitsTenant`). The console refuses to switch one on
  (`moduleRefusal`).
- **The screens.** `/personal` is the home: `Private to you`, `Your tools`,
  `Back to your business`. `/personal/open` is the door, reached from
  `Personal space` in the account menu (`AccountMenu`, a client wrapper
  because a server component cannot dot into `UserButton.MenuItems`). The door
  sits OUTSIDE the space's layout: until the browser has switched
  organizations, the caller is still in their business. Onboarding forwards a
  personal space home, and answers the two unforwardable cases (somebody
  else's space, a spare duplicate) with the switcher.
- **Who sees the door**: superadmins, and everyone once any personal tool is
  `available` (`personalSpacesOpen`). An empty container is not offered to
  every client. The account menu and provisioning ask the same predicate.
- **The console.** `/admin` counts personal spaces and does not list them. The
  module matrix and the retainer list are businesses only. A personal space's
  tenant page is its own small page (`personal-detail.tsx`), with owner,
  clock and tools and NO activity log, because those rows are the person's
  own activity. Profile, vocabulary, retainer and the CRM party (single and
  backfill) all refuse a personal space (`PERSONAL_REFUSALS`).
- **The seed** switches every available personal tool on in every personal
  space (`enablePersonalToolsEverywhereSql`, shared with provisioning). So a
  tool shipped after somebody made their space still reaches them.
  `db:verify-modules` fails when a space is missing one.
- **Guides.** A fourth fixed section, `personal`, readable from either kind of
  workspace. Guide routes may now start with `/personal`. `/api/help` answers
  a personal space through its own door. The "?" renders under `/personal`
  without the business Guides links. The guide is
  `docs/help/personal/overview.md`.

Tests: `tests/personal-space-core.test.ts` (pure),
`tests/isolation/personal-space.test.ts` (the constraints, the trigger, and
RLS between one person's business and their space),
`tests/personal-space-db.test.ts` (the webhook race in both orders,
provisioning with a fake Clerk including the double click and the failure
cleanup, the membership refusal, the gate, and the auth split with Clerk's
session faked, the first test in the suite to do so).

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

### P0 — the container, as built

The build log above has the detail. Where the build moved from the plan:

- **Tools are "every available personal tool", not a fixed list.** Switched on
  at creation, and in every existing space by the seed, so a new tool needs no
  code in this module to reach anybody.
- **The second lock is the auth split, not a hidden members screen.** The Team
  page, like every business page, calls `requireTenant()`, which refuses a
  personal space. So there is no members screen to hide.
- **The switcher says `Personal` because the organization is called that.**
  No custom label: every personal organization has the same name, and Clerk
  does not require names to be unique.
- **The entry is the account menu**, `Personal space`, not the switcher. The
  switcher lists organizations the person already has, and until they open one
  there is none to list.
- **The rail is Home alone** until F1 brings the first tool and the
  `/personal/m/<slug>` route that renders one. No guides page and no settings
  yet: there is nothing to set.

### P1 — the consumer door

- `/onboarding` with no organization asks one question first: `For my
  business` or `Just for me`. "Just for me" provisions the personal space
  (`provisionPersonalSpace`, which P0 built) and lands on it. The Clerk
  `CreateOrganization` form ("Set up your business") stays the business path,
  unchanged.
- Sign-up stays refused inside the native app, as it is today. A consumer signs
  up on the web and then signs the app in.
- **Price is not decided.** Nothing in the product gates on billing today (a
  tenant with no subscription uses every enabled module), so P1 can ship free
  and the plan can come when somebody other than the founder uses it.

## Data model

| Table / column | Purpose | Notes |
| --- | --- | --- |
| `tenants.kind` | `business` or `personal` (enum `tenant_kind`) | Default `business`. Never updated: trigger `tenants_kind_immutable` refuses it even under `withSystem`. Read by the auth split, the module gate, support view and the console |
| `tenants.personal_owner_clerk_user_id` | The one Clerk user who may open the space | A Clerk id, not a `profiles` FK: the profile can arrive after the organization. `tenants_personal_owner_idx` (unique where personal), `tenants_personal_owner_check` (set exactly when personal), and never updated (the same trigger) |
| `tenants_operator_is_business_check` | The operator is never a personal space | A CHECK, evaluated before any index |
| `modules.category` | `personal` joins `core`, `pack`, `system` | Text, so no migration. A personal tool is only ever on in a personal space (`moduleFitsTenant`) |

No new RLS shape: a personal space is a tenant, and every table in it is an
ordinary tenant-scoped table under `withTenant`. `tests/isolation/personal-space.test.ts`
certifies it like any pair.

## Key files & seams

- `src/lib/personal-space-core.ts` — the rules, pure and import-free:
  `moduleFitsTenant`, `PERSONAL_REFUSALS` / `personalRefusal`, the Clerk mark
  (`personalOrgMetadata`, `kindFromOrgMetadata`), `personalSlug`,
  `personalSpacesOpen`, `PERSONAL_HOME`, `PERSONAL_OPEN`.
- `src/lib/personal-space.ts` — `findPersonalSpace`, `provisionPersonalSpace`
  (the lock, the Clerk call, the row, the clock, the tools), `ensurePersonalTools`,
  `personalSpacesOpenFor`.
- `src/lib/personal-tools-sql.ts` — the two statements that switch tools on,
  shared by provisioning and `scripts/seed.ts`.
- `src/lib/tenant-sync.ts` — `insertTenantFromOrgInTx`, the one place a tenant
  row is made from an organization; `DuplicatePersonalSpaceError`; the
  `refused` membership outcome; `provisionBusinessRows`.
- `src/lib/auth.ts` — the split (`requireTenant`/`resolveTenantContext` refuse
  a personal space; `requirePersonalSpace`/`resolvePersonalContext` refuse
  anything else) and the support-view end.
- `src/lib/modules.ts` — the gate and the rail apply `moduleFitsTenant`.
- `src/app/personal/(space)/` — the space's layout and home.
  `src/app/personal/open/` — the door (page, client switch, provisioning action).
- `src/components/app/account-menu.tsx` — `Personal space` in the account menu.
- `src/app/onboarding/page.tsx` — forwards a personal space, answers the two
  cases it cannot.
- `src/app/admin/tenants/[id]/personal-detail.tsx` — the console's page for one.
- `scripts/seed.ts`, `scripts/verify-modules.ts` — the tools backfill and its check.

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
- **The two doors are the design; the kind column is only what they read.**
  Every business entry point already called `requireTenant()` or
  `resolveTenantContext()`, so refusing a personal space in those two closed
  all of them at once. Adding a check to each page
  instead would have been hundreds of edits, and a page written next year would
  have been open by default. The personal half is default-closed the same way
  round. A shared surface (only `/api/help` so far) asks both doors explicitly.
- **The webhook can land before our own insert.** Clerk fires
  `organization.created` the moment the organization exists, while
  provisioning still holds its transaction. That is why the kind travels in
  the organization's metadata and not in our code path. It is also why both
  go through `insertTenantFromOrgInTx`, which skips on the organization id and
  reads the winner. `tests/personal-space-db.test.ts` runs it in both orders.
- **The Clerk call is inside the transaction, under the lock.** "Check, then
  create" has to be atomic per person. Otherwise a double click makes two Clerk
  organizations, and only one of them can ever be a row. The cost is a
  transaction held open across one HTTP call, once per person, ever.
- **A server component cannot dot into a client module.** `UserButton.MenuItems`
  from the dashboard layout fails ("you can only pass the imported name
  through"), hence `AccountMenu`.
- **The console does not show a personal space's audit rows.** They are the
  person's own activity. A future screen that lists audit rows by tenant has
  to keep that.
- **`personalSpacesOpen` reads the catalogue, not a flag.** The door opens for
  everyone the day any personal tool is `available`, which is the day F1's
  seed runs. Test code must never leave an `available` personal module behind:
  it would open the door on that database. The db test uses a `coming_soon`
  row, and a rolled-back transaction for the one `available` case.

## Open items

- **Clerk's own organization menu, inside a personal space.** The switcher's
  "Manage" opens Clerk's organization profile, which offers an invite. The
  one-member cap makes the invite fail, with Clerk's own message. Hiding the
  control needs Clerk configuration or a custom switcher. Not done in P0.
- **No report button in a personal space.** The feedback tool sends a screen's
  path, and possibly a screenshot, to the operator's console, and whether that
  is acceptable in a private space is a decision, not a default. Left out of the
  layout until it is made.
- **A personal space's clock cannot be changed.** It is set from the browser
  at creation. F3's done days depend on it, so F3 brings a setting.
- Clerk plan limits on organizations per user and total organizations, once
  every consumer is one. Check the current Clerk pricing before P1.
- Consumer pricing, and how it is sold given that the native app does not sell
  plans (the billing page there shows status only).
- A personal space shared with a partner (a household meal plan) is a real ask
  waiting to happen. It would be a second member, which P0 forbids on purpose;
  it needs its own decision, not a raised cap.
- Diet dossier (`docs/modules/diet.md`) when D1 starts.
