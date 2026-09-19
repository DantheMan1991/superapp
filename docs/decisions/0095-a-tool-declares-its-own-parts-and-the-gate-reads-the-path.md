# 0095. A tool declares its own parts, and the gate reads the path

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** the founder — *"you said accounting areas after that, but it is much more than just accounting areas. every tool needs to have the ability to have features restricted."*

## Context

[ADR 0093](0093-what-somebody-may-open-is-a-gate-which-company-s-rows-they-may-read-is-postgres.md)
built the key space — a key is a module slug or `module:area` — and gated the
module half. The area half was described there as "the twelve accounting keys",
which the founder corrected: **every tool needs it**, not one.

He is right, and the correction changes the shape rather than the size. Writing
one accounting list would have made areas a thing core knows about; making each
tool declare its own makes them a property of the tool.

## Decision

### A tool declares its areas beside its slug and its icon

`AreaDefinition` — `key`, `name`, optional `paths` — on `ModuleDefinition` and
`PackDefinition`, filled in for all fourteen renderable tools from **the real
route tree** under `src/app/dashboard/m/<slug>/` rather than from imagination.

Declared with the tool and not in a central list, because a central list is a
file somebody has to remember to edit — and this codebase has the cautionary
tale already: five packs shipped rendering a generic box because nobody added
their key to the icon registry, and the registry's own header says so.

**A TOOL WITH NO AREAS IS ALL-OR-NOTHING**, which is the honest answer for
Assets (one screen) and for Mail (one mailbox, a list beside a detail pane).
Inventing sections there would be inventing tick boxes that take nothing away.

**THE TOOL'S FRONT DOOR IS NEVER AN AREA.** `/dashboard/m/jobs` belongs to no
area and is reachable by anybody who has the tool, so a level that takes every
area away leaves a working overview rather than a tool whose only page 404s.

### The gate reads the stamped path, so no page is edited

`src/proxy.ts` stamps `x-yosher-path` on every request it passes, from the
request's own URL, **overwriting anything a client sent** — which is what makes
it safe to read. `requireModuleEnabled` derives the area from it and checks the
same `reaches` predicate.

So all 349 existing call sites gained the area check the way they gained the
person check in ADR 0093: by not being edited. And a page written next year is
covered by following the convention that is already step 4 of the
add-a-module workflow.

**FOR A SERVER ACTION THE PATH IS THE SUBMITTING PAGE'S**, not the action's own.
That makes the area check **defence in depth rather than a boundary** for
writes, and it is only ever stricter: it can refuse a caller who could not have
loaded the page the action came from, and never admits one who could not. The
boundary for writes remains the module gate and the role. See the open item.

### The menu is filtered in the one place eight nav strips already go through

`CategoryStrip` renders the sections for eight of the tools, so filtering there
hides every denied section in the product with one change. It is a client
component holding only hrefs, and turning an href back into `accounting:reports`
needs the feature registry — which imports every module's `Component` and can
never cross to the client.

So the **server** translates once, in the dashboard layout, and hands down
finished route prefixes through `AccessProvider`. The client compares strings.

**NEVER THE SECTION YOU ARE STANDING IN**, the rule the rail's own `hiddenHrefs`
already keeps: a link from an email must not leave somebody on a page with no
way back to its list. It cannot leak, because the page itself has already
refused or allowed the request server-side by the time the strip renders.

### The registry import is deferred to call time

`@/lib/features` merges the two registries, which import every module's
`Component` — and those import `src/lib/modules.ts` for `requireModuleEnabled`.
A static import closes that loop: `packRegistry` is `undefined` when
`features.ts` initialises, and **five suites failed to load** with *"Cannot
convert undefined or null to object"* before the import was made dynamic.

`await import()` inside the already-async gate breaks the cycle without moving
the area declarations away from the tools that own them, which is the whole
point of declaring them there.

## Consequences

- Every tool can have parts taken away, not just Accounting. Fourteen tools,
  sixty-one areas, and a fifteenth tool needs no edit outside its own
  definition.
- The Access dialog nests: tools, with their parts indented underneath, shown
  only while the tool itself is ticked. A flat list of sixty-one keys is a list
  nobody reads.
- `Settings → Companies` in the rail now checks `accounting:companies`, because
  it is a section of Accounting and a rail row onto a page that 404s is worse
  than no row.
- `tests/access-areas.test.ts` asserts that **every declared area resolves back
  to its own key**, across all fourteen tools. A key nothing routes to is a tick
  box that takes nothing away while the owner believes otherwise — and that test
  is what validates the route-derived data rather than my reading of it.

## What this does NOT do

- **It does not gate server actions by area.** See above: the path for an action
  is the page it was submitted from. Doing it properly means each action naming
  its own area, which is roughly 300 call sites, and the module gate plus the
  role still apply. Worth doing for genuinely sensitive verbs; not worth 300
  edits for all of them.
- **It does not restrict an owner**, and cannot (security.md S6).
- **Nobody has seen a section disappear.** The workspace this was built against
  has one member and they are the owner, and a seeded staff member does not
  survive `reconcileTenantMemberships()`. The resolution was proved end to end
  in a real request with a temporary log — `/dashboard/m/accounting/reports` →
  `accounting:reports`, the front door → `null` — and everything else is unit
  tested. **The first real second user is still the thing to watch.**

## Alternatives rejected

**One central area registry.** Makes core know every tool's sections, and is the
file nobody remembers to edit.

**A `requireArea(key)` call in each page.** Honest and explicit, and it is 349
edits with one forgotten call being a silent hole — the same argument ADR 0093
made for putting the person check inside `requireModuleEnabled`.

**Filtering each of the eight nav strips.** Eight edits instead of one, and the
ninth nav written next year would not be filtered.

**Sending the area keys to the client and resolving there.** Needs the registry
on the client, which needs every module's `Component` on the client.
