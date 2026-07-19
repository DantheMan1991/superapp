"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Boxes,
  CreditCard,
  LayoutDashboard,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  boxes: Boxes,
  audit: ScrollText,
  sparkles: Sparkles,
  billing: CreditCard,
  settings: Settings,
  wrench: Wrench,
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

/**
 * The chrome both cockpits share: dark sidebar, branded wordmark, content
 * well. Modules render into `children` — this is the "empty, themed
 * container" from the build brief.
 */
export function AppShell({
  contextLabel,
  navItems,
  footer,
  children,
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen w-full">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold">
            S
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">SuperApp</div>
            <div className="text-[11px] text-sidebar-foreground/60">
              {contextLabel}
            </div>
          </div>
        </div>

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

        {footer && (
          <div className="border-t border-sidebar-border p-4">{footer}</div>
        )}
      </aside>

      <main className="ml-60 flex-1 bg-background">
        <div className="mx-auto w-full max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
