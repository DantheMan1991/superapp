import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowRight, Boxes } from "lucide-react";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { getActiveModules } from "@/lib/modules";
import { moduleRegistry } from "@/modules";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { loadRetainerView } from "@/lib/retainer";
import { formatMinutesAsHours } from "@/lib/retainer-core";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireTenant();
  const [active, subscription, retainerView] = await Promise.all([
    getActiveModules(ctx.tenant.id),
    withTenant(ctx.tenant.id, (tx) =>
      tx.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.tenantId, ctx.tenant.id),
      }),
    ),
    withTenant(ctx.tenant.id, (tx) => loadRetainerView(tx, ctx.tenant.id)),
  ]);

  const renderable = active.filter(({ module }) => moduleRegistry[module.id]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {ctx.tenant.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your business office, in one place.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {renderable.map(({ module }) => (
          <Card key={module.id} className="group relative">
            <CardHeader>
              <CardTitle className="text-base">{module.name}</CardTitle>
              <CardDescription>{module.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/dashboard/m/${module.id}`}>
                  Open <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}

        {renderable.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Boxes className="size-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No modules active yet</p>
                <p className="text-sm text-muted-foreground">
                  Your modules get switched on as part of onboarding —
                  we&apos;ll take it from here.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {retainerView.hasAnyData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hours</CardTitle>
              <CardDescription
                className={
                  retainerView.usage.isOver ? "text-destructive" : undefined
                }
              >
                {formatMinutesAsHours(retainerView.usage.usedMinutes)} of{" "}
                {formatMinutesAsHours(retainerView.usage.includedMinutes)} used
                ·{" "}
                {formatMinutesAsHours(
                  retainerView.usage.purchasedMinutesRemaining,
                )}{" "}
                purchased left{" "}
                {retainerView.usage.isOver && (
                  <Badge variant="destructive">Over</Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/hours">
                  View work log <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {ctx.role === "owner" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subscription</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <SubscriptionStatusBadge
                  status={subscription?.status ?? "none"}
                />
                {subscription?.planName && <span>{subscription.planName}</span>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/billing">
                  Manage billing <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
