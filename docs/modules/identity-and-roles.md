# Identity & roles

> How a Clerk user becomes a person this platform can act for: the `profiles`
> and `memberships` mirror, who owns each half of a role, and what makes that
> mirror trustworthy enough for code running with no session behind it.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-12 — A phone that may only tell (`claude/device-grants`)

Voice slice 0, [ADR 0048](../decisions/0048-a-phone-holds-a-grant-that-may-only-tell.md).
Migrations `0319` (tables) and `0320` (RLS), live on dev.

The founder asked to talk to Yosher without opening the app. Two of his three
examples already worked typed, because ADR 0039 built the intent layer and
`proposeTold`/`recordTold` take a plain `TellCtx` and touch Clerk nowhere —
**the only Clerk-shaped thing in the path is `gate()`.** So this slice is a
SECOND GATE, not a second pipeline, and it is the identity half rather than
the microphone half.

- **`device_grants`** — a bearer token, hashed with `hashToken()` (HMAC, not
  the bare SHA-256 the feed token uses, because this one WRITES), bound to one
  person in one business. `scope` is an enum of one: `tell`.
- **`device_grant_uses`** — append-only, unique on
  `(grant_id, idempotency_key)`. Earns its place twice: it is the idempotency
  guard for a phone retrying an offline queue, and the rate limit, which has to
  be durable across serverless instances. **It holds action slugs and never
  what was said** (S9).
- **`POST /api/device/tell`** — the second route in the product reachable
  without a session, and the FIRST that writes. Two calls: propose returns a
  readback and a signed blob, confirm records it. Driveable with curl; no
  native code exists yet, which is the point of the ordering.
- **`redeemGrant()`** — `withSystem` for exactly one query, the shape
  `feed-serve.ts` set, then the caller reopens as that person.

Three decisions worth carrying:

**A grant is never an owner.** Clerk owns owner-vs-member and this path has no
session to ask. `roleForGrant()` returns `staff` or `expert`, never `owner`.
`expert` is carried rather than flattened — expert is a different member, not a
lesser staff, and promoting one here would hand the outside accountant writes
its own screens refuse it.

**It dies with the membership, not with the expiry.** The founder's answer to
"would anybody revoke a departed worker's phone?" was no. Thirty-day sliding
expiry covers the phone in the slurry pit and NOT the person who left — sliding
expiry rewards use. So `redeemGrant()` INNER JOINs `profiles` and
`memberships`, both of which `removeMembership()` hard-deletes, and taking
somebody out of the workspace kills their phone on its next sentence.

**A missing membership REFUSES here, where `lookupTenantAndRole()` degrades to
`staff`.** That degrade is right for the web — webhook lag must not lock a new
owner out of the workspace they just made — and copying it here would be a hole
in exactly the row whose absence is supposed to kill the credential.

Also changed: **the tell cooldown is keyed per person, not per tenant**
(`tell-sources/model.ts`). Behind a screen the difference never showed; a phone
has no button, and five farmhands saying "clock me in" at seven would have been
one success and four silent refusals. `paste-targets` keeps the tenant key
deliberately — a paste is a desk activity behind a dialog that disables itself.

`/dashboard/settings/phone` is the first page under `/dashboard/settings` that
is not owner-only, and it is linked from the **Business** nav group rather than
the owner-gated **Settings** one.

Tests: `tests/isolation/device-grants.test.ts` (11 clauses) and
`tests/device-grants-redeem.test.ts` (10), including the one named for the case
this feature turns on.

### 2026-09-10 — A member's own request leaves a mark (`claude/back-office-6-health-signals`)

Back-office slice 6. `memberships.last_seen_at` is stamped by
`requireTenant()`/`resolveTenantContext()` on the ordinary path — at most once
an hour, once per request — and never by a support view. The membership row
is now read for every role, an owner's included, so the stamp has a row to
land on; owner-vs-member is still Clerk's decision. The console reads the
newest across a workspace's members as "last seen".

