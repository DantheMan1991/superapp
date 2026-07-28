import type { ReactNode } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { AppShell, type NavItem } from "@/components/app-shell";
import { requireTenant, isSuperAdmin } from "@/lib/auth";
import { getActiveModules } from "@/lib/modules";
import { getMailBadge } from "@/lib/email/badge";
import { moduleRegistry } from "@/modules";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireTenant();
  const [active, admin, mail] = await Promise.all([
    getActiveModules(ctx.tenant.id),
    isSuperAdmin(),
    // One indexed SELECT against a number sync already wrote. Never a JMAP
    // call — this layout renders on every dashboard page in the product.
    getMailBadge(ctx.tenant.id, ctx.userId, ctx.role),
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

  navItems.push({ href: "/dashboard/hours", label: "Hours", icon: "clock" });
  navItems.push({ href: "/dashboard/team", label: "Team", icon: "users" });

  if (ctx.role === "owner") {
    // Owner-only, and named "Email setup" rather than "Email" because the Mail
    // module sits in this same list: this one decides what address the
    // business's outbound mail claims to come from, that one is the inbox.
    navItems.push({
      href: "/dashboard/email",
      label: "Email setup",
      icon: "settings",
    });
    navItems.push({
      href: "/dashboard/billing",
      label: "Billing",
      icon: "billing",
    });
  }

  const mailNav = navItems.find((item) => item.href === "/dashboard/m/email");
  if (mailNav) {
    // The dot wins over the count: a mailbox that needs reconnecting has an
    // unknown amount of mail behind it, so a number there would be a guess.
    if (mail.needsAttention) mailNav.badgeAlert = true;
    else if (mail.count > 0) mailNav.badge = mail.count;
  }

  // Modules that asked for the whole viewport. Only enabled ones are listed,
  // so a switched-off module can never widen the shell.
  const fullWidthPathPrefixes = active
    .filter(({ module }) => moduleRegistry[module.id]?.layout === "full")
    .map(({ module }) => `/dashboard/m/${module.id}`);

  return (
    <AppShell
      contextLabel={ctx.tenant.name}
      navItems={navItems}
      fullWidthPathPrefixes={fullWidthPathPrefixes}
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
