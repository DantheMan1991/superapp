# Design system

> The shared visual vocabulary every module renders through: the token set in
> `globals.css`, and the primitive layer in `src/components/app/`. It exists so a
> page does not have to invent its own heading, empty state or table panel — and
> so the answer to "what should this look like?" is a file rather than the
> nearest neighbouring page.
> Status: `available` · Scope: `platform`

The direction is a deliberate split, set on 2026-08-10 and recorded in
[ADR 0008](../decisions/0008-warm-neutrals-and-layered-elevation.md):

| | Owns |
| --- | --- |
| **Airbnb** | Everything right of the rail — surfaces, radii, elevation, colour, spacing, cards, pills, the category strip, empty states, the typographic scale |
| **Notion** | The machinery — rail grouping, the command palette, hover-reveal row actions, table density, the one-big-title page rhythm |

Two constraints are fixed: **the navy rail stays**, and **colour is used more, not
less**. The public `(marketing)` route group is out of scope; it inherits the
tokens and gets its own pass later.

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-08-10 — Foundation: tokens, primitives, grouped rail (`claude/ui-foundation`)

- Warmed every neutral token to hue ~85; hue 265 now means only `--primary` and
  `--sidebar-*`. Added `--divider`, `--subtle-foreground`, `--elevation-1/2/3`,
  `--tracking-heading`, and the per-module `--accent-*` set. Raised `--radius`
  from `0.5rem` to `0.75rem`, which moves the whole derived scale.
- Added the `src/components/app/` primitive layer (nine components, below).
- Sidebar rail: flat 15-item list became four captioned groups; active rows are
  pills; module icons carry their module's accent. Command pill added to the rail.
- **Fixed:** `contact`, `calendar` and `check-square` were missing from the
  shell's private icon map, so CRM, Scheduling and Work had all been rendering
  the generic `Boxes` fallback. The map moved to `icon-registry.ts` and is now
  imported by both the shell and the palette.
- Converted `dashboard/page.tsx` and `dashboard/today/page.tsx` as proof.
- **Contrast audit, and three fixes it forced.** `--subtle-foreground` was set to
  match Airbnb's `#8C8C8C` and measured 3.18:1 — below AA, on text that includes
  table headers; darkened, with `--muted-foreground` pulled down to keep the tier
  gap. `--brand` used as a glyph measured 2.81:1, so `--accent-brand` was added
  and the light-mode accents were re-pitched into the 0.50–0.56 band. `.dark`
  was missing `--accent-accounting` and `--accent-brand` entirely, so both fell
  back to their light values at 3.43:1 on a dark card. All 42 pairs now clear
  4.5:1 in both themes, minimum 4.54:1.
- Verified in a signed-in session: grouped rail, ⌘K palette (open, filter, group
  captions, resolved icons), both converted pages, light and dark, desktop and a
  412px viewport, and the print rules.

## Tokens

All in `src/app/globals.css`. Registered in the `@theme inline` block, so each is
also a Tailwind utility.

| Token | Utility | What it is for |
| --- | --- | --- |
| `--background` / `--card` | `bg-background`, `bg-card` | Page canvas (warm off-white) and the panel on it (pure white) |
| `--foreground` | `text-foreground` | Primary text |
| `--muted-foreground` | `text-muted-foreground` | Supporting text, second tier |
| `--subtle-foreground` | `text-subtle-foreground` | Metadata, third tier — must recede below the second |
| `--border` | `border-border` | A container's edge |
| `--divider` | `border-divider`, `divide-divider` | A hairline *inside* a container (table rows, list items) |
| `--elevation-1/2/3` | `shadow-elevation-1/2/3` | Rest / pressed-or-sticky / overlay. Replaces `ring-1` on panels |
| `--radius` | the whole `rounded-*` scale | **One value.** Never hard-code a radius |
| `--tracking-heading` | `tracking-heading` | -0.02em, for headings only |
| `--module-accent` | `text-module-accent`, `bg-module-accent/10` | The current module's colour; defaults to `--accent-brand` |
| `--accent-<slug>` | — | Per-module hue, assigned to `--module-accent` by the route |
| `--accent-brand` | — | The AA-safe emerald for **drawing with**. Not `--brand` |

### Rules that are easy to get wrong

- **`--divider` for row lines, `--border` for panel edges.** Using `--border`
  inside a table is most of why dense lists used to read as heavy.
- **Elevation, not outline.** A panel is `bg-card shadow-elevation-1`, not
  `ring-1` or `border`.
- **Never a literal radius.** `--radius` derives sm/md/lg/xl/2xl; a hard-coded
  value will visibly disagree the next time the base changes.
- **The rail is dark in both themes.** `[data-sidebar-surface]` re-declares the
  accents at lifted values, because the light-mode ones go muddy on navy. Mark
  any new sidebar surface with that attribute.
- **Three text tiers, and they are ordered.** If everything is
  `text-muted-foreground`, nothing recedes.
- **Never `text-brand` on a light surface.** `--brand` is 2.81:1 on white — it is
  a surface colour for dark text to sit on. Use `--accent-brand` (or
  `--module-accent`) for a glyph or a figure.