### 2026-09-10 — A superadmin may look, and only look (`claude/back-office-4-support-access`)

Back-office slice 4 ([back-office.md](back-office.md)). `requireTenant()` and
`resolveTenantContext()` gained a first step: a live `support_sessions` row
for the viewer makes a GET resolve as the CLIENT's workspace — role `staff`,
`support` set on the context — and makes every server action and non-GET
route refuse. The two functions now share one lookup in one transaction, so
the session read costs no extra round trip. The method and path the decision
turns on are stamped by `src/proxy.ts`, never read from the client. Nothing
about owner-vs-member resolution changed.

### 2026-09-06 — Account deletion reaches the mirror; the auth pages know the app (`claude/mobile-app-0-app-aware-web`)

Part of the mobile app's slice 0 (see [mobile-app.md](mobile-app.md), ADR 0032).

- **`user.deleted` is handled.** Clerk's account dialog offers "Delete
  account" once the instance setting is on, and both app stores require that
  option to exist. The webhook now removes the person's profile row
  (`removeProfile` in `tenant-sync.ts`); memberships cascade, the tenant and
  every row that names the person by id stay, and `audit_log` records
  `user.deleted` with the Clerk id. `tests/identity-account-deletion.test.ts`.
- **Inside the mobile app, sign-up is a card**, not Clerk's form: businesses
  join from a web browser. The sign-in card loses its "Sign up" footer there.
  Decided by the store rules, not by identity — the reasoning is in the
  mobile dossier.

### 2026-09-05 — Move to a production Clerk instance: the tooling and the runbook (`claude/clerk-production-instance`)

Found while sizing the store wrapper: yosherapp.com signs in against a Clerk
**development** instance — the live sign-in card carries Clerk's "Development
mode" badge, the key is `pk_test_`, the Frontend API is
`premium-reptile-72.clerk.accounts.dev`. That means a user cap, Clerk's shared
OAuth credentials, sessions carried in URL tokens because the cookies are
third-party (fragile inside an iOS webview), and a badge every app reviewer
sees. This PR ships everything the repo side needs; the cutover itself is
[a runbook](../runbooks/clerk-production-cutover.md) the founder drives, and
the build log gets a second entry when it has happened.

- **A production instance starts empty, and every id changes.** Users,
  organizations and memberships do not move with the keys. This platform
  mirrors those ids in `profiles.clerk_user_id`, `tenants.clerk_org_id` and a
  `*_clerk_user_id` column on roughly forty tables. So the move is: recreate
  the people, then rewrite the mirror.
- **Three scripts**, with the pure half in `scripts/lib/clerk-migration.ts`
  (`tests/clerk-migration.test.ts`): `clerk:export` snapshots the source
  instance; `clerk:import` recreates users (password hashes carried from the
  dashboard's CSV export, `external_id` = the old id so a rerun finds rather
  than doubles), organizations (old id kept in `public_metadata`),
  memberships with roles, and — only on request, because it emails people —
  invitations, then writes `mapping.json`; `clerk:remap` rewrites every
  id-bearing column, discovered from the catalogue at run time, in one
  transaction, with `--dry-run` and `--reverse`.
- **`MAINTENANCE_MODE=1`** (`src/lib/maintenance.ts`, read by the proxy)
  closes the platform's own hosts with a 503 for the window between the deploy
  that carries the new keys and the remap. Without it a sign-in in that window
  reaches `/onboarding`, which mints a duplicate tenant for an organization
  the database has never heard of — idempotently and on purpose. Webhooks,
  crons and inbound mail stay open; customer sites stay up.
- **`authorizedParties`** on `clerkMiddleware`, derived from the app URL and
  the deployment's Vercel hosts, for a `pk_live_` key only
  (`src/lib/authorized-parties.ts`, `tests/proxy-switches.test.ts`). Clerk's
  production checklist asks for it, and customer sites on subdomains of the
  platform's domain are the exact shape it guards against.
