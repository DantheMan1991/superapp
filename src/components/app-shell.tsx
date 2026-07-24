"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Boxes,
  Calculator,
  Clock,
  CreditCard,
  LayoutDashboard,
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
};

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** exact = highlight only on exact path match (for index routes) */
  exact?: boolean;
}

interface AppShellProps {
  /** Small label above the nav, e.g. tenant name or "Platform admin". */
  contextLabel: string;
  navItems: NavItem[];
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The chrome both cockpits share. Desktop: fixed dark sidebar. Mobile: top
 * bar + slide-out drawer — contractors live on their phones, so this must
 * work one-handed on a job site.
 */
export function AppShell({
  contextLabel,
  navItems,
  footer,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

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

      <main className="flex-1 bg-background lg:ml-60 print:ml-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
