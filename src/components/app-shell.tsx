"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  Boxes,
  Calculator,
  Clock,
  CreditCard,
  FolderOpen,
  LayoutDashboard,
  Mail,
  Menu,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  dashboard: LayoutDashboard,
  calculator: Calculator,
  users: Users,
  boxes: Boxes,
  audit: ScrollText,
  sparkles: Sparkles,
  billing: CreditCard,
  settings: Settings,
  wrench: Wrench,
  clock: Clock,
  folder: FolderOpen,
  mail: Mail,
};

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
}

interface AppShellProps {
  /** Small label above the nav, e.g. tenant name or "Platform admin". */
  contextLabel: string;
  navItems: NavItem[];
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
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">Yosher</div>
        <div className="text-[11px] text-sidebar-foreground/60">
          {contextLabel}
        </div>
      </div>
    </div>
  );
}

function SidebarNav({
  navItems,
  pathname,
  onNavigate,
}: {
  navItems: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="mt-2 flex-1 space-y-0.5 px-3">
      {navItems.map((item) => {
        const Icon = ICONS[item.icon] ?? Boxes;
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
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
                className="min-w-5 shrink-0 rounded-full bg-sidebar-primary px-1.5 text-center text-[11px] leading-5 font-medium tabular-nums text-sidebar-primary-foreground"
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The chrome both cockpits share. Desktop: fixed dark sidebar. Mobile: top
 * bar + slide-out drawer — much of this product is used away from a desk, on a
 * phone, so it has to work one-handed.
 */
export function AppShell({
  contextLabel,
  navItems,
  fullWidthPathPrefixes,
  footer,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Same prefix test the nav uses for its active state, so "full width" covers
  // a module's sub-routes without each one having to opt in again.
  const fullWidth = (fullWidthPathPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  // Close the drawer whenever navigation completes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
            className="flex w-72 flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-16 items-center px-5">
              <Brand contextLabel={contextLabel} />
            </div>
            <SidebarNav
              navItems={navItems}
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
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-sidebar text-sidebar-foreground lg:flex print:hidden">
        <div className="flex h-16 items-center px-5">
          <Brand contextLabel={contextLabel} />
        </div>
        <SidebarNav navItems={navItems} pathname={pathname} />
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
