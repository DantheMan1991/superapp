# 0008 — Warm neutrals, layered elevation, and the navy rail stays

- **Date:** 2026-08-10
- **Status:** Accepted
- **Affects:** `src/app/globals.css` (the whole token set), `src/components/app/*` (new primitive layer), `src/components/app-shell.tsx`, every dashboard and admin surface

## Context

Phase 1 and Phase 2 built seven modules and around seventy-five dashboard
surfaces on stock shadcn/ui with no shared vocabulary above it. The product works
and reads as a sequence of unrelated admin screens. Three measurements make the
problem concrete:

1. `text-2xl font-semibold tracking-tight` is hand-written in **73 files**. There
   was no `PageHeader`, so every page invented its own heading, and they had
   drifted — different gaps, some with a description line, two at a different
   size.
2. Empty states are hand-rolled in **~49 files**, most of them a bare
   `<p className="text-center text-sm text-muted-foreground">No X here yet.</p>`.
3. Every neutral in `globals.css` was hue `265` — blue — while `--background` was
   hue `90`, faintly warm. So every panel, border and muted label sat on a page
   it disagreed with.

The founder set the direction on 2026-08-10 as a combination of Notion's
productivity machinery with Airbnb's visual language, **leaning Airbnb visually**,
and made two constraints explicit: the navy rail stays, and colour should be used
more rather than less. The public `(marketing)` route group is out of scope.

Airbnb's live stylesheet was read directly rather than approximated, and the
numbers below are transcribed from it.

## Decision

**Three things, and the split between them is the point.** Airbnb owns everything
right of the rail — surfaces, radii, elevation, colour, spacing, the typographic
scale. Notion owns the machinery — rail grouping, the command palette,
hover-reveal row actions, table density, the one-big-title page rhythm.

### 1. Neutrals are warm; hue 265 is reserved

All neutral tokens move to hue ~85 at very low chroma. Hue 265 now means exactly
two things: `--primary`, and the `--sidebar-*` family. This single change does
more for the intended feel than anything else in the PR, because it stops the
greys fighting the page they sit on.

Two tiers are added, matching what Airbnb actually runs:

- `--divider` (in-content hairlines) alongside `--border` (container edges).
  Airbnb uses `#EBEBEB` and `#DDDDDD` for these respectively; with one token, a
  table's row lines carried the same weight as the panel around them, which is
  most of why dense lists read as heavy.
- `--subtle-foreground`, a third text tier (`#8C8C8C`), so metadata can recede
  below secondary text instead of competing with it.

`--destructive` is warmed from a pure red towards Airbnb's `#C13515`.

### 2. Elevation replaces outline

Three shadow tokens, transcribed from Airbnb. The shape is what matters: each
opens with a 1px near-transparent ring and layers real shadow on top.

```
--elevation-1: 0 0 0 1px rgb(0 0 0/.02), 0 2px 6px rgb(0 0 0/.04), 0 4px 8px rgb(0 0 0/.10)
--elevation-2: 0 0 0 1px rgb(0 0 0/.02), 0 2px 4px rgb(0 0 0/.16)
--elevation-3: 0 0 0 1px rgb(0 0 0/.02), 0 8px 24px rgb(0 0 0/.10)
```

These replace `ring-1 ring-foreground/10` on panels, which drew a hard line at
every edge. On dark the layered shadow is invisible, so the hairline does the
lifting and the shadow only deepens separation — same token names, so no
component needs a `dark:` variant.

### 3. One radius value, raised

`--radius` goes from `0.5rem` to `0.75rem`. The `@theme inline` block already
derives the whole scale from it, so sm/md/lg/xl/2xl land on 7/10/12/17/22px — the
8/14/20 family Airbnb uses. (20px is their single most-used radius by a factor of
five over the next.) **Changing this one number is the entire rounding change; no
literal radii elsewhere.**

### 4. Colour is navigational, via `--module-accent`

Each module gets an accent token (`--accent-accounting`, `--accent-crm`, …). A
route sets `--module-accent`, and shared primitives read it — so `PageHeader`,
`EmptyState`, `StatCard` and `CategoryStrip` all take on the colour of whichever
module they render inside without ever learning its name. The default is
`--accent-brand`, not `--primary`: navy at 10% on a warm page is just grey, so a
workspace page belonging to no module came out looking broken.

**These are foreground colours, and that constrains them.** They are pitched in
the 0.50–0.56 oklch lightness band, where each clears 4.5:1 on `--card`.
`--brand` itself is deliberately not among them — at `oklch(0.67 …)` it measures
2.81:1 on white, failing even the 3:1 bar for icons and large text. It stays a
brand *surface* colour (correct behind dark text on the sidebar badge), and
`--accent-brand` is its legible twin for drawing with.

