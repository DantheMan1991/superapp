import type { ReactNode } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  AppShell,
  type NavGroup,
  type NavItem,
} from "@/components/app-shell";
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

  // Only modules that are both switched on AND implemented appear in nav.
  const moduleItems: NavItem[] = active
    .filter(({ module }) => moduleRegistry[module.id])
    .map(({ module }) => ({
      href: `/dashboard/m/${module.id}`,
      label: module.name,
      icon: moduleRegistry[module.id]?.icon ?? "boxes",
      // The slug doubles as the accent name: `--accent-accounting` and friends
      // are declared in globals.css, so adding a module means adding one token,
      // not editing the shell.
      accent: module.id,
    }));

  const navGroups: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        { href: "/dashboard", label: "Overview", icon: "dashboard", exact: true },
        // Everyone, not owners only: the whole premise is that each person sees
        // their own work. It sits directly under Overview because it is the page
        // the morning email links to.
        { href: "/dashboard/today", label: "What needs you", icon: "checks" },
      ],
    },
    // A tenant with nothing switched on should not see an empty caption.
    ...(moduleItems.length > 0
      ? [{ label: "Modules", items: moduleItems }]
      : []),
    {
      label: "Business",
      items: [
        { href: "/dashboard/hours", label: "Hours", icon: "clock" },
        { href: "/dashboard/team", label: "Team", icon: "users" },
      ],
    },
  ];

  if (ctx.role === "owner") {
    navGroups.push({
      label: "Settings",
      items: [
        // Named "Email setup" rather than "Email" because the Mail module sits
        // in this same rail: this one decides what address the business's
        // outbound mail claims to come from, that one is the inbox.
        { href: "/dashboard/email", label: "Email setup", icon: "settings" },
        { href: "/dashboard/billing", label: "Billing", icon: "billing" },
        {
          href: "/dashboard/settings",
          label: "Business settings",
          icon: "wrench",
        },
      ],
    });
  }

  const mailNav = moduleItems.find(
    (item) => item.href === "/dashboard/m/email",
  );
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
      navGroups={navGroups}
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
