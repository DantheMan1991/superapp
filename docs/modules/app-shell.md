# App shell

> The chrome both cockpits share: the tenant dashboard and the superadmin
> console render through one `AppShell`. Desktop gets a fixed dark sidebar,
> mobile a top bar plus a slide-out drawer — much of this product is used away
> from a desk, on a phone, so the nav has to work one-handed. Owns no data and
> no routes; it is the frame every module is hung inside.
> Status: live · Scope: `platform`

## Build log

### 2026-08-07 — Drawer state derived, not synchronised (branch `claude/priceless-khayyam-b284fb`)
- The mobile drawer closed itself with `useEffect(() => setDrawerOpen(false), [pathname])`. `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks 7) flags that at **error** level, so `npx eslint` over the repo was red and a new violation could not be told apart from the standing one
- The open state is now **the path the drawer was opened on** (`openedOnPath: string | null`), cleared during render when the path changes. "Close on navigation" becomes a derivation instead of a synchronisation
- **The two obvious fixes are both wrong here.** Moving the close into the link handler alone regresses the footer: `dashboard/layout.tsx` passes Clerk's `OrganizationSwitcher` (`afterSelectOrganizationUrl="/dashboard"`), the `UserButton` and the `← Platform admin` link as `footer`, and the footer renders *inside* the drawer on mobile — all three navigate without going near `onNavigate`. And the naive derivation `openedOnPath === pathname` reopens the drawer when the user navigates **back** to the page they opened it on; clearing the stored path rather than leaving it to be compared against forever is what prevents that
- `onNavigate` stays on the nav links, no longer for correctness but so the drawer closes on tap rather than when the next page finishes streaming
- Same sweep, same reason: an apostrophe escaped in `src/app/error.tsx` (`react/no-unescaped-entities`, also error-level). Copy unchanged. With these and the two in [accounting.md](accounting.md) and [retainer-hours.md](retainer-hours.md), **`npx eslint src/` is back to zero errors** — 21 `no-unused-vars` warnings remain and are untouched
- Dossier created with this entry. The shell itself dates to `0295de3` (2026-07-19) with the mobile layout from `1342bac`; the seams below were added by the modules that needed them (`ff4fb7b` full-width, `5f65341` the mail badge)

## Data model

None. The shell reads `usePathname()` and renders what its props say.

## Key files & seams

- `src/components/app-shell.tsx` — the whole thing; a client component because the active-nav test and the drawer both need the pathname
- `src/app/dashboard/layout.tsx`, `src/app/admin/layout.tsx` — the two callers, which decide *what* is in the nav
- `src/components/ui/sheet.tsx` — the mobile drawer primitive

Three props are the contract:

| Prop | What it buys |
| --- | --- |
| `navItems: NavItem[]` | `href`, `label`, `icon` (name, resolved against an `ICONS` map), `exact` for index routes, and `badge` / `badgeAlert` |
| `fullWidthPathPrefixes` | Path prefixes whose pages take the viewport instead of the centred `max-w-6xl` column |
| `footer` | Rendered at the bottom of the sidebar — and inside the drawer on mobile, which is what makes it a navigation source |

## Decisions & gotchas

- **The shell never names a module.** Full-width layout is a flag on `ModuleDefinition.layout` that the layout translates into path prefixes, so a new full-width module is one line on its definition and no edit here. The prefix test is the same one the nav uses for its active state, so a module's sub-routes are covered without each opting in again.
- **`badgeAlert` (a dot) beats `badge` (a count).** A mailbox that needs reconnecting has an unknown amount of mail behind a credential we can no longer use — a number there would be a lie. Counts are `tabular-nums` so the rail does not jitter, and clamp at `99+` so a neglected mailbox cannot blow out the sidebar.
- **`<main>` carries `min-w-0`.** It is a flex child on `lg:`; without it a wide grid inside a full-width module pushes the whole row past the viewport instead of scrolling in its own pane.
- **The drawer must close on *any* navigation, not just a nav-link tap** — see the build log above. Anything added to `footer` inherits this, which is the point.

## Open items

- The drawer state machine has no test. The cases that matter are the two the current shape exists to handle: navigation from the footer, and back-navigation to the page the drawer was opened on.