- **Component paths pinned in code.** `<ClerkProvider signInUrl signUpUrl
  afterSignOutUrl>` in `src/app/layout.tsx`: the dashboard's Paths settings
  do not clone between instances and Clerk is deprecating them; the fresh
  production instance was sending people to the hosted Account Portal.
- Scope on 2026-09-05: 2 users, 2 organizations, 1 pending invitation.
  `audit_log.meta` (JSON) is left as written — a record of the time.
- Also found on the live card, for the founder's dashboard list: Google
  **and GitHub** sign-in are on, and the application is still named
  "SuperApp".

### 2026-08-23 — Give `verify-rls` the npm script its docblock already claimed (`claude/goofy-wilson-6651f3`)

Docs-and-wiring only; no behaviour change to the script itself.

- **`package.json` gains `"db:verify-rls": "tsx scripts/verify-rls.ts"`.** The
  script's header docblock has documented `npm run db:verify-rls` since the day
  it was written, but the script was never added — the documented command died
  with `npm error Missing script: "db:verify-rls"`, and the only thing that
  actually ran it was `npx tsx scripts/verify-rls.ts`.
- **Why it mattered.** docs/security.md §8 requires this check after every
  migration and [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)'s
  migrate-before-merge procedure leans on it. A documented command that errors
  is a step people skip, which is precisely the "the check was skipped, so a
  table reached production with RLS off" failure the script exists to prevent.
- **AGENTS.md and docs/security.md §8 now name the npm command** where they
  previously said "verify in `pg_class`/`pg_policies`" or gave the `npx` form.
- Verified against the dev branch: `npm run db:verify-rls -- --dev` reports 140
  tables, all ENABLED/FORCED with policies, and the table-dump form
  (`-- --dev memberships`) prints the three `memberships` policies.

### 2026-08-05 — Make the Clerk role mirror trustworthy for background jobs (`claude/identity-role-mirror`)

Prerequisite 1 of notifications. A daily digest runs with no session, so it
must read each person's role from our database rather than from the request —
and the stored role had never had to be right, because nothing read it.

- **`memberships.role = 'owner'` is now a value only `withSystem` can write.**
  `drizzle/0085` narrows the member UPDATE policy that `0018` introduced:
  `USING (… AND role <> 'owner')` so tenant context cannot touch an owner row,
  `WITH CHECK (… AND role IN ('staff','expert'))` so it cannot mint one.
- **Added `memberships.clerk_role_synced_at`** (`drizzle/0084`) — when the row
  was last confirmed against Clerk, so a job can require recency instead of
  assuming it.
- **`upsertMembership` no longer fails silently.** It returns
  `{status:'synced'|'deferred'}`; the Clerk webhook answers **503** on
  `deferred` so svix retries. Previously a membership event arriving before the
  `user.created` it depends on was dropped permanently, with a 200 in reply.
- **New `src/lib/membership-sync.ts`** — `reconcileTenantMemberships()`, a
  server→Clerk read that backfills missing profiles, corrects drifted roles,
  removes departed members, and stamps the timestamp. Modelled on
  `billing-sync.ts`.
- **`/onboarding` now syncs the roster, not just the tenant row.** The founder
  who created the org previously had no membership of it until a webhook landed.
- **Team page** drops its hand-rolled sync loop for the shared reconcile.
- Six new cases in `tests/tenant-isolation.test.ts`, plus the deferred contract
  in `tests/close.test.ts`.
- **New `scripts/verify-rls.ts`.** docs/security.md §8 has always required
  checking `pg_policies` after a migration, but the only way to do it was
  `psql`, which is not installed on the machine that runs the migrations — so
  in practice the check was skipped, which is how a table once reached
  production with RLS off. `npx tsx scripts/verify-rls.ts [--dev] [table]`
  reports every table's ENABLED/FORCED/policy-count and exits non-zero if any
  is unprotected.

