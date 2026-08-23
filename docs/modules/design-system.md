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

### 2026-08-22 — The Clerk mismatch, closed (`claude/laughing-herschel-e284b2`)

The open item this dossier had carried since the foundation PR — *"the dashboard
logs a Clerk hydration mismatch in dev, from `OrganizationSwitcher` in the
sidebar footer... it masks any real hydration bug that shows up later"* — did
exactly what it warned it would: it got reported as a bug in two inventory pages
that had nothing to do with it. Closed; both shells now defer the Clerk widgets
past hydration.

**IT IS A RACE, NOT A BUG IN THE FOOTER'S JSX.** `OrganizationSwitcher` and
`UserButton` both render `clerk.loaded && <ClerkHostRenderer/>`, and `clerk.loaded`
is read DURING RENDER. It is always false on the server, so the HTML carries an
empty `<div class="flex items-center justify-between gap-2">`. If the remote
`clerk.browser.js` finishes before React's first client render, the client
produces a whole subtree that HTML does not have. Local chunks usually beat a
remote script, which is why the mismatch is machine-dependent and why chasing it
on a fast box finds nothing.

**`AfterHydration` REMOVES THE RACE RATHER THAN WINNING IT**
(`src/components/app/after-hydration.tsx`): server renders nothing, first client
render renders nothing, they agree by construction, widgets mount a tick later
exactly as they already did. `useSyncExternalStore(subscribe, () => true,
() => false)` rather than `useState` + `useEffect` — React reads the server
snapshot while hydrating, so no state is written from an effect, which
`react-hooks/set-state-in-effect` rightly flags.

**It is for third-party widgets that mount themselves, and nothing else.**
Anything wrapped in it is absent from server-rendered HTML: no text, no
navigation, no figure.

Proven with a probe of the same shape — one client-only `<span>` in the footer
reproduced the message verbatim, and wrapping it silenced it. `/dashboard`,
`/dashboard/m/inventory/value`, `/dashboard/m/inventory/tax` and `/admin` reload
clean, rail unchanged.

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
| `--success` / `--warning` | `bg-success/12`, `bg-warning/10` | Status **fills** only |
| `--success-foreground` / `--warning-foreground` | `text-*-foreground` | The dark twins, for text and glyphs on those tints |

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
  `--module-accent`) for a glyph or a figure. Note `text-brand-foreground` is a
  *different* token and is fine: it is the dark green.
- **`--warning` and `--success` are FILLS. Never draw with them.** Both are
  mid-to-light tones: `--warning` measures **2.18:1** on the page and `--success`
  3.43:1 on card, so an icon or a figure drawn in either fails even the 3:1 bar.
  Use `--warning-foreground` / `--success-foreground` — their dark twins — for
  anything you can read. This has now been got wrong twice by "modernising"
  `text-amber-600` onto `text-warning`, which made it worse; measure before
  swapping a hardcoded colour for a token.
- **A status chip is a pale tint with dark text**, never a saturated fill.
  `--success` measured 3.43:1 on card and only 3.28:1 as a fill under white text,
  so neither direction passed on its own — hence `--success-foreground`, its dark
  twin, and `bg-success/12 text-success-foreground` (5.9–6.2:1 light, 9–10:1
  dark). The same `--brand` / `--accent-brand` split, for the same reason. There
  is no single mid-tone that is both a legible foreground on white and a legible
  background for white text.
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
| `CategoryStrip` | **yes** | Wrapping module tab rows (`AccountingNav`, `DocumentsNav`) |
| `Panel` | no | `<Card><CardContent className="p-0">` around a list |
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

### `CategoryStrip`'s hairline and `trailing` slot

The bottom hairline lives on the **wrapper**, not the scroller, so it runs the
full width including anything passed as `trailing`. The active item still sits on
it because its bottom edge coincides with the wrapper's content edge, so `-mb-px`
pulls the 2px underline down over the hairline. Documents puts its search box in
`trailing` — outside the scroller, so it cannot scroll out of reach, and on the
same line as the sections.

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
- `src/components/app/after-hydration.tsx` — the gate both shells put Clerk's
  self-mounting widgets behind
- `src/app/dashboard/layout.tsx`, `src/app/admin/layout.tsx` — the two callers
  that build `navGroups`

## Decisions & gotchas

- **An icon cannot cross a server/client boundary as a component.** The rail's
  nav is built on the server from the `modules` table, so it names icons as
  strings and `icon-registry.ts` resolves them. That indirection is also why the
  registry must stay in sync with `src/modules/index.ts` — it silently did not,
  for three modules, until 2026-08-10.
- **A missing registry key fails silently.** `getIcon` falls back to `Boxes`
  rather than throwing, which is how three modules shipped with the wrong icon
  and nobody noticed. Adding a module means adding its icon name here.
- **Grep the alias block, not just `declare const`, when checking an icon name.**
  lucide-react re-exports old names (`SquareCheck as CheckSquare`,
  `ChartColumn as BarChart3`) in one long `export { … }` statement. A
  `^declare const X` grep says a name is gone when it is only aliased — that
  mistake produced a wrong claim in this repo's ADR on 2026-08-10.
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

## Where `PageHeader` does NOT belong

`PageHeader` is a left-aligned title / description / actions row for a page
inside the dashboard shell. Three kinds of screen deliberately keep a hand-built
heading, and they are not oversights:

- **Centred full-screen states** — `onboarding`, `error.tsx`, `not-found.tsx`.
  They are single-purpose and centred; an actions row on the right is the wrong
  shape. They take `font-heading` + `tracking-heading` and nothing else.
- **The public share page** (`/s/[token]`) uses it, but with no accent chip —
  `--module-accent` is unset outside a module route.
- **The `(marketing)` route group** is out of scope entirely. Its `h2`s use
  `tracking-tight` on purpose; do not sweep them.

## Coverage

`text-2xl font-semibold tracking-tight` — the string this replaced — is now at
**zero** under `dashboard/`, `admin/`, every `src/modules/*`, and `s/[token]`.
What remains is the three centred states above and `(marketing)`.

## Open items

- **The sweep.** ~70 surfaces still hand-roll their header, empty state and table
  panel. Planned as one PR per module: accounting → documents + mail → CRM + work
  + scheduling → admin/auth/onboarding.
- **`CommandPalette` indexes navigation only.** Searching records needs a server
  action per keystroke and per-module scoping. The placeholder deliberately says
  "Jump to a page" so it does not promise records.
- **`PageHeader` is not sticky.** The plan called for it; left out of the
  foundation PR rather than destabilise 73 pages at once. It is a prop away.
- **`SectionRow`'s scrolling variant is still unused.** The component itself is
  in use (the Documents hub), but nothing passes `scroll` yet.
- **`--font-heading` is a seam.** One line swaps the heading face if something
  closer to Airbnb Cereal is ever wanted.
