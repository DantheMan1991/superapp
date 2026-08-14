# Architecture Decision Records

> **Read before:** revisiting a decision that feels arbitrary, or proposing a
> change to a foundational choice. The answer to "why is it like this?" is
> usually here.
> **Write one when:** a decision closes off a credible alternative and someone
> six months from now would reasonably ask "why not the other thing?"

## What belongs here

A decision, its context, the alternatives rejected, and the consequences —
dated. ADRs are **immutable**: they record what was decided and why *at the
time*. When a decision is reversed, write a new ADR that supersedes the old one
and add a `Superseded by` line to the original. Never edit history.

## What does not belong here

| Not an ADR | Goes in |
| --- | --- |
| An invariant that is always true | [architecture.md](../architecture.md) / [security.md](../security.md) |
| What changed in a module and when | `docs/modules/<slug>.md` build log |
| A code pattern | [conventions.md](../conventions.md) |
| A setup step | `SETUP.md` |

The distinction that matters: **rules say what is true now; ADRs say why, and
what we gave up.** A rule that has an interesting "why" gets a rule *and* an
ADR, with the rule linking to it.

## Format

Copy `_TEMPLATE.md`. Number sequentially, four digits, kebab-case title.
Keep them short — one page. An ADR nobody reads has failed at its only job.

## Index

| # | Decision | Date | Status |
| --- | --- | --- | --- |
| [0001](0001-rls-force-and-separate-app-role.md) | RLS FORCE plus a non-owner `app_user` role | 2026-07-19 | Accepted |
| [0002](0002-monolith-with-module-seams.md) | Monolith with module seams, not services | 2026-07-19 | Accepted |
| [0003](0003-self-hosted-mail-over-provider-apis.md) | Self-hosted Stalwart over a hosted mail provider | 2026-07-26 | Accepted |
| [0004](0004-capability-packs-and-industry-profiles.md) | Capability packs + industry profiles, not per-industry modules | 2026-07-27 | Accepted |
| [0005](0005-polling-over-push-for-mail-freshness.md) | Polling over push for mail freshness | 2026-08-02 | Accepted |
| [0006](0006-agents-act-by-delegation.md) | An agent is a delegation from a person, not a principal | 2026-08-06 | Proposed |
| [0007](0007-cash-basis-reporting.md) | Cash-basis reporting, derived at read time | 2026-08-10 | Accepted |
| [0008](0008-warm-neutrals-and-layered-elevation.md) | Warm neutrals, layered elevation, and the navy rail stays | 2026-08-10 | Accepted |
| [0009](0009-packs-are-modules-profiles-install-them.md) | A pack is a module row; a profile installs, it does not bind | 2026-08-13 | Accepted |
