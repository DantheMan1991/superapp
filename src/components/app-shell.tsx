"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CommandPalette, type CommandItem } from "@/components/app/command-palette";
import { getIcon } from "@/components/app/icon-registry";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** exact = highlight only on exact path match (for index routes) */
  exact?: boolean;
  /** Unread count. Absent or 0 renders nothing — a zero badge is noise. */
  badge?: number;
  /**
   * A dot instead of a count: "this needs you", not "this has N". Used when a
   * mailbox needs reconnecting, where a number would be a lie — we cannot know
   * how much unread mail is behind a credential we can no longer use.
   */
  badgeAlert?: boolean;
  /**
   * Module slug, when this row is a module. Sets `--module-accent` for the row,
   * so the icon carries that module's colour. Colour is doing navigation here,
   * not decoration: the rail is the one place every module is visible at once,
   * and a remembered colour finds a row faster than reading fifteen labels.
   */
  accent?: string;
}

export interface NavGroup {
  /**
   * Caption above the group. Notion's device, and the reason its sidebar stays
   * legible at length — fifteen flat rows is a list you read, four captioned
   * groups is a structure you scan.
   */
  label: string;
  items: NavItem[];
}

interface AppShellProps {
  /** Small label above the nav, e.g. tenant name or "Platform admin". */
  contextLabel: string;
  navGroups: NavGroup[];
  /**
   * Path prefixes whose pages take the whole viewport instead of the centred
   * max-w-6xl column.
   *
   * Passed in rather than decided here: the layout knows which modules asked
   * for it (ModuleDefinition.layout), and the shell only needs to match the
   * current path. That keeps the shell free of any module's name — a new
   * full-width module is a flag on its definition, not an edit to this file.
   */
  fullWidthPathPrefixes?: string[];
  /** Rendered at the bottom of the sidebar (user button, org switcher). */
  footer?: ReactNode;
  children: ReactNode;
}

function Brand({ contextLabel }: { contextLabel: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* The mark lives on a white chip so it reads on the dark sidebar. */}
      <div className="flex size-8 items-center justify-center overflow-hidden rounded-md bg-white">
        <Image src="/yosher-mark.png" alt="Yosher" width={30} height={30} />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-semibold tracking-tight">Yosher</div>
        <div className="truncate text-[11px] text-sidebar-foreground/60">
          {contextLabel}
        </div>
      </div>
    </div>
  );
}

function SidebarNav({
  navGroups,
  pathname,
  onNavigate,
}: {
  navGroups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-2">
      {navGroups.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p className="px-2.5 pb-1 text-[11px] font-medium text-sidebar-foreground/45">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = getIcon(item.icon);
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  style={
                    item.accent
                      ? ({
                          "--module-accent": `var(--accent-${item.accent})`,
                        } as React.CSSProperties)
                      : undefined
                  }
                  className={cn(
                    // Pill, not a rounded rectangle: the one shape Airbnb uses
                    // everywhere, and it reads as a control rather than a panel.
                    "flex items-center gap-2.5 rounded-full px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      // An accented module keeps its colour whether or not the
                      // row is active; the fill is what marks "you are here".
                      item.accent
                        ? "text-module-accent"
                        : active
                          ? "text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/55",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badgeAlert ? (
                    <span
                      className="size-2 shrink-0 rounded-full bg-destructive"
                      aria-label="Needs attention"
                    />
                  ) : item.badge && item.badge > 0 ? (
                    <span
                      // tabular-nums so the badge does not change width as the count
                      // changes; 99+ so a neglected mailbox cannot blow out the rail.
                      className="min-w-5 shrink-0 rounded-full bg-sidebar-primary px-1.5 text-center text-[11px] leading-5 font-medium text-sidebar-primary-foreground tabular-nums"
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Flattened for the palette, with the group caption carried through. */
function toCommandItems(navGroups: NavGroup[]): CommandItem[] {
  return navGroups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      group: group.label,
      icon: item.icon,
    })),
  );
}

/**
 * The chrome both cockpits share. Desktop: fixed dark sidebar. Mobile: top
 * bar + slide-out drawer — much of this product is used away from a desk, on a
 * phone, so it has to work one-handed.
 *
 * The command pill sits in the rail rather than above the content, for two
 * reasons. It stays mounted on every route, including the full-width modules
 * that own their own chrome down to the edges (Mail), which a bar in the
 * content column could not do without shortening them. And the rail is already
 * `print:hidden`, so search cannot end up in a printed invoice.
 */
export function AppShell({
  contextLabel,
  navGroups,
  fullWidthPathPrefixes,
  footer,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const commandItems = toCommandItems(navGroups);

  // Same prefix test the nav uses for its active state, so "full width" covers
  // a module's sub-routes without each one having to opt in again.
  const fullWidth = (fullWidthPathPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  // Close the drawer whenever navigation completes.
  //
  // Adjusted during render rather than in an effect. As an effect this set state
  // synchronously after the new route had already committed, costing a second
  // render pass just to close the drawer — what `react-hooks/set-state-in-effect`
  // flags. Comparing against the previous value during render is React's
  // documented way to react to a changed prop, and it resolves in the same pass.
  // Whether the old form was perceptible on a real phone was never measured; the
  // reason to change it is the extra pass, not an observed glitch.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  // Translucent white on navy, rather than the pill's default white card: the
  // rail is dark in both themes, so the light-mode surface tokens do not apply.
  const railPill =
    "bg-sidebar-accent/70 text-sidebar-foreground/70 shadow-none hover:bg-sidebar-accent hover:shadow-none [&_kbd]:border-sidebar-border";

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-sidebar px-3 text-sidebar-foreground lg:hidden print:hidden">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            data-sidebar-surface
            className="flex w-72 flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-16 items-center px-5">
              <Brand contextLabel={contextLabel} />
            </div>
            <div className="px-3 pb-3">
              <CommandPalette items={commandItems} className={railPill} />
            </div>
            <SidebarNav
              navGroups={navGroups}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
            {footer && (
              <div className="border-t border-sidebar-border p-4">{footer}</div>
            )}
          </SheetContent>
        </Sheet>
        <Brand contextLabel={contextLabel} />
      </header>

      {/* Desktop sidebar */}
      <aside
        data-sidebar-surface
        className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-sidebar text-sidebar-foreground lg:flex print:hidden"
      >
        <div className="flex h-16 items-center px-5">
          <Brand contextLabel={contextLabel} />
        </div>
        <div className="px-3 pb-3">
          <CommandPalette items={commandItems} className={railPill} />
        </div>
        <SidebarNav navGroups={navGroups} pathname={pathname} />
        {footer && (
          <div className="border-t border-sidebar-border p-4">{footer}</div>
        )}
      </aside>

      {/*
        min-w-0 because <main> is a flex child on lg: without it a wide grid
        inside a full-width module pushes the whole row past the viewport
        instead of scrolling within its own pane.
      */}
      <main className="min-w-0 flex-1 bg-background lg:ml-60 print:ml-0">
        {fullWidth ? (
          // No padding and no clamp — a module that asked for the viewport
          // owns its own chrome, down to the edges.
          children
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
