# Personal space

> A private workspace of one, beside the business: the person's own tools
> (Workouts, then Food) in a tenant nobody else can join and the
> platform's support view can never open. Also sold on its own, to people who
> have no business on Yosher at all. The decision is
> [ADR 0111](../decisions/0111-a-personal-space-is-a-workspace-of-one-and-support-view-never-opens-it.md);
> the tools in it are [fitness](fitness.md) and [food](food.md).
> Status: `coming_soon` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-10-03 — Food makes the shopping list (`claude/food-d3`)

Food's D3 ([food.md](food.md), ADR 0130): the shopping list made from the
week. The space's home, `docs/help/personal/overview.md` and Food's catalogue
line name it; the home no longer says what comes next, since nothing is
chosen. Nothing in the container changed.

### 2026-10-03 — Food plans the week (`claude/food-d2`)

Food's D2 ([food.md](food.md), ADR 0129): the week's meals, a recipe cooked
once and eaten again, logged from Today with one tap. The space's home,
`docs/help/personal/overview.md` and Food's catalogue line now name the week,
and leave only the shopping list as coming. Nothing in the container changed.

### 2026-10-03 — Progress photos, on the phone (`claude/health-h2b`)

Health's H2b ([health.md](health.md), ADR 0128): progress photos taken and
kept on the phone, never on a server. Nothing in the container changed. The
posture check's lock now covers two areas of personal pages, and the app
gains a file plugin (1.0.9) for Save a copy.

### 2026-10-03 — Health keeps the body (`claude/health-h2`)

Health's H2 ([health.md](health.md), ADR 0127) adds weight, a goal and tape
measures, and lets Today fill in the two weeks before it. The space's home and
`docs/help/personal/overview.md` name the weight and tape measures under what
is coming, as does Health's catalogue line. Nothing in the container changed;
the progress slot gained a format (`measure`, a level drawn across its range).

### 2026-10-03 — Food logs what was eaten (`claude/food-d4a`)

Food's D4a ([food.md](food.md), ADR 0126) makes what was eaten Food's front
page, and the space's home says so under what is coming ("what you eat,
counted against your targets"), as does `docs/help/personal/overview.md` and
Food's catalogue line. Nothing in the container changed; the progress slot
carries Food's numbers to Health.

### 2026-10-02 — The third tool: Health (`claude/health-h1`)

The founder chose Health after Workouts' hands-free merged (#692), and made
its calls from a mockup ([health.md](health.md)). It is a third personal tool
exactly as Workouts and Food are: `category: "personal"`, `coming_soon`, at
`/personal/m/health`, four tables of its own under the same RLS, switched on
in his space by the superadmin preview. Nothing in the container changed. The
space's home names it under what is coming, and so does
`docs/help/personal/overview.md`. New beside it: the progress slot
(`src/lib/progress-sources/`, ADR 0125), through which Health reads Workouts
without importing it.

### 2026-10-01 — The second tool: Food, and a health goal (`claude/food-d1`)

With Workouts' F1–F4 merged, the founder switched to the food side. D1, recipes,
is built as **Food** ([food.md](food.md); his name for it, over Meals, Recipes
and Kitchen, since it will hold the week, the shopping list and what he eats):
a second personal tool exactly as Workouts is, `category: "personal"`,
`coming_soon`, at `/personal/m/food`, its own two tables under the same RLS.
Nothing in the container changed: the catalogue row is what puts it in his
space (`ensurePersonalToolsFor`, the preview a superadmin gets). The space's
home and the door now name Food instead of promising "recipes and meal
planning"; so does `docs/help/personal/overview.md`, which still said
Workouts was next.

He also set a goal for the space as a whole: **to track his progress from
what he does: workouts, eating, cold plunges, sleep and more.** The slice
table below gains it as a row of its own (H), not designed: it is a layer over
the tools, and it waits for his calls.

### 2026-09-28 — The door can go on to a page (`claude/fitness-f4`)

`/personal/open?next=<path>`: once it has switched into the space, the door goes
to that page instead of the space's home. Workouts' reminders (F4a) need it: a
push is tapped with the phone in whatever workspace it was in, and the space's
own pages refuse a business session. `doorDestination`
(`personal-space-core.ts`, pure) passes only a plain path inside the space, in a
strict alphabet (no other origin, no `//`, no `..`, nothing encoded, not the
door itself); anything else goes home. Tested in
`tests/personal-space-core.test.ts`, and driven: a program's path landed on the
program, `/dashboard` on the space's home.

### 2026-09-27 — The first tool in it: Workouts (`claude/fitness-f1`)

Fitness F1 ([fitness.md](fitness.md)) is the first personal tool, so it
brought the plumbing P0 left for it. No migration here; F1's are its own.

- **`/personal/m/[slug]`** renders a personal tool: the space's own door
  (`requirePersonalSpace`), then the same module gate as a business tool,
  which answers not-found for anything that is not a personal tool
  (`moduleFitsTenant`), so `/personal/m/accounting` is a 404 even for somebody
  whose business runs Accounting. A tool's deeper screens are real routes
  beside it (`m/fitness/...`), each gating itself. `m/layout.tsx` re-exports
  the dashboard's module layout, so `--module-accent` works the same (the slug
  is the third path segment under either root).
- **The rail and the home list the space's tools**: the rail loops
  `getActiveModules` (renderable ones only) to `/personal/m/<slug>`, and the
  home's `Your tools` lists the same, or says there are none yet.
