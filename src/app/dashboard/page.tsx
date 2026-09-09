import Link from "next/link";
import { eq } from "drizzle-orm";
import { Boxes } from "lucide-react";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isNativeApp } from "@/lib/native-app";
import { getActiveModules } from "@/lib/modules";
import { getRenderableFeature, isRenderable } from "@/lib/features";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { SectionRow } from "@/components/app/section-row";
import { getIcon } from "@/components/app/icon-registry";
import { GettingSetUp } from "./getting-set-up";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { loadRetainerView } from "@/lib/retainer";
import { formatMinutesAsHours } from "@/lib/retainer-core";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireTenant();
  // Inside the mobile app the Billing page is status only and has no rail
  // row, so the subscription card states the plan and does not lead there.
  // ADR 0032.
  const inApp = await isNativeApp();
  const [active, subscription, retainerView] = await Promise.all([
    getActiveModules(ctx.tenant.id),
    withTenant(ctx.tenant.id, (tx) =>
      tx.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.tenantId, ctx.tenant.id),
      }),
    ),
    withTenant(ctx.tenant.id, (tx) => loadRetainerView(tx, ctx.tenant.id)),
  ]);

  const renderable = active.filter(({ module }) => isRenderable(module.id));
  const usage = retainerView.usage;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back, ${ctx.tenant.name}`}
        description="Your business office, in one place."
      />

      {/* The two figures an owner opens this page to see. Staff see only the
          hours card, and only once there is anything to count. */}
      {(retainerView.hasAnyData || ctx.role === "owner") && (
        <div className="grid gap-3 sm:grid-cols-2">
          {retainerView.hasAnyData && (
            <StatCard
              label="Hours used"
              value={formatMinutesAsHours(usage.usedMinutes)}
              tone={usage.isOver ? "destructive" : "default"}
              href="/dashboard/hours"
              footnote={
                <>
                  of {formatMinutesAsHours(usage.includedMinutes)} included ·{" "}
                  {formatMinutesAsHours(usage.purchasedMinutesRemaining)}{" "}
                  purchased left
                  {usage.isOver && " · over"}
                </>
              }
            />
          )}
          {ctx.role === "owner" && (
            <StatCard
              label="Subscription"
              value={subscription?.planName ?? "No plan"}
              href={inApp ? undefined : "/dashboard/billing"}
              footnote={
                <SubscriptionStatusBadge
                  status={subscription?.status ?? "none"}
                />
              }
            />
          )}
        </div>
      )}

      {/* What the switched-on tools still need, for the owner, until there is
          nothing left — then the card is gone for good. Above the tiles because
          for a new business it is the whole page. */}
      <GettingSetUp tenantId={ctx.tenant.id} role={ctx.role} />

      <SectionRow
        title="Your modules"
        description={
          renderable.length > 0
            ? "Everything switched on for your business."
            : undefined
        }
      >
        {renderable.length === 0 ? (
          <EmptyState
            panel
            icon={<Boxes />}
            title="No modules active yet"
            description="Your modules get switched on as part of onboarding — we'll take it from here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {renderable.map(({ module }) => {
              const Icon = getIcon(getRenderableFeature(module.id)?.icon);
              return (
                <Link
                  key={module.id}
                  href={`/dashboard/m/${module.id}`}
                  // Same token the rail sets, so a module's colour is the same
                  // here as it is in the nav row that leads here.
                  style={
                    {
                      "--module-accent": `var(--accent-${module.id})`,
                    } as React.CSSProperties
                  }
                  className="group/tile block rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-module-accent/10 text-module-accent">
                    <Icon className="size-5" />
                  </div>
                  <p className="mt-3 font-heading font-medium tracking-heading">
                    {module.name}
                  </p>
                  {module.description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {module.description}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </SectionRow>
    </div>
  );
}
