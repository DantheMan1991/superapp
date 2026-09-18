import type { ReactNode } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  AppShell,
  type NavGroup,
  type NavItem,
} from "@/components/app-shell";
import { requireTenant, isSuperAdmin } from "@/lib/auth";
import { isNativeApp, launchPending } from "@/lib/native-app";
import { LaunchOverlay } from "@/components/app/launch-overlay";
import { getActiveModules } from "@/lib/modules";
import { getMailBadge } from "@/lib/email/badge";
import { getRenderableFeature } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import { labelFor, pluralOf } from "@/lib/packs/resolve";
import { packGroupLabel } from "@/lib/packs/group-label";
import { labelsForTenant } from "@/lib/packs/tenant-context";
import { LabelProvider } from "@/components/app/label-provider";
import {
  ENTERPRISE_FALLBACK,
  ENTERPRISE_FALLBACK_PLURAL,
  ENTERPRISE_LABEL_KEY,
} from "@/lib/enterprises/vocabulary";
import { AfterHydration } from "@/components/app/after-hydration";
import { PushRegistration } from "@/components/app/push-registration";
import { TellLauncher } from "@/components/app/tell-launcher";
import { FeedbackProvider } from "@/components/app/report-button";
import { countUnreadReplies } from "@/lib/feedback/read";
import { isServerSpeechConfigured } from "@/lib/speech/providers";
import { SupportBanner } from "./support-banner";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireTenant();
  /**
   * Resolved HERE rather than fetched: `ctx.tenant` already carries the
   * industry and the tenant's own overrides, so the rail's word costs no query.
   *
   * Resolved ONCE and reused, since 2026-09-13. It was inlined into the
   * enterprise word below, and the party words added by that slice need the same
   * map — two calls would have been two chances to resolve them differently.
   */
  const labels = labelsForTenant(ctx.tenant);
  const enterpriseWord = labelFor(
    labels,
    ENTERPRISE_LABEL_KEY,
    ENTERPRISE_FALLBACK,
  );
  // `pluralOf` rather than the ternary this used to be: the guides and core's
  // party words need the same rule, and it now lives in one place.
  const enterprisePlural = pluralOf(
    enterpriseWord,
    ENTERPRISE_FALLBACK,
    ENTERPRISE_FALLBACK_PLURAL,
  );
  const [active, admin, mail, inApp, showLaunch, unreadFeedback] =
    await Promise.all([
      getActiveModules(ctx.tenant.id),
      isSuperAdmin(),
      // One indexed SELECT against a number sync already wrote. Never a JMAP
      // call — this layout renders on every dashboard page in the product.
      getMailBadge(ctx.tenant.id, ctx.userId, ctx.role),
      isNativeApp(),
      launchPending(),
      /*
        The dot on the report button (ADR 0053). Held to the same bar as the
        mail badge next to it: ONE indexed count over rows this person already
        owns, never a list. A SUPPORT VIEW COUNTS NOTHING — a superadmin
        looking at a client's workspace is not the client, and a dot counting
        somebody else's replies would be wrong in both directions.
      */
      ctx.support ? Promise.resolve(0) : countUnreadReplies(ctx),
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
  const packSlugs = renderable
    .filter(({ module }) => module.category === "pack")
    .map(({ module }) => module.id);
  const packItems = renderable
    .filter(({ module }) => module.category === "pack")
    .map(toNavItem);

  // The installed profile names its own group. `tenants.industry` defaults to
  // `general`, which is the absence of a profile rather than one of them, so
  // the lookup returning null is the ordinary case and not an error.
  const profile = getIndustryProfile(ctx.tenant.industry);
  // Only while that one profile accounts for every pack that is on — see
  // `packGroupLabel`, which is where the reasoning lives.
  const packLabel = packGroupLabel(profile, packSlugs);

  const navGroups: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        { href: "/dashboard", label: "Overview", icon: "dashboard", exact: true },
        // Everyone, not owners only: the whole premise is that each person sees
        // their own work. It sits directly under Overview because it is the page
        // the morning email links to.
        { href: "/dashboard/today", label: "What needs you", icon: "checks" },
        // Every screen carries a "?" for its own guide; this is the whole shelf,
        // filtered to what this business has switched on. Listing it here also
        // puts it in the command palette, which flattens these groups.
        { href: "/dashboard/guides", label: "Guides", icon: "book" },
      ],
    },
    // A tenant with nothing switched on should not see an empty caption.
    ...(coreItems.length > 0 ? [{ label: "Modules", items: coreItems }] : []),
    ...(packItems.length > 0 ? [{ label: packLabel, items: packItems }] : []),
    {
      label: "Business",
      items: [
        { href: "/dashboard/hours", label: "Hours", icon: "clock" },
        // Everyone, not owners only, and this is why it is HERE and not in the
        // Settings group below: that group changes how the BUSINESS behaves
        // and is owner-gated, while this is one person's own phone. A
        // farmhand who cannot set their own phone up cannot use the feature
        // at all. ADR 0048.
        { href: "/dashboard/settings/phone", label: "Your phone", icon: "smartphone" },
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
        // Not inside the mobile app: the page there would show status and
        // nothing to do, and a rail row that leads nowhere is worse than none.
        // Hours stays, because its meter and log are the page. ADR 0032.
        ...(inApp
          ? []
          : [{ href: "/dashboard/billing", label: "Billing", icon: "billing" }]),
        // The OTHER Stripe, and the neighbouring row is exactly why the label
        // spells it out: "Billing" is what this business pays us, "Taking
        // payments" is what its own customers pay it. ADR 0015.
        {
          href: "/dashboard/settings/payments",
          label: "Taking payments",
          icon: "payments",
        },
        // The parts of the business the money is reported against. Under
        // Settings rather than in a module because four packs name one and none
        // of them owns it; see src/db/schema/enterprises.ts.
        //
        // **THE WORD COMES FROM THE PROFILE**, like every other renameable noun
        // in the rail — a core tool speaks no industry, and this one read
        // "Enterprises" at every tenant until it was fixed.
        {
          href: "/dashboard/settings/enterprises",
          label: enterprisePlural,
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
  const fullWidthPathPrefixes = renderable.flatMap(({ module }) => {
    const def = getRenderableFeature(module.id);
    const base = `/dashboard/m/${module.id}`;
    const prefixes = def?.layout === "full" ? [base] : [];
    for (const sub of def?.fullWidthPaths ?? []) prefixes.push(`${base}/${sub}`);
    return prefixes;
  });

  return (
    <>
    {/* Inside the app, the first page of a launch plays the launch animation over itself. */}
    {showLaunch && <LaunchOverlay />}
    {/* SAY IT FROM ANYWHERE (ADR 0051). In the layout rather than on a page,
        because the cost this removes is knowing which screen to go to — and a
        control you have to navigate to in order to avoid navigating is not
        removing it. Whether a speech vendor is configured is a fact about the
        deployment, so the server answers it here once. */}
    <TellLauncher speechConfigured={isServerSpeechConfigured()} />
    <AppShell
      contextLabel={ctx.tenant.name}
      navGroups={navGroups}
      fullWidthPathPrefixes={fullWidthPathPrefixes}
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
      /*
        SEPARATE FROM `footer` SO THESE NEVER RENDER INSIDE THE MOBILE DRAWER.
        Both open popovers that Clerk portals to `body`, and the drawer is a
        modal dialog that disables pointer events there — the popover paints on
        top and every tap goes through it. See components/app-shell.tsx.
      */
      identity={
        // Both widgets decide DURING RENDER whether Clerk.js has loaded, and
        // the answer is always no on the server — so if that script wins the
        // race against hydration, the client renders a subtree the HTML does
        // not have. See components/app/after-hydration.tsx.
        <div className="flex min-w-0 items-center gap-2">
          <AfterHydration>
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/dashboard"
            />
            <UserButton />
            {/* Inside the mobile app: ask for notifications and register the phone. Nothing in a browser. */}
            <PushRegistration />
          </AfterHydration>
        </div>
      }
    >
      {/* A support view says so on every page (back-office slice 4). */}
      {ctx.support && (
        <SupportBanner
          tenantId={ctx.support.tenantId}
          tenantName={ctx.support.tenantName}
          reason={ctx.support.reason}
          expiresAt={ctx.support.expiresAt.toISOString()}
        />
      )}
      {/* SAY THIS SCREEN IS WRONG, FROM THIS SCREEN. The provider rather than
          the button, because the button is rendered by `PageHeader` deep
          inside `children` and this layout is the only thing that knows the
          count. Outside it — /admin, the public share page — there is no
          provider and `ReportButton` draws nothing. */}
      {/* THE TENANT'S WORDS, for the client components inside `children`.
          Same reasoning as the provider below it: a word is rendered deep in a
          form or a nav and this layout is the only thing holding `ctx.tenant`.
          Costs no query — the labels are resolved above from the row that
          `requireTenant` already returned. */}
      <LabelProvider labels={labels}>
        <FeedbackProvider
          unread={unreadFeedback}
          enabled={!ctx.support}
          tenantId={ctx.tenant.id}
        >
          {children}
        </FeedbackProvider>
      </LabelProvider>
    </AppShell>
    </>
  );
}
