# 0094. A company scope is resolved by the transaction, not passed to it

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** the founder — *"assign users to a company… And then that limits them to only seeing information for that. This is true for accounting as well."* Asked how hard the boundary had to be, he chose **enforced in the database**.

## Context

[ADR 0093](0093-what-somebody-may-open-is-a-gate-which-company-s-rows-they-may-read-is-postgres.md)
drew the line this one lives on the other side of: **which screens somebody may
open is a gate, which rows they may read is RLS.** It built the gate. This is
the rows.

A company is a genuine fact about a row — a bill belongs to Prefab — so unlike
the area half, Postgres can answer it. And unlike the area half, a leak here is
money.

## Decision

### The storage

`memberships.entity_ids uuid[]`, empty = every company. Every membership that
exists today keeps exactly the access it has, which is the same direction the
access level takes and the reason either can ship into a live workspace.

A `uuid[]` and not a join table: the list can only ever NARROW a query that is
already tenant-scoped, so a stale or foreign id cannot widen anything — it
matches no row. Companies are never deleted either, only deactivated
(`journal_entries`' FK is NO ACTION), so there is no cascade for a join table to
carry.

### The hard part is not the policies. It is getting the caller into them.

`withTenant` has **877 call sites**. Every other piece of RLS context is passed
in by the caller, and an optional argument that grants every company when
omitted is not a boundary — it is a boundary with 877 chances to be forgotten,
silently, in the direction that leaks. Making it mandatory is a compiler-checked
sweep of 877 files, which buries the change it is part of and cannot be
reviewed.

**SO THE TRANSACTION RESOLVES THE CALLER ITSELF**, from `auth()`, in
`src/db/acting-user.ts` — React-`cache`d, so once per request.

- **Not `requireTenant()`**: `src/db` cannot import `src/lib/auth`, which
  imports `src/db`. The header on `withTenant` already notes that cycle.
- **Not `AsyncLocalStorage`**: it needs a callback enclosing the work, and
  `requireTenant()` returns a value rather than wrapping the render. Nothing in
  an App Router request is positioned to open that scope — middleware runs on a
  different runtime and does not enclose the RSC render.
- **`auth()` needs neither.** It is Clerk's own request-scoped read and imports
  nothing of ours.

**A SEPARATE GUC FROM `app.clerk_user_id`.** That one is the mail seam
(`drizzle/0043`) and its documented contract is that a caller who forgets it
sees NOTHING. Quietly filling it in from the session would turn "forgot, so saw
nothing" into "forgot, so saw their own", on tables holding private
correspondence, with no test anywhere asserting the difference.
`app.acting_user` is new and carries only this.

### The policies are ADDED, never rewritten

**`AS RESTRICTIVE`.** Permissive policies are OR'd together; restrictive ones
are AND'd with the result. So each of 49 tables gains ONE policy and keeps every
policy it already had, exactly as written.

That is not tidiness. These tables carry rules of several shapes — owners-only
document folders, per-user mail scoping, register-scoped bank rules — and
hand-rewriting 49 of them is precisely how one of those gets dropped by
accident. An additive clause cannot loosen anything; the worst it can do is hide
too much, which is visible and reported.

**A RESTRICTIVE POLICY APPLIES TO THE SUPERADMIN TOO**, so `app_entity_allows()`
starts with `app_is_superadmin()`. Leaving that clause out stops every webhook,
cron, seed and migration on this platform from seeing rows. It is the single
easiest way to take the product down and it is stated at the top of the
migration.

**31 CHILD TABLES INHERIT THROUGH THEIR PARENT** by `EXISTS` — `journal_lines`
has no company of its own, and scoping only the parents would leave every line
amount readable alone, which is most of what a ledger is. **A NULL parent is
ALLOWED, not denied**: an orphan row names no company, and denying it would hide
records from everybody, which is an outage rather than a leak.

### The scope is computed once per transaction

It joins the single `set_config` statement `withTenant` already issues, via
`app_entity_ids_for(tenant, user)` — a `SECURITY DEFINER` function, because it
reads `memberships` and `profiles` while establishing the very context their
policies read. So the lookup costs no extra round trip and the
6-round-trips-to-3 optimisation in `src/db/index.ts` survives.

**THE CLAUSE ORDER IN `app_entity_allows` IS A MEASURED DECISION.** Postgres
inlines a `STABLE` sql function, so the body appears verbatim in the plan of
every table it guards — and a first version that mentioned `app_entity_scope()`
twice was inlined as the full `string_to_array(...)` **four times per row**, read
off the real plan rather than guessed. Putting the unrestricted short-circuit
second means the array is never built for anybody who is not restricted, which
is almost every request ever made.

### The app layer mostly did not have to change

`resolveReportEntity` reads `listEntities` under the caller's own transaction,
so it inherits the scope for free: a person limited to one company gets
`showPicker: false` and `{kind:"one"}`, which is accounting's own stated rule —
*the single-company client never learns the concept exists*. Requesting a
company they are not on already refused with `ENTITY_NOT_FOUND`.

One thing did. `getDefaultEntityId` threw a developer's error when the tenant's
default company was outside the caller's scope, which would have met somebody on
every "new bill". **Their default is now their own**: the tenant default when it
is visible, otherwise their first company by name. Not a silent widening — the
fallback can only pick a company already visible to that caller.

## Consequences

- An owner can put a bookkeeper on Prefab and Prefab only, and mean it. The
  books, the reports, the bills and the bank rows for the others are not
  returned to them by the database, whatever a page asks for.
- **A forgotten `where` clause now fails safe here too**, which is the property
  tenant isolation has had since the beginning and this half of the product did
  not.
- The Team screen gained one dialog per person rather than two controls in a
  row, because "Dave is field crew, on Prefab" is one sentence. The copy says
  which half hides menus and which half hides money.
- `tests/isolation/entity-scope.test.ts` certifies both halves — the lookup and
  the policies — because a test of only one would pass while the other was
  broken.

## What this does NOT do

- **It does not restrict an owner.** Clerk owns owner-vs-member (security.md
  S6), and `app_entity_ids_for` finds the membership but the Team screen never
  offers the control for one.
- **It does not limit a division.** Still the open question from ADR 0091:
  `line_dimensions` tags LINES, so one entry can sit in two divisions at once.
- **It does not scope what is genuinely shared.** The chart of accounts,
  contacts, customers and vendors are one list across the workspace by ADR 0010,
  and remain so. Somebody scoped to Prefab still sees the vendor list.

## The soft edge, stated plainly

The scope is only as good as *every real request has a session*. That holds
because `auth()` is what Clerk's middleware has already established before any
page or action runs, and because nothing reaches a query without
`requireTenant()` having answered first. A caller with no session — a script, a
seed, a cron, the isolation suite — resolves an empty user and is unrestricted,
which is what those callers have always had and must keep.

It is asserted rather than left implied:
*"answers EMPTY when there is no acting user at all"*.

## Alternatives rejected

**Pass the scope as an argument to `withTenant`.** The 877-call-site problem,
in the direction that leaks.

**Enforce it in `resolveEntityScope` alone.** Five call sites and a tidy diff,
and it would be a UI filter wearing a security badge — every direct query on
`journal_lines` would be untouched.

**Rewrite the existing policies to include the clause.** Smaller policy count,
and it risks silently dropping one of the rules already on those 49 tables.

**Resolve the scope per row in the policy.** Correct and slow: a subquery
against `memberships` for every line of every report.