`requireTenant()` is deliberately unchanged — see Decisions.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `profiles` | One row per Clerk user, globally (not tenant-scoped) | Superadmin all; members may SELECT only profiles sharing one of their tenants (`0001`). `email` is where the digest will send — never write a guessed address into it |
| `memberships` | Who belongs to which tenant, with what role | `tenant_id` + `profile_id` unique. Superadmin all; member SELECT tenant-scoped; member UPDATE narrowed to non-owner rows and staff/expert values only (`0085`). **No member INSERT or DELETE policy** — joining and leaving happen in Clerk |
| `memberships.role` | `owner` \| `staff` \| `expert` | Two axes in one column: Clerk owns owner-vs-member, the Team page owns expert-vs-staff within members. Any writer must preserve an existing `expert` |
| `memberships.clerk_role_synced_at` | When Clerk last confirmed this row | Nullable — NULL means never confirmed, which is the honest state for rows predating `0084`. Not a security boundary on its own; it is the input to one |
| `device_grants` | The credential a phone presents when it writes with no session (ADR 0048) | One row per (phone, business). `token_hash` is `hashToken()` — HMAC, not bare SHA-256, because this one WRITES — and globally unique, since the endpoint has no tenant context until it resolves. `push_devices`' posture: your own rows in your own tenant, both clauses. **No DELETE policy** — revoked, never removed |
| `device_grant_uses` | Every sentence a phone sent, and what came of it | Unique `(grant_id, idempotency_key)`: the idempotency guard AND the rate-limit window. Append-only — no UPDATE, no DELETE, like `audit_log`. `clerk_user_id` is denormalized from the grant so the policy is own-rows rather than a subquery into another RLS'd table. **Holds action slugs, never what was said** (S9) |

## Key files & seams

- `src/lib/auth.ts` — `requireTenant()`, `requireTenantOwner()`,
  `resolveTenantContext()`, `isSuperAdmin()`. The live-request authority.
- `src/lib/tenant-sync.ts` — idempotent Clerk object → row upserts. Called from
  the webhook and from `/onboarding`.
- `src/lib/membership-sync.ts` — the server→Clerk reconcile. What a background
  job calls before it acts as anybody.
- `src/app/api/webhooks/clerk/route.ts` — svix-verified; the live sync path.
- `src/app/dashboard/team/page.tsx` + `actions.ts` — the accountant (`expert`)
  overlay, owner-only.
- `src/db/index.ts` — `withTenant(id, fn, { role, userId })` turns a resolved
  role into an RLS setting.
- `scripts/verify-rls.ts` — post-migration proof that every table is ENABLED,
  FORCED and has policies. `npm run db:verify-rls -- [--dev] [table]`; run
  against both databases after every migration.
- `scripts/clerk-export.ts`, `scripts/clerk-import.ts`, `scripts/clerk-remap.ts`
  (`npm run clerk:export` / `clerk:import` / `clerk:remap`), with
  `scripts/lib/clerk-migration.ts` (the pure decisions, tested) and
  `scripts/lib/clerk-api.ts` (a raw-fetch Backend API client) — moving the
  platform between Clerk instances.
- `src/lib/maintenance.ts` and `src/lib/authorized-parties.ts` — the two
  environment switches `src/proxy.ts` reads per request: the cutover's 503,
  and Clerk's origin allowlist for a production instance.
- `src/lib/device-grants/` — the SECOND GATE (ADR 0048). `ops.ts` mints,
  lists and revokes and may never call `withSystem`; `redeem.ts` is the only
  file that may, for exactly one query, and turns a token into the same
  `TellCtx` a session produces. Split for the reason `feed-ops`/`feed-serve`
  are: one `withSystem` call, easy to find, hard to copy by accident.
- `src/app/api/device/tell/route.ts` — the only route that WRITES tenant data
  without a session. `/api/schedule/feed/[token]` is the only one that reads
  without one; both say so at the top of their own file.
- `docs/runbooks/clerk-production-cutover.md` — the procedure, in order.

## Decisions & gotchas

