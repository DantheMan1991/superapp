# 0004 — Capability packs + industry profiles, not per-industry modules

- **Date:** 2026-07-27
- **Status:** Accepted
- **Affects:** Layer 1 (core tools), Layer 2 (industry), Layer 3 (tenant)

## Context

The product is planned in three tiers: industry-agnostic core tools, an
industry layer that tailors them, and per-company tailoring on top. Two problems
had surfaced in practice.

**First, industry concepts kept leaking into core.** Construction vocabulary had
reached the default folder set, the general chart of accounts, document template
copy, an AI prompt and the client-creation form's default — inventory in
[extension-model.md §8](../extension-model.md). In an agent-built codebase this
compounds: an agent reads nearby comments to infer what the product is, so
construction framing in core reliably produces more construction code in core.

**Second, the industry layer had no shape.** Plumbing and electrical contractors
share most functionality — jobs, dispatch, estimating, permits — and differ in a
few places. Modelled as "a plumbing module" and "an electrical module", every
shared capability gets built twice and must then be kept in sync forever.

## Decision

Split the industry layer into two distinct things:

- **Layer 2a — capability packs.** Real code and tables (`jobs`, `dispatch`,
  `estimating`, `permits`, `service-agreements`). Each built **once**, and — like
  core — **industry-blind**.
- **Layer 2b — industry profiles.** Pure manifests, no components. A profile
  lists which packs it includes and supplies vocabulary, seed data and config.

Plumbing and electrical share `jobs` because both profiles *reference the same
pack*, not because one inherits from the other and not because code is copied.
Profiles share by spreading a constant array, never by an inheritance chain.

The governing rule: **a capability pack must never know which industry it is
running in.** Industry differences are expressed as configuration, a declared
extension point, or a separate pack — never a fork.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A module per industry | Every shared capability built and maintained N times. The problem this ADR exists to prevent. |
| Inheritance (`plumbing extends trades`) | Diamond problem, and "which ancestor set this?" archaeology. Taxonomy debates replace product work. |
| Branch on `tenant.industry` inside core | Puts industry knowledge in Layer 1 — the exact leak being fixed. Unbounded conditional growth. |
| Let core stay contractor-flavoured (it is the real market) | Defers a small one-time cost into unpicking industry assumptions across four core modules when the first non-contractor client signs. |

## Consequences

- A bug fixed in `jobs` is fixed for every industry, permanently. There is no
  per-industry copy, so there is nothing to keep in sync.
- Adding an industry becomes a **data change** — list packs, supply labels and
  seed data — rather than an engineering project.
- Vocabulary becomes data. "Service Call" / "Job" / "Project" is one table and
  one code path with three label packs, which dissolves most apparent
  duplication before any code is written.
- **Cost:** contractor-friendly defaults must be installed from a pack rather
  than shipped in core, so a new contractor tenant needs its profile applied
  before the product feels tailored.
- **Cost:** existing leaks need cleaning up. Scoped in
  [extension-model.md §8](../extension-model.md); none are security issues.
- Packs need an extension-point primitive (P5) that does not exist yet — nav
  contribution and entity-type registration will force it.

## Notes

Naming is load-bearing and was part of the decision. "The plumbing module"
grants permission to build plumbing things inside it; "the `jobs` pack, listed
by the plumbing profile" makes the same mistake read as obviously wrong. Use the
second phrasing in code, commits and conversation.

The core neutrality test: *would a bookkeeping firm, a dental practice and a
plumbing contractor all recognise this as their own?* If not, it is a pack.
