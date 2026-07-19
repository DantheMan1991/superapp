import { eq } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import { withTenant, schema } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { reconcileSubscriptionFromStripe } from "@/lib/billing-sync";
import { PLANS } from "@/lib/stripe";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { ManageBillingButton, SubscribeButton } from "./billing-buttons";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireTenantOwner();
  const { status } = await searchParams;

  // Webhooks are the primary sync; this direct API read covers local dev
  // (no public URL for Stripe to call) and heals any missed event.
  await reconcileSubscriptionFromStripe(ctx.tenant.id);

  const subscription = await withTenant(ctx.tenant.id, (tx) =>
    tx.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.tenantId, ctx.tenant.id),
    }),
  );

  const hasSubscription =
    !!subscription?.stripeSubscriptionId &&
    subscription.status !== "canceled" &&
    subscription.status !== "none";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Subscription and payment for {ctx.tenant.name}.
        </p>
      </div>

      {status === "success" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300/50 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="size-4" />
          Payment set up — your subscription is active (it can take a few
          seconds to reflect here).
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current subscription</CardTitle>
          <CardDescription className="flex items-center gap-2">
            <SubscriptionStatusBadge status={subscription?.status ?? "none"} />
            {subscription?.planName && <span>{subscription.planName}</span>}
            {subscription?.cancelAtPeriodEnd && (
              <Badge variant="outline">cancels at period end</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {hasSubscription ? (
            <p>
              {subscription?.currentPeriodEnd
                ? `Renews ${subscription.currentPeriodEnd.toLocaleDateString()}.`
                : ""}{" "}
              Payment methods, invoices, and cancellation are handled securely
              by Stripe.
            </p>
          ) : (
            <p>No active subscription yet. Pick a plan below to get started.</p>
          )}
        </CardContent>
        {hasSubscription && (
          <CardFooter>
            <ManageBillingButton />
          </CardFooter>
        )}
      </Card>

      {!hasSubscription && (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.values(PLANS).map((plan) => (
            <Card key={plan.key} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1" />
              <CardFooter>
                <SubscribeButton
                  plan={plan.key}
                  label={`Subscribe to ${plan.name}`}
                  includeOnboardingFee={ctx.tenant.status === "onboarding"}
                />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Payments are processed by Stripe. Card details never touch our servers.
      </p>
    </div>
  );
}
