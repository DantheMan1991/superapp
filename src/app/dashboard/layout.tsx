import type { ReactNode } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { AppShell, type NavItem } from "@/components/app-shell";
import { requireTenant, isSuperAdmin } from "@/lib/auth";
import { getActiveModules } from "@/lib/modules";
import { moduleRegistry } from "@/modules";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireTenant();
  const [active, admin] = await Promise.all([
    getActiveModules(ctx.tenant.id),
    isSuperAdmin(),
  ]);

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Overview", icon: "dashboard", exact: true },
    // Only modules that are both switched on AND implemented appear in nav.
    ...active
      .filter(({ module }) => moduleRegistry[module.id])
      .map(({ module }) => ({
        href: `/dashboard/m/${module.id}`,
        label: module.name,
        icon: moduleRegistry[module.id]?.icon ?? "boxes",
      })),
  ];

  navItems.push({ href: "/dashboard/team", label: "Team", icon: "users" });

  if (ctx.role === "owner") {
    navItems.push({
      href: "/dashboard/billing",
      label: "Billing",
      icon: "billing",
    });
  }

  return (
    <AppShell
      contextLabel={ctx.tenant.name}
      navItems={navItems}
      footer={
        <div className="space-y-3">
          {admin && (
            <a
              href="/admin"
              className="block text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
            >
              ← Platform admin
            </a>
          )}
          <div className="flex items-center justify-between gap-2">
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/dashboard"
            />
            <UserButton />
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
