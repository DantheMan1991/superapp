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
import { getRenderableFeature } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import { AfterHydration } from "@/components/app/after-hydration";

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

  // Only features that are both switched on AND renderable appear in nav. A
  // capability pack can be declared, installed by a profile and switched on
  // while still having no `Component` — that is the empty-slot state, and it
  // must never reach the rail.
  const renderable = active.filter(({ module }) => getRenderableFeature(module.id));
  const toNavItem = ({ module }: (typeof renderable)[number]): NavItem => ({
    href: `/dashboard/m/${module.id}`,
    label: module.name,
    icon: getRenderableFeature(module.id)?.icon ?? "boxes",
    // The slug doubles as the accent name: `--accent-accounting` and friends
    // are declared in globals.css, so adding a module means adding one token,
    // not editing the shell.
    accent: module.id,
  });

  // Core tools and capability packs are grouped separately (ADR 0009). Seven
  // packs beside six core modules is a thirteen-item flat list, and the rail
  // gets worse the moment a profile installs — so `category` carries the split.
  const coreItems = renderable
    .filter(({ module }) => module.category !== "pack")
    .map(toNavItem);
  const packItems = renderable
    .filter(({ module }) => module.category === "pack")
    .map(toNavItem);

  // The installed profile names its own group. `tenants.industry` defaults to
  // `general`, which is the absence of a profile rather than one of them, so
  // the lookup returning null is the ordinary case and not an error.
  const profile = getIndustryProfile(ctx.tenant.industry);

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
    ...(coreItems.length > 0 ? [{ label: "Modules", items: coreItems }] : []),
    ...(packItems.length > 0
      ? [{ label: profile?.name ?? "Add-ons", items: packItems }]
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
        // The OTHER Stripe, and the neighbouring row is exactly why the label
        // spells it out: "Billing" is what this business pays us, "Taking
        // payments" is what its own customers pay it. ADR 0015.
        {
          href: "/dashboard/settings/payments",
          label: "Taking payments",
          icon: "payments",
        },
        // The lines of business the money is reported against — Broilers,
        // Beef, Eggs. Under Settings rather than in a module because four
        // packs name an enterprise and none of them owns it; see
        // src/db/schema/enterprises.ts.
        {
          href: "/dashboard/settings/enterprises",
          label: "Enterprises",
          icon: "wrench",
        },
        {
          href: "/dashboard/settings",
          label: "Business settings",
          icon: "wrench",
          // Exact, because "Taking payments" lives at /dashboard/settings/
          // payments and the default prefix match would light both rows up.
          exact: true,
        },
      ],
    });
  }

  const mailNav = coreItems.find((item) => item.href === "/dashboard/m/email");
  if (mailNav) {
    // The dot wins over the count: a mailbox that needs reconnecting has an
    // unknown amount of mail behind it, so a number there would be a guess.
    if (mail.needsAttention) mailNav.badgeAlert = true;
    else if (mail.count > 0) mailNav.badge = mail.count;
  }

  // Modules that asked for the whole viewport. Only enabled ones are listed,
  // so a switched-off module can never widen the shell.
  const fullWidthPathPrefixes = renderable
    .filter(({ module }) => getRenderableFeature(module.id)?.layout === "full")
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
          {/* Both widgets decide DURING RENDER whether Clerk.js has loaded, and
              the answer is always no on the server — so if that script wins the
              race against hydration, the client renders a subtree the HTML does
              not have. See components/app/after-hydration.tsx. */}
          <div className="flex items-center justify-between gap-2">
            <AfterHydration>
              <OrganizationSwitcher
                hidePersonal
                afterSelectOrganizationUrl="/dashboard"
              />
              <UserButton />
            </AfterHydration>
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
