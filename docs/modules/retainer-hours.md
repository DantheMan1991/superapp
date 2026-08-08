# Retainer hours

> Platform-level (Layer 0) retainer machinery: superadmin logs time per
> client tenant, tenants see an honest usage meter and work log, and owners
> buy fixed extra-hour blocks (5h/10h) via one-time Stripe Checkout. Not a
> sellable module — it's how the service side of the business is metered.
> Status: live · Scope: `platform`

## Build log

### 2026-08-08 — The running timer actually ticks (branch `claude/lint-clean`)
- `TimerControls` read `Date.now()` **during render**. Two bugs in one: the server rendered ITS clock and the client hydrated with a different one, and after that the "Running for ~Xh" figure sat frozen until some unrelated state change happened to re-render the component. It is now state on a 30s interval, so a running timer advances on its own
- The first reading is scheduled with a zero-delay timer rather than taken inline in the effect. Setting state synchronously inside an effect cascades an extra render before paint — see [conventions.md](../conventions.md) §8
- The value is **tagged with the `timerStartedAt` it was measured against**, so a stopped-then-restarted timer cannot show the previous run's figure for a frame, and the effect needs no reset branch
- **Not verified in a browser** — `/admin/retainers` is behind superadmin auth. `npm run build`, `tsc`, eslint and the full suite are green; the thing to try by hand is starting a timer and watching the figure advance without touching anything

### 2026-07-24 — Initial build (`c98388f`, PR #5)
- Four tables (migrations 0019/0020, superadmin_all + member_read RLS): `retainers` (config + live timer state), `retainer_allotments` (month-keyed history so past months' overage never rewrites when the allotment changes), `retainer_time_entries`, `retainer_purchases` (`stripe_session_id` UNIQUE is the webhook idempotency arbiter)
- Balances derived, never stored (`src/lib/retainer-core.ts`, pure math, America/New_York calendar months): no rollover of included hours; purchased blocks carry forward until consumed by overage; soft overage only (no hard cutoff)
- Credit path (`src/lib/retainer-billing.ts`): verified-webhook payment-mode branch + reconcile-on-return for local dev; block minutes always come from `HOUR_BLOCKS` server-side, never from Stripe metadata
- Admin: `/admin/retainers` (running-timers banner, per-client table, timer start/stop/cancel) + Retainer card on tenant detail (allotment, manual log, entry edit/delete — all audited)
- Tenant: `/dashboard/hours` (meter, owner-only buy cards, work log grouped by month) + dashboard Hours card + billing-page link

## Data model

| Table | Purpose |
| --- | --- |
| `retainers` | Per-tenant config + live timer state |
| `retainer_allotments` | Month-keyed allotment history (immutable past months) |
| `retainer_time_entries` | The work log |
| `retainer_purchases` | Hour-block purchases; unique Stripe session id = idempotency |

RLS: superadmin_all + member_read — tenant members can read their own meter
but never write (write-rejection proven in isolation tests).

## Key files & seams

- `src/lib/retainer-core.ts` — pure balance math (18 unit tests)
- `src/lib/retainer-billing.ts` — Stripe credit path
- `src/lib/stripe-customer.ts` — shared `ensureCustomer` / `appUrl` (extracted here)
- `src/app/admin/retainers/`, `src/app/dashboard/hours/`

## Decisions & gotchas

- **Balances are derived at read time** from allotments + entries + purchases; there is no stored balance to drift.
- **Allotment history is month-keyed** so changing a client's monthly hours never rewrites past months' overage.
- **Purchases credit only from trusted Stripe data** (verified webhook or server reconcile), consistent with the platform billing rule.
- Months are **America/New_York calendar months**, pinned in core math.

## Open items

- No hard overage cutoff by design — revisit if a client abuses soft overage
