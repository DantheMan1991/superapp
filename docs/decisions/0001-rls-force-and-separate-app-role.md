# 0001 — RLS FORCE plus a non-owner `app_user` role

- **Date:** 2026-07-19
- **Status:** Accepted
- **Affects:** Layer 0, every tenant-scoped table

## Context

One Postgres database holds every client's mail, books, bank feed and
contracts. Application-level scoping (`WHERE tenant_id = ?`) is correct until
the one query that forgets it — and that query will eventually be written, by a
human or by an agent, in a module nobody is reviewing closely that week.

Neon's owner role additionally carries `BYPASSRLS`. An app connecting as the
owner makes every policy decorative without any visible symptom.

## Decision

Row-Level Security `ENABLE`d **and `FORCE`d** on every tenant-scoped table,
with policies reading transaction-local settings (`app.role`, `app.tenant_id`,
`app.tenant_role`) that only `withTenant()` / `withSystem()` set, after
authorization. The app connects as a dedicated `app_user` role **without**
`BYPASSRLS`; the owner URL is used only for migrations and seeds.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| App-level scoping only | One forgotten `WHERE` leaks across tenants, silently and undetectably. |
| `ENABLE` without `FORCE` | The table owner bypasses policies — which is exactly who the app would have connected as. |
| Database per tenant | Migration and connection-pool cost per client; the platform sells modular tools to small businesses, so tenant count grows faster than revenue per tenant. |
| Schema per tenant | Same migration problem, plus cross-tenant platform queries (admin, audit, billing) become painful. |

## Consequences

- **Default-deny.** No context set → zero rows, even for the table owner. A
  forgotten `WHERE` returns nothing instead of someone else's data.
- Every new table needs a **hand-written `--custom` migration** for policies;
  Drizzle does not generate RLS. This is real recurring friction and is the
  reason it is a checklist item rather than a hope.
- `withTenant`/`withSystem` become a genuine chokepoint — which is the point,
  but it means every data path must go through them, including in packs.
- `npm run test:isolation` becomes a required pre-deploy gate, and needs a
  non-production database to run against.
- `app.tenant_role` (added `0024`) lets policies distinguish owners from staff,
  which the Documents module's owners-only folders depend on. It defaults to
  `staff` so a forgotten opt-in denies a read and can never grant one.

## Notes

The direction of the default is the whole trick: every failure mode of this
design denies access rather than granting it. Preserve that property in any
extension — see [security.md S3](../security.md).