**The mirror already existed; what was missing was any reason for it to be
right.** `membership_role` has carried `owner` since `0000`, and
`upsertMembership` has always written it. But `requireTenant()` returns `owner`
from `orgRole === "org:admin"` before it ever reads the table
(`src/lib/auth.ts:82`), so the stored value has never been consulted for
authorization. Nothing in production would have failed if every one of those
rows were wrong. Treat "we sync it" and "it is correct" as separate claims;
only the second one lets a cron act on it.

**The dangerous drift direction is stale-HIGH, not stale-low.** The intuition
is that a wrong role makes a digest *omit* things. The real hazard is the
reverse: a dropped demotion webhook leaves a row saying `owner` for somebody
Clerk now calls a member, and a job trusting it would read owners-only
Documents folders and mail their contents to that person. Under-notification is
recoverable. An email is not. This is why freshness is checked rather than
assumed, and why staleness must degrade to `staff` (S6's direction).

**`requireTenant()` was NOT changed, on purpose.** Two rejected alternatives:

- *Make the database authoritative for owner-ness.* A stale row would then
  grant owner where Clerk says member — an upward grant from cached data,
  directly against S6. Clerk stays the authority for anything with a session.
- *Read-repair the mirror on every request.* It only heals people who sign in,
  which is exactly the population a digest does not need, and it puts a write
  into the most security-critical function in the codebase to buy that.

The reconcile covers the same ground without touching the live path. The cost
is that drift is invisible until something reconciles; that is an accepted
trade, recorded in Open items.

**Column-level `GRANT`s cannot separate the webhook from a member.**
`withSystem()` connects as the same `app_user` and only sets a GUC, so
`REVOKE UPDATE (col)` would block the webhook too. RLS is the only mechanism
that can tell them apart, which is why the guard is a policy.

**A partial Clerk roster must never drive deletions.** `listClerkMembers()`
returns `null` if any page fails, and removals are skipped unless the listing
completed *and* returned at least one member — a Clerk hiccup should not empty
a tenant's roster. An org always has at least one member, so zero means
something upstream is wrong.

**Profiles are backfilled from `users.getUser`, not from the membership
payload.** `public_user_data.identifier` is whatever the Clerk instance uses to
identify a person; writing it into `profiles.email` would put a guess where the
digest later reads a destination address. The extra round trip only happens for
users we have no profile for.

**Clerk does not order webhook deliveries.** `organizationMembership.created`
can arrive before `user.created`. 503-and-retry is the fix; returning 200
because "there was nothing to write" is how the row went missing forever.

**The mirror is rewritten in place, never rebuilt.** When the Clerk instance
changes (2026-09-05), the tempting alternative was to drop `profiles`,
`memberships` and `tenants.clerk_org_id` and let the webhook and `/onboarding`
recreate them. That loses every `*_clerk_user_id` on every other table — who
posted, who uploaded, who signed off — and the tenant rows everything hangs
off. `scripts/clerk-remap.ts` keeps the rows and changes the id inside them,
in one transaction, from a mapping the import wrote. The columns are
**discovered from the catalogue** (`%clerk_user_id%`, `%clerk_org_id%`, text)
rather than listed, so a column added after the script was written is
rewritten too; the JSON in `audit_log.meta` is the one place ids survive
unchanged, as a record of the time.

**OAuth links do not move between instances, and do not need to.** Clerk
cannot recreate a Google or GitHub link without the person consenting again.
The import creates each address as verified — the Backend API's default — so
the first social sign-in on the new instance links to the recreated account
by email instead of creating a second one. Password hashes DO move, but only
through the dashboard's CSV export; the API never returns them.

**Closing the platform beats timing the window.** Between the deploy that
carries the new keys and the remap, any sign-in reaches `/onboarding`, which
creates a tenant for an unknown organization id — correct behaviour, and the
last thing wanted. `MAINTENANCE_MODE` makes that window safe by construction:
the proxy answers 503 on the platform's hosts, machine callers excepted, and
customer sites (which never involve a session) stay up. A second redeploy to
reopen is cheaper than a duplicate tenant.

**`authorizedParties` only for a production instance.** The development
instance is what laptops and Vercel previews sign in with, on hostnames
nobody can list in advance; an allowlist there locks out exactly the people
it cannot enumerate. On `pk_live_` it is derived from `NEXT_PUBLIC_APP_URL`
(plus its www twin) and the deployment's own Vercel hosts — never typed in.

**The dev branch is not remapped.** Local development keeps the development
instance, and the Neon dev branch mirrors that instance's ids, so they stay
valid. `clerk:remap -- --dev` exists for symmetry with `db:migrate` and for
the day the development instance is retired, not for the cutover.

## Open items

- **An owner cannot see the phones pointed at their own business.** `device_grants`
  is own-rows in both directions, so `/dashboard/settings/phone` shows you yours
  and nobody else's. Genuinely wanted and deliberately not in slice 0: it needs a
  screen to put it on, and a policy is easier to loosen later than to tighten. The
  lever an owner has meanwhile is bigger — removing the person, which `redeem.ts`
  honours through its INNER JOIN.
- **The idempotency check is check-then-act.** Two genuinely simultaneous duplicate
  requests from one phone could both record; the realistic retry — an offline outbox
  reconnecting seconds or hours later — is fully covered, and a phone retries
  sequentially. Closing it properly needs the use row and the pack's write in ONE
  transaction, which `recordTold` does not currently expose.
- **Nothing native presents a grant yet.** The endpoint is curl-only until the Siri
  App Intent exists, and what a phone can say is livestock's four actions, because
  `tell-sources` still has one filler. `time` (clock in/out) is the next slice.
- **Drift is invisible between reconciles.** Nothing alerts when a webhook is
  missed; the correction is only recorded (`membership.role_corrected`) when a
  reconcile happens to run. A periodic sweep across all tenants would close
  this — natural to fold into the notifications cron rather than build alone.
- **`clerk_role_synced_at` has no consumer yet.** The staleness threshold
  belongs with the digest that reads it; picking a number before the cron's
  cadence exists would be a guess. Until then it is recorded, not enforced.
- **Existing rows are all NULL.** Every membership predating `0084` reads as
  never-confirmed until something reconciles that tenant. Correct, and it means
  the first digest must reconcile before it trusts anything.
- **`role` still conflates two axes.** Demoting an owner who was somehow also
  flagged expert would lose the expert flag. Unreachable today (the toggle
  refuses owner rows), but splitting into a Clerk axis and a local flag would
  make it structurally impossible.
- **Tenant context can still flip another member between staff and expert** at
  the RLS layer; only `requireTenantOwner()` in `setMemberAccountantAction`
  stops it. Same shape as the owner gap this PR closed, one tier down.
- **No membership INSERT/DELETE policy for members** is deliberate, but it does
  mean a tenant cannot self-heal a missing row without an owner loading the Team
  page or a reconcile running.
- **The cutover has not happened yet.** The tooling and
  [the runbook](../runbooks/clerk-production-cutover.md) landed on 2026-09-05;
  the founder's dashboard steps, the import and the remap are the runbook's
  checklist. Until then production is on the development instance, with every
  consequence the build log describes.
- **Sign in with Apple, and dropping GitHub,** are dashboard toggles on the
  production instance. Apple is required by App Store rule 4.8 once an iOS
  app offers Google sign-in, and needs Apple developer credentials.
- **No account deletion exists.** Both app stores require an in-app path when
  sign-up is reachable inside the app; the B2B convention (sign up on the web,
  sign in on the app) plus a delete-account action is the likely shape.
- **Production holds test-suite residue.** The 2026-09-06 remap dry run found
  72 fake Clerk ids in production: `export-test-…` / `close-test-…` actors in
  `audit_log`, `user-act` on a document share, and two tenants with
  `clerk_org_id` of `dms-act-38444` and `dms-ops-28884-share-links`. They
  predate `tests/setup/database-guard.ts`, which now keeps the suites off
  production. Harmless to the cutover (the remap leaves them), but two junk
  tenants in production want deleting under `withSystem`, and the audit rows
  with them — the founder's call, not a script's.
