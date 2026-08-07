# Timezone — the business day

> What "today" means. One IANA zone per tenant (`tenants.timezone`), and the
> rule that keeps calendar facts and instants from being confused for each
> other. Read this before writing any code that compares a date to `now`.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-08-05 — Promote the timezone to a platform setting (`claude/tenant-timezone`)

Prerequisite 2 of notifications: a digest sent "daily at 7am" needs to know
whose 7am, and every "due today" it reports has to agree with the page.

The timezone was not missing — it was **module-scoped and unreachable**.
`accounting_settings.bookkeeping_timezone` has existed since `0007` and is read
in 21 places across accounting. It had **no UI and no writer anywhere in
`src/`**, so every tenant sat on the `America/New_York` default and every
accounting "today" in the product was New York's, correct only by luck. CRM
could not use it: reading another module's table is what the isolation rule
forbids, and [tasks/page.tsx](../../src/app/dashboard/m/crm/tasks/page.tsx)
carried a comment saying exactly that while it waited for a shared setting.

- **`tenants.timezone`** (`0086`), NOT NULL, default `America/New_York`,
  backfilled from `accounting_settings` (`0087`). A no-op on today's data by
  construction — there was nothing but defaults — and still written, because
  silently relocating a populated tenant's books to a different day boundary
  would be a financial bug.
- **`src/lib/timezone.ts`** — the shared seam. Validation against the runtime's
  own zone database, a curated picker list, `todayInTimezone`,
  `dateInTimezone`, and `localHourInTimezone` (what lets one hourly cron serve
  every tenant).
- **`/dashboard/settings`** — owner-only. Without somewhere to set it the value
  stays a default and the prerequisite is relocated, not solved.
- **21 accounting reads repointed** at `ctx.tenant.timezone`, plus
  `getTenantTimezone(tx, tenantId)` for the three callers that only ever hold a
  tenant id (ledger reversal dates, recurring invoices, books export).
- **CRM follow-ups now group against the tenant's today**, closing the gotcha
  `docs/modules/crm.md` recorded. CRM automation's "due in N days" counts from
  the business's today too — a rule firing at 9pm in Denver used to date its
  follow-up from tomorrow's UTC date and land a day early.
- `accounting_settings.bookkeeping_timezone` is **deprecated, not dropped** —
  see Decisions.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `tenants.timezone` | The business's clock. IANA zone name | NOT NULL, default `America/New_York`. **SELECT-only for tenant context** — `tenants` has no member UPDATE policy and must not gain one (see Decisions). Written by `setTenantTimezoneAction` under `withSystem` after `requireTenantOwner` |
| `accounting_settings.bookkeeping_timezone` | **DEPRECATED** — superseded above | Unread as of this release. Kept one release so the previous deployment's accounting pages, which SELECT it, keep working. A follow-up migration drops it. Do not add readers |

## Key files & seams

- `src/lib/timezone.ts` — the seam. Client-safe (no `server-only`): the browser
  and the server must answer the same question the same way.
- `src/lib/tenant-timezone.ts` — `getTenantTimezone(tx, tenantId)` for code
  holding only an id. Anything with a request should use `ctx.tenant.timezone`,
  which `requireTenant()` already loaded.
- `src/app/dashboard/settings/` — the owner-only page, form and action.
- `src/modules/accounting/lib/dates.ts` — pure `yyyy-mm-dd` arithmetic, no zone.
- `src/modules/crm/core/timeline.ts` — `dueBucket(dueOn, today)` takes `today`
  as a **string**, which is why it was already correct.

## Decisions & gotchas

**A date is not an instant.** The rule the whole module rests on. A timestamp
is a point on the world's timeline and needs no zone; "what day is it", "is
this overdue", "which month does this close into" are questions about somebody's
calendar and are meaningless without one. Store instants as `timestamptz`,
calendar facts as `date` / `yyyy-mm-dd`, and cross between them only through
`src/lib/timezone.ts`. `created_at` in the last 7 days is 7×24 hours and
correctly has no timezone in it — do not "fix" those.

**Tenant-level, not per-user.** "Due today" is a fact about the business, not
about the reader. If the owner in Denver and a tech in Chicago disagree about
what today is, the digest and the app disagree, which breaks notifications'
one-number-everywhere rule. A person's preferred *send time* is a separable
question and can be added later without touching this.

**`tenants` stays SELECT-only for members, so the write goes through
`withSystem`.** RLS is row-level, not column-level: the narrowest member UPDATE
policy that would permit a timezone change would also expose `status` — letting
a tenant flip itself to `active` and skip billing — and `clerk_org_id`. So
`setTenantTimezoneAction` authorizes with `requireTenantOwner()` and then writes
under `withSystem` with a tenant id that came from the session, never from the
request. `tests/tenant-isolation.test.ts` asserts both the read and the denied
write, so anyone adding that policy later trips a test.

**Validate against the runtime, not a regex.** `isValidTimeZone` constructs an
`Intl.DateTimeFormat` and catches. The only property that matters is whether the
formatter will accept the string — a plausible-looking near-miss like
`America/New York` passes a regex and throws on whichever page next asks the
date. Validate at the boundary and every later call is safe.

**Ask the zone; never store an offset.** `localHourInTimezone` re-derives the
local hour each time. A stored UTC send-time drifts by an hour twice a year and
is wrong all year in Arizona. This is also what lets ONE hourly cron serve every
tenant: it wakes, asks each tenant what time it is there, and sends to the ones
where it is 7am.

**The picker list is a UI convenience, not a constraint.** `COMMON_TIMEZONES`
is curated because the platform serves North American small businesses and a
600-entry list is a worse way to find "Denver". `isValidTimeZone` still accepts
any real zone, and the form prepends the tenant's current value if it is not in
the list — otherwise the select would display a *different* zone as if it were
current, and the first save would move the business's day by accident.

**The deprecated column is not dropped in the same release.** The previous
deployment is still serving while the migration runs, and its accounting pages
`SELECT bookkeeping_timezone`; dropping it would 500 every one of them. Expand
now, contract in a follow-up — the same ordering trap as any column removal
against a live deployment.

## Open items

- **Drop `accounting_settings.bookkeeping_timezone`.** The contract half of this
  change. Safe once this release is live and confirmed.
- **The CRM per-row due badge is still computed in the browser**, so it uses the
  viewer's clock while the grouping uses the business's. Someone working away
  from the business's timezone can see a row badged differently from the group
  it sits in. Fixing it means rendering the badge server-side or passing the
  tenant zone into the client component.
- **`RETAINER_TZ` in `src/lib/retainer-core.ts` is hardcoded** to
  `America/New_York`. Deliberate and correct today — retainer months are the
  *vendor's* billing months, not the client's — but it is a second clock in the
  codebase and should be named as such if it ever becomes per-tenant.
- **`describeMessage` in the Documents mail extension** formats a received
  timestamp as a date using UTC. Display-only, inside a description string; left
  alone rather than threading a zone through a formatter.
- **No per-user timezone.** Deliberate (see Decisions). Revisit only when send
  times become per-person.
