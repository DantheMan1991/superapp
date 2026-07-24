# <Module name>

> One-paragraph purpose: what this module does for a client and why it exists.
> Status: `available` | `coming_soon` · Scope: `module` | `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### YYYY-MM-DD — <Short title> (`<commit/PR>`)
- What was added or changed, in plain language
- Why, if not obvious

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |

## Key files & seams

- `src/modules/<slug>/` — renderer + module code
- Server actions, libs, routes that belong to this module

## Decisions & gotchas

The "why it's built this way" that git diffs can't tell you. Policy pins,
traps avoided, bugs fixed and their root causes.

## Open items

Known debt, deferred ideas, designed-but-unbuilt seams.
