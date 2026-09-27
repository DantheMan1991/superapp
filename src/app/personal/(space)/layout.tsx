import type { ReactNode } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { AppShell, type NavGroup } from "@/components/app-shell";
import { AfterHydration } from "@/components/app/after-hydration";
import { isSuperAdmin, requirePersonalSpace } from "@/lib/auth";
import { PERSONAL_HOME } from "@/lib/personal-space-core";

export const dynamic = "force-dynamic";

/**
 * THE PERSONAL SPACE'S SHELL (ADR 0111, docs/modules/personal-space.md).
 *
 * The same `AppShell` the business runs in, with none of the business in it:
 * no modules group, no Business or Settings groups, no tell box, no feedback
 * button, no rail contexts. A personal space is a tenant of one person, and
 * what the business rail offers — a team, a bill, the words an industry uses —
 * means nothing here.
 *
 * `requirePersonalSpace`, never `requireTenant`: that one sends a personal
 * space HERE, and this one sends a business back to `/dashboard`, so each half
 * of the product can only be opened by its own kind of workspace.
 *
 * Its tools join the rail when the first one ships (fitness, F1), with the
 * `/personal/m/<slug>` route that renders them. Until then Home is the rail.
 */
export default async function PersonalLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePersonalSpace();
  const admin = await isSuperAdmin();

  const navGroups: NavGroup[] = [
    {
      label: "Personal",
      items: [{ href: PERSONAL_HOME, label: "Home", icon: "dashboard", exact: true }],
    },
  ];

  return (
    <AppShell
      contextLabel={ctx.tenant.name}
      navGroups={navGroups}
      footer={
        admin ? (
          <a
            href="/admin"
            className="block text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
          >
            ← Platform admin
          </a>
        ) : null
      }
      identity={
        // The switcher is the way back to the business: selecting one lands on
        // /dashboard, as it does from there. The same hydration guard as the
        // dashboard's own copy (components/app/after-hydration.tsx).
        <div className="flex min-w-0 items-center gap-2">
          <AfterHydration>
            <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" />
            <UserButton />
          </AfterHydration>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
