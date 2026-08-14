# 0009 — A pack is a module row; a profile installs, it does not bind

- **Date:** 2026-08-13
- **Status:** Accepted
- **Affects:** Layer 2a (capability packs), Layer 2b (industry profiles), the
  module registry, `tenant_modules`
- **Builds on:** [0004](0004-capability-packs-and-industry-profiles.md)

## Context

[ADR 0004](0004-capability-packs-and-industry-profiles.md) split the industry
layer into capability packs (code) and industry profiles (manifests). It settled
*what* the two things are and left *how they attach to a tenant* open, because
nothing at Layer 2 existed yet to force the question. As of this date neither
`src/packs/` nor `src/industries/` exists — the layer is designed and unbuilt.

The first real profile forced it. `homestead-farm` has a pilot tenant (the
founder's own farm) and a roster of seven packs, four of which are neutral
enough that the contractor market will reuse them. Two mechanism questions had
to be answered before a line of pack code could be written:

1. **How does a pack get switched on for one tenant?** Core modules already have
   `modules` + `tenant_modules` + `requireModuleEnabled()` + `getActiveModules()`.
   Packs are a different layer, and the obvious instinct was a parallel set.
2. **What does "applying a profile" mean at runtime?** Either the profile is
   consulted on every request to decide what a tenant has, or it runs once and
   the tenant keeps the result.

## Decision

**D1 — A capability pack is a row in `modules` with `category = 'pack'`.**
Enablement is the existing `tenant_modules` row. No parallel entitlement system,
no second guard, no second nav query. The `category` column has defaulted to
`'core'` since Phase 1; packs are the second value.

**D2 — Applying a profile is a one-time install, not a live binding.** Selecting
a profile enables its packs, seeds its data, and stamps `tenants.industry`. From
that moment the tenant's pack set is *its own*, and divergence from the manifest
is expected rather than a fault.

The one exception is **vocabulary: labels resolve live** from the profile
manifest, with a per-tenant override in `tenant_modules.config`. Data is
installed; words are resolved.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A `tenant_packs` table with its own guard and nav query | Forks every mechanism that already works — nav, routing, `requireModuleEnabled`, billing, audit — and creates two ways to answer "is this switched on?". The two answers will disagree. |
| Profile as a live binding: packs computed from `tenants.industry` per request | A tenant could never deviate without a code change and a deploy. Editing a profile would silently mutate every live tenant using it. The pilot tenant is guaranteed to want a deviation in week one, which is precisely when a deploy is the most expensive way to say yes. |
| Installer, with labels copied into config at install time too | A vocabulary fix would need a per-tenant re-run. Labels are pure presentation, so reading them live is a feature, not a hazard. |
| Packs as ordinary `src/modules/` entries | Naming grants permission — 0004's own argument. A pack sitting beside core drifts into core, which is the leak 0004 exists to stop. Separate tree, single runtime registry. |

## Consequences

**What it buys**

- Nav, routing, `requireModuleEnabled()`, the billing seam and audit all work
  for packs on day one, with no new code. A pack is switched on by the same
  admin toggle that switches on Accounting.
- 0004 promised that adding an industry becomes a data change rather than an
  engineering project. Under D1+D2 that is now literally true: a profile is one
  manifest file and a set of rows.
- **Layer 2 v1 needs zero new tables.** Manifests and dependency declarations
  are code-side; enablement, config and seed data all land in tables that exist.
- Divergence is a toggle rather than a deploy — the property that matters most
  while the first profile is being discovered against a real farm.
- It survives a tenant needing **two profiles**. A homestead that also sells
  custom haying is a plausible near-term case, and under an installer you simply
  run both installers and the pack set is the union. Under a live binding, a
  single-valued `tenants.industry` column makes that unrepresentable.

**What it costs**

- **Two sources of truth for "what should a homestead have":** the manifest and
  the installed rows. They drift by design, and a later edit to the profile does
  not reach tenants already running it. A re-apply action and a drift report are
  both needed and neither exists yet.
- **Pack dependencies are unenforced.** `production` is meaningless without
  `inventory`; `livestock` rotation needs `land`. Enabling a pack whose
  dependency is off must be refused at enable time, which is new code in the
  admin toggle path. Until it exists, a wrong toggle is a runtime failure rather
  than a clean refusal.
- **`modules.category` becomes load-bearing for nav.** Seven packs beside six
  core modules is a thirteen-item flat list. The nav has to group by category or
  the shell gets worse the moment the first profile installs.
- **Label resolution enters the request path.** A missing or unknown profile
  slug must degrade to the default label and never throw. `tenants.industry`
  already defaults to `'general'`, so the degraded path is the common one and
  will be exercised constantly.
- The single-valued `tenants.industry` column still can't *record* two installed
  profiles even though the mechanism tolerates them. Label resolution would pick
  one. That is the first thing to revisit if a second profile is ever installed
  on one tenant.

## Notes

The reason D2 went to "installer" rather than the theoretically cleaner live
binding is worth keeping: the first tenant of the first profile is the founder's
own farm, and the entire point of piloting against a real operation is to
discover what the manifest got wrong. A model where every discovery costs a
deploy would suppress exactly the feedback the pilot exists to produce.

What would make us revisit: a tenant needing two profiles at once (see the last
consequence), or a drift problem severe enough that re-apply becomes routine
rather than occasional — at which point the honest answer may be a stored
install record rather than a stamped column.
