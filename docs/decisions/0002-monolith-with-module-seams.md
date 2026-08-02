# 0002 — Monolith with module seams, not services

- **Date:** 2026-07-19
- **Status:** Accepted
- **Affects:** Layer 0, all layers above it

## Context

The product is a suite of tools — accounting, documents, mail, later jobs and
dispatch — sold à la carte to small businesses. "Modular product" invites
"modular deployment", and the instinct to make each tool a service is strong,
particularly when tools are added by separate agent sessions working in
parallel.

## Decision

One Next.js App Router codebase, one Postgres database, one deployment. Modules
are **internal seams** — a registry entry, a directory, a set of tables — never
network services.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Service per module | Multiplies the number of places a tenant boundary can break, for a scale problem that does not exist. Every service needs its own copy of the auth and tenancy story. |
| Shared DB, separate deployments | Worst of both: distributed operational cost, no isolation benefit. |
| Plugin runtime with real sandboxing | Enormous complexity for code we write and review ourselves. |

## Consequences

- **Tenant isolation is enforced in exactly one place** — RLS in one database.
  That is the property most worth protecting, and it survives.
- Cross-module features are cheap. Mail links to invoices, receipts flow into
  accounting, documents attach to ledger entries — all ordinary joins.
- Modules are **not** security boundaries. `requireModuleEnabled()` is an
  entitlement check, not a sandbox. Review is the control for module code.
- A slow module can affect the whole deployment. Accepted at current scale.
- Extracting a service later is possible but will not be free. The module seam
  keeps it merely expensive rather than impossible.

## Notes

Revisit if a single module develops genuinely different scaling characteristics
— sustained heavy background processing is the realistic trigger. Client count
alone is not a reason.
