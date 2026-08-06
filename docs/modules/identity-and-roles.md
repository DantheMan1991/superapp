# Identity & roles

> How a Clerk user becomes a person this platform can act for: the `profiles`
> and `memberships` mirror, who owns each half of a role, and what makes that
> mirror trustworthy enough for code running with no session behind it.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
  FORCED and has policies. Run against both databases after every migration.

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

## Open items

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