- **The `--accent-*` set is declared three times** — `:root`, `.dark`, and
  `[data-sidebar-surface]` — and adding a module means adding it to **all three**.
  A missing entry does not error; it inherits a value tuned for the wrong
  background. That is exactly how the dark-mode accents measured 3.43:1 before
  they were caught.
- **Every token pair here clears WCAG AA 4.5:1**, measured in both themes
  (42 pairs, minimum 4.54:1, on 2026-08-10). If you add or darken a token, re-run
  the check rather than assuming.

## Primitives

In `src/components/app/`, deliberately *not* in `src/components/ui` — that
directory is stock shadcn and stays upgradeable. These compose it.

| Component | Client? | What it replaces |
| --- | --- | --- |
| `PageHeader` | no | The hand-rolled heading in 73 files |
| `EmptyState` | no | ~49 bare `<p>No X yet</p>` |
| `DataTable` + `RowActions` | no | `<Card><CardContent className="p-0">` around a table |
| `StatCard` | no | Eight hand-built cards in `AccountingModule.tsx` |
| `FilterPills` | no | Underlined filter tab rows |
| `CategoryStrip` | **yes** | Wrapping module tab rows (`AccountingNav`, `SalesNav`) |
| `EntityCard` | no | — (new: record-as-card, for grid views) |
| `SectionRow` | no | — (new: titled band on a hub page) |
| `CommandPalette` | **yes** | — (new: ⌘K, in the rail) |
| `icon-registry.ts` | no | The shell's private `ICONS` map |

### `DataTable` is a container, not a table

It restyles `thead`/`tbody`/`tr`/`td` from the outside with descendant
selectors, so converting a page is a wrapper swap and **nothing inside the table
changes**. This is why it is not a column-configured component: there are ~60
hand-built tables and a column API would mean rewriting every one.

```tsx
<DataTable isEmpty={rows.length === 0} empty={<EmptyState … />}>
  <Table>…unchanged…</Table>
</DataTable>
```

### `CategoryStrip` vs `FilterPills`

Both were rendering as tab rows on the same page, doing different jobs. Keep them
straight: **a strip moves you between sections of a module** (underline, icons,
scrolls sideways); **pills narrow the rows of the list you are already on** (fill,
no icons). Accounting's invoices page had a strip's worth of tabs, a second
sub-nav and a filter row stacked above the first invoice.

## Key files & seams

- `src/app/globals.css` — every token, plus the `[data-sidebar-surface]` accent scope
- `src/components/app/` — the primitive layer
- `src/components/app/icon-registry.ts` — name → icon, for icons that cross a
  server/client boundary as data
- `src/components/app-shell.tsx` — the rail, `NavGroup[]`, the command pill
- `src/app/dashboard/layout.tsx`, `src/app/admin/layout.tsx` — the two callers
  that build `navGroups`

## Decisions & gotchas

- **An icon cannot cross a server/client boundary as a component.** The rail's
  nav is built on the server from the `modules` table, so it names icons as
  strings and `icon-registry.ts` resolves them. That indirection is also why the
  registry must stay in sync with `src/modules/index.ts` — it silently did not,
  for three modules, until 2026-08-10.
- **lucide-react v1 dropped `CheckSquare`.** It is `SquareCheck` now. Verify an
  icon name exists before adding it to the registry; a missing one falls through
  to `Boxes` without erroring, which is how the last one went unnoticed.
- **`measure` in `CategoryStrip` runs from a ref callback, not an effect.** As an
  effect it would be a `setState` on mount, which `react-hooks/set-state-in-effect`
  flags. The `useCallback` around it is load-bearing: an inline ref would detach,
  re-attach and re-measure every render.
- **The command pill lives in the rail, not above the content.** It stays mounted
  on full-width modules that own their chrome to the edges (Mail), and the rail is
  already `print:hidden` so search cannot appear in a printed invoice.
- **`npm run build`, not just `tsc`.** `CategoryStrip` and `CommandPalette` are
  client components; a server component importing a *helper* (not a component)
  from one throws only at render, and the build is the only thing that catches it.

## Open items

- **The sweep.** ~70 surfaces still hand-roll their header, empty state and table
  panel. Planned as one PR per module: accounting → documents + mail → CRM + work
  + scheduling → admin/auth/onboarding.
- **`CommandPalette` indexes navigation only.** Searching records needs a server
  action per keystroke and per-module scoping. The placeholder deliberately says
  "Jump to a page" so it does not promise records.
- **`PageHeader` is not sticky.** The plan called for it; left out of the
  foundation PR rather than destabilise 73 pages at once. It is a prop away.
- **`EntityCard`'s corner action needs a scrim.** A white glyph over a light
  monogram is low-contrast; it works over a real thumbnail but not over the
  fallback. `EntityCard` and `SectionRow`'s scrolling variant are both **unused
  so far** — they land with the documents/mail PR, and neither has been seen on a
  real page yet.
- **The dashboard logs a Clerk hydration mismatch** in dev, from
  `OrganizationSwitcher` in the sidebar footer. It predates this work (the footer
  JSX is unchanged) but it masks any real hydration bug that shows up later.
- **`--font-heading` is a seam.** One line swaps the heading face if something
  closer to Airbnb Cereal is ever wanted.
