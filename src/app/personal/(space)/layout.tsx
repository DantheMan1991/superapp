import type { ReactNode } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { AppShell, type NavGroup, type NavItem } from "@/components/app-shell";
import { AfterHydration } from "@/components/app/after-hydration";
import { isSuperAdmin, requirePersonalSpace } from "@/lib/auth";
import { getRenderableFeature } from "@/lib/features";
import { getActiveModules } from "@/lib/modules";
import { previewPersonalTools } from "@/lib/personal-space";
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
 * Its tools are the rail's second row onwards (F1): every personal tool switched
 * on here and renderable, read through the same `getActiveModules` the
 * business rail uses — which already drops a tool that does not belong in this
 * kind of workspace — linking to `/personal/m/<slug>`.
 */
export default async function PersonalLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePersonalSpace();
  const admin = await isSuperAdmin();
  // A superadmin's own space previews the personal tools still being built
  // (`ensurePersonalToolsSql`), however they arrived. The door
  // (`/personal/open`) switches them on too, but the workspace switcher lands
  // here without passing it, so a preview would reach the founder only if he
  // happened to come in through the account menu. One idempotent insert, for
  // the handful of people who are superadmins, shared with the page rendering
  // beside this layout (`previewPersonalTools`); it never switches a tool back
  // on that they switched off.
  await previewPersonalTools(ctx.tenant.id, admin);
  const active = await getActiveModules(ctx.tenant.id);

  const tools: NavItem[] = active
    .filter(({ module }) => getRenderableFeature(module.id))
    .map(({ module }) => ({
      href: `/personal/m/${module.id}`,
      label: module.name,
      icon: getRenderableFeature(module.id)?.icon ?? "boxes",
      // `--accent-<slug>`, as on the business rail.
      accent: module.id,
    }));

  const navGroups: NavGroup[] = [
    {
      label: "Personal",
      items: [
        { href: PERSONAL_HOME, label: "Home", icon: "dashboard", exact: true },
        ...tools,
      ],
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