- **A superadmin's own space previews a `coming_soon` personal tool.**
  `ensurePersonalToolsSql` takes `preview`; `/personal/open` passes it for a
  superadmin, and also switches on, for anybody, a tool that became available
  after their space was made. The space's layout and home page ask too, for a
  superadmin only, because the workspace switcher lands in the space without
  passing the door; they share one call per request (`previewPersonalTools`,
  React `cache`), since they render side by side and the home, done in the
  layout alone, read its list before the layout's insert and said "Nothing is
  switched on here yet" under a rail that listed Workouts. The seed never
  previews. So Workouts, shipped
  `coming_soon` (the founder's decision, until workout mode), is in his space
  and nobody else's, and the door stays shut to everyone but superadmins.

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
  (named `Personal`, `maxAllowedMemberships: 1`, our mark in public metadata,
  and NO slug) and inserts the row through the same `insertTenantFromOrgInTx`
  the webhook uses. The slug is whatever Clerk invents even with slugs off
  (seen: `personal-1790521342783675516`), and ours from the organization id
  (`personalSlug`) when it invents none. It sets the clock from the browser and
  switches on every available personal tool. If anything fails after Clerk has
  said yes, it deletes the organization again. The Clerk calls are injected,
  so the whole of it is tested without Clerk. The action then reconciles the
  owner's membership at once, as onboarding does for a business, and the door
  and onboarding do it again on the way in.
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
| D1–D4 | Food | Recipes (D1, built 2026-10-01: from a link, a photo of a page, pasted text or typed in, scaled), cook mode (D1b, built 2026-10-02: the screen on, timers from the steps, a log of what you made), hands-free (D1c, built 2026-10-02: the steps read aloud and short phrases heard on the phone, [voice-commands.md](voice-commands.md)), eating logged (D4a, built 2026-10-03: from USDA's food list, a recipe or a photo of the plate, against calorie and protein targets, ADR 0126), the week (D2, built 2026-10-03: recipes and foods on days and meals, a recipe cooked once and its leftovers on later meals, Ate it on Today, ADR 0129), the shopping list (D3, built 2026-10-03: from the week, Claude naming what each line buys and the app adding the amounts, staples asked once, ticks on the phone, ADR 0130), a recipe's nutrition worked out. See [food.md](food.md) |
| H | Health | **His goal (2026-10-01):** progress tracked from what he does: workouts, eating, cold plunges, sleep and more. H1 built 2026-10-02 from a mockup: cold plunges timed on the phone, sleep as bed and wake times, his own habits, and progress by week across them and his workouts, read through a slot the tools fill (ADR 0125). Eating joined with Food's D4a (2026-10-03). H2 built 2026-10-03 from a mockup: weight typed in and read as a trend, a goal weight and a pace, the tape measures he picks, and earlier days filled in (ADR 0127). H2b the same day: progress photos, front, side and back on a timer, kept on the phone only under the posture lock, with Save a copy (ADR 0128). The calorie check is a slice of its own; a watch or ring only if he wears one. See [health.md](health.md) |

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
- **The rail was Home alone** until F1 brought the first tool and the
  `/personal/m/<slug>` route that renders one (build log, above). No guides
  page and no settings yet: there is nothing to set.

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
- **Clerk is never sent a slug.** This Clerk instance has organization slugs
  switched off, and it answers a create that carries one with 403
  `organization_slugs_disabled`. The first drive of P0 failed exactly there
  (the catch-all "could not be made"; the log said why). The fake Clerk in the
  tests had happily accepted the slug, which is the lesson: a fake only knows
  what you told it. The console's business provisioning survives the same
  refusal by accident, retrying without the slug after logging an error.
  Clerk still invents a slug of its own, and both racers read that same one
  off the organization; `personalSlug`, from the organization id, is the
  fallback when it does not.
- **A personal space's owner needs a `memberships` row, and localhost gets no
  webhooks.** The first drive made a space with nobody in `memberships`. Nothing
  in P0 reads it, but the digest and every background job find people through
  it. So the create action reconciles at once (as onboarding does for a
  business), and the door and onboarding reconcile again on the way in.
- **A server component cannot dot into a client module.** `UserButton.MenuItems`
  from the dashboard layout fails ("you can only pass the imported name
  through"), hence `AccountMenu`.
- **The console does not show a personal space's audit rows.** They are the
  person's own activity. A future screen that lists audit rows by tenant has
  to keep that.
- **`personalSpacesOpen` reads the catalogue, not a flag.** The door opens for
  everyone the day any personal tool is `available`. F1 shipped Workouts
  `coming_soon`, so that day is the one its row is flipped, planned for after
  workout mode (F2). Test code must never leave an `available` personal module
  behind: it would open the door on that database. The db test uses a
  `coming_soon` row, and a rolled-back transaction for the one `available`
  case.
- **Preview is a superadmin's own space, never the seed.** A `coming_soon`
  tool reaches a superadmin's space through `/personal/open` and the space's
  layout (`ensurePersonalToolsFor(id, { preview: true })`; the layout because
  the switcher never passes the door); the seed, which touches every space,
  enables `available` tools only, and so does provisioning. F1's first push
  previewed in provisioning too, and CI caught it: `personal-space-db`'s gate
  test provisions as a superadmin and then inserts its own `coming_soon` test
  tool, which the preview had already switched on (a unique-key clash). A preview row stays after the
  tool ships, which is what should happen: it is the same row the seed would
  have made.

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