Two scopes re-declare the whole set at lifted values, and **both lists must stay
complete** — a module missing from either silently falls back to a value tuned
for the wrong background:

- `[data-sidebar-surface]`, because the rail is dark in *both* themes.
- `.dark`, because the light values are pitched against white.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Quiet monochrome chrome (Notion-true)** — retire the navy rail, sidebar one step off the content background, colour only for state | The honest reading of "Notion + Airbnb", and rejected by the founder on two grounds: the navy rail is the product's identity, and the brief is explicitly to use *more* colour. Recorded because it was the leading option until it was ruled out. |
| **Dark-mode-first** | Biggest visual change and the most work to get right across sixty data-dense surfaces, for a product used in offices and on job sites in daylight. |
| **A column-configured `DataTable`** (TanStack-style) | Would mean rewriting the body of ~60 hand-built tables. `DataTable` is deliberately a *container* that restyles `thead`/`tbody`/`tr`/`td` from the outside, so the sweep is a wrapper swap and nothing inside changes. |
| **Put the primitives in `src/components/ui`** | That directory is stock shadcn and should stay upgradeable. `src/components/app` composes it. |
| **Adding `cmdk` for the command palette** | A dependency for one screen's worth of behaviour. `conventions.md` says check `src/components/ui` first; the existing Radix dialog plus a filtered list does the job. |
| **A new heading typeface closer to Airbnb Cereal** | `--font-heading` is already a separate token pointing at Geist, so this stays a one-line change if it is ever wanted. Not worth a font payload in the same PR as a token rewrite. |

## Consequences

**What it buys.** One page header, one empty state, one table panel, in one
place. A module gets its colour by declaring a token, not by editing the shell.
The rail is scannable at fifteen rows because it is four captioned groups. And
the sweep across the remaining ~70 surfaces is mechanical: swap the header div
for `<PageHeader>`, the bare `<p>` for `<EmptyState>`, the `Card`-wrapped table
for `<DataTable>`.

**What it costs.**

- **A half-migrated period.** Converted and unconverted pages coexist until the
  per-module PRs land. They share the tokens, so the difference is layout
  consistency, not clashing colour.
- **`--radius` is now load-bearing across every component.** Anything that hard-codes
  a radius will visibly disagree with everything around it.
- **The primitives read `--module-accent` implicitly.** A primitive used outside
  any module route falls back to `--accent-brand` rather than erroring, so a
  miswired route looks plausible instead of obviously wrong.
- **The third text tier is a compromise.** Airbnb's `#8C8C8C` is 3.54:1 on white
  and fails WCAG AA; ours was set to match it and measured 3.18:1, on text that
  includes table headers. It is darkened to clear 4.5:1, which leaves
  `--muted-foreground` and `--subtle-foreground` closer together in light mode
  than the reference has them. Accessibility won; the tier is still a visible
  step, but it is a smaller one than Airbnb's.
- **`DataTable`'s styling is a wall of descendant selectors.** That is the
  deliberate trade for not rewriting sixty tables, but it means a caller who
  wraps their rows in an extra element can defeat it.

## Notes

Two bugs were found while doing this and fixed in the same PR, both in the shell's
private icon map:

- `contact`, `calendar` and `check-square` had no entries, but those are exactly
  the names `src/modules/index.ts` uses — so **CRM, Scheduling and Work had all
  been rendering the generic `Boxes` fallback**. The map now lives in
  `src/components/app/icon-registry.ts`, imported by both sides, which is what
  stops it drifting again.

  **Correction, same day.** This entry first also claimed `check-square` could
  never have resolved because lucide-react v1 had dropped the `CheckSquare`
  alias. That is wrong — v1 still exports `SquareCheck as CheckSquare`. The
  claim came from grepping only `declare const` lines in the type declarations,
  which miss the alias block entirely. The bug is unchanged and was only ever
  the missing map key; the icon name would have worked under either spelling.
  Corrected here rather than left standing, because a wrong technical claim in
  the build record is worse than an untidy one. The registry still earns its
  place — an icon cannot cross a server/client boundary as a component — just
  not for the reason originally given.

The command pill sits in the rail rather than above the content, which is a
departure from the plan as approved. Two reasons: it stays mounted on the
full-width modules that own their chrome to the edges (Mail), which a bar in the
content column could not do without shortening them; and the rail is already
`print:hidden`, so search can never land in a printed invoice.
