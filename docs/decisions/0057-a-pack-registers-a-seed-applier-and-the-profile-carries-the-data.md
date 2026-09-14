# 0057. A pack registers a seed applier, and the profile carries the data

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the construction profile as the forcing case

## Context

[ADR 0009](0009-packs-are-modules-profiles-install-them.md) gave a profile a
`seed`: a chart of accounts and folders, copied into the tenant on install and
the tenant's from then on. Both seeds land in CORE tables, and the applier
(`src/app/admin/profile-seed.ts`) calls the two core provisioners by name.

The construction profile needs a third kind. A builder cannot budget a job
until a cost code list exists, and the list belongs to the `jobs` PACK —
`job_cost_code_sets` and `job_cost_codes`, tenant-owned rows that must also be
synced into `dimension_members` or they are not chargeable. The dossier had
already named the fork ([construction.md](../modules/construction.md), open
items): *decide whether `profile-seed.ts` learns about pack tables, or whether
packs register a seed applier.* Project templates will be the fourth kind, and
every industry after this one brings its own.

## Decision

**A pack that can take a seed registers an applier; the profile carries the
data; the applier that walks the seed knows neither.**

- `IndustryProfile.seed.packs` is a map from pack slug to an `unknown` value.
  The Layer 0 type does not know a pack's seed shape, for the reason
  `packConfig` is untyped: knowing would couple the shell to every pack.
- The pack owns the shape (`src/packs/jobs/seed-shape.ts`, no server imports,
  so a profile's constant is typed against it and a pure test can check a
  manifest) and the applier (`src/packs/jobs/seed.ts`), which writes through
  the pack's own ops so every seeded row obeys the pack's rules — a seeded cost
  code is a cost object because `createCostCode` makes it one.
- `src/packs/seeds.ts` is the registry: slug → `{ summarize, apply }`. It is a
  separate file from `src/packs/index.ts` because an applier imports
  `server-only` code and the registry is data the shell reads.
- `applyProfileSeed` walks `seed.packs`, hands each entry to the registered
  applier as the tenant's owner attributed to the superadmin who pressed the
  button, reports what was created in the pack's own words, and lists a pack
  that is off as waiting — the same two rules the core seeds keep: a seed lands
  only in a module that is on and is not lost when it is off; additive,
  re-runnable, the tenant's own rows win.

## Consequences

- A fourth seed kind — project templates, `docs/modules/construction.md` — is
  an entry in the same map and an applier in the same registry, with no change
  to the console or to `IndustryProfile`.
- What "the tenant's own rows win" means is the applier's to define per table.
  For cost code lists it is *a list the tenant has by that name is skipped
  whole*, never merged into — a business that pruned a starter list must not
  find the pruned codes back after a re-install. Another pack may choose a
  different rule; it says so in its applier.
- A profile naming a pack that registered no applier is a configuration
  error, caught by `tests/profile-seed.test.ts` rather than at install, where
  it is nothing to do rather than a thrown half-install.
- `toggleModule` now asks the seed applier for ANY module switched on, not
  only Accounting and Documents, so a pack switched on after the profile
  receives its seed the way a chart does.

## Alternatives considered

- **`profile-seed.ts` grows a branch per pack table.** Rejected: the console
  would learn every pack's tables, the profile type every pack's seed shape,
  and neither could be written without importing the pack — the coupling
  packs exist to avoid, one pack at a time.
- **The pack seeds itself from `packConfig` on first use.** Rejected: a list
  that appears when a screen is first opened is a row nobody installed and
  nobody can re-run, and it would make a pack read its own config as data to
  write, which no pack does.
