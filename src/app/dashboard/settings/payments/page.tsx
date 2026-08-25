import { AlertTriangle, CreditCard, ExternalLink } from "lucide-react";
import { requireTenantOwner } from "@/lib/auth";
import {
  adoptUnassignedAccount,
  isConnectConfigured,
  loadPaymentCompanies,
  reconcileConnectedAccounts,
  type PaymentCompany,
} from "@/lib/payments/connect";
import { dateInTimezone } from "@/lib/timezone";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConnectButton, RefreshStatusButton } from "./payment-controls";

export const dynamic = "force-dynamic";

const TONE_STYLES: Record<string, string> = {
  ok: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-accent text-accent-foreground",
  warn: "bg-warning/15 text-amber-700 dark:text-amber-300",
  idle: "bg-muted text-muted-foreground",
};

/**
 * **TAKING A CARD — THE FARM'S OWN STRIPE ACCOUNT.**
 *
 * Owner-only, and not as a matter of taste: this decides which bank account the
 * business's card takings land in and whose tax ID they are reported under.
 *
 * Not to be confused with `/dashboard/billing`, which is the OTHER direction —
 * the platform charging this tenant for its subscription. ADR 0015.
 */
export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireTenantOwner();
  const { status } = await searchParams;

  if (isConnectConfigured()) {
    // The books may have opened since the account was created; join them up
    // before reading (ADR 0015 — adoption is lazy because the table refuses
    // tenant writes and `provisionAccounting` runs in a tenant transaction).
    await adoptUnassignedAccount(ctx.tenant.id);
    /**
     * The Connect webhook is the primary sync; this direct API read covers
     * local dev, heals a missed event, and is the reason the return trip from
     * Stripe can be believed. `?status=returned` means "they came back", never
     * "they finished".
     */
    await reconcileConnectedAccounts(ctx.tenant.id);
  }

  const companies = await loadPaymentCompanies(
    ctx.tenant.id,
    ctx.tenant.name,
    ctx.role,
  );
  // ADR 0010's rule: the picker — here, the per-company heading — appears at
  // two. A one-company client never learns the word.
  const namesCompanies = companies.length > 1;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-brand/15 text-brand-foreground">
          <CreditCard className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Taking payments
          </h1>
          <p className="text-sm text-muted-foreground">
            Card payments go straight to your own bank account, in your own
            name.
          </p>
        </div>
      </div>

      {status === "expired" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-warning/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            That Stripe setup link had expired — they only last a few minutes.
            Nothing was lost; start it again below and Stripe picks up where you
            left off.
          </span>
        </div>
      )}

      {!isConnectConfigured() && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not available yet</CardTitle>
            <CardDescription>
              Card payments are not switched on for this deployment. Get in
              touch and we will set it up.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {isConnectConfigured() &&
        companies.map((company) => (
          <CompanyCard
            key={company.entityId ?? "unassigned"}
            company={company}
            showName={namesCompanies}
            timezone={ctx.tenant.timezone}
          />
        ))}

      {isConnectConfigured() && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Stripe handles the whole setup: your business details, your tax ID
            and your bank account are entered on Stripe&rsquo;s own pages and
            never touch Yosher. We never see or store a card number.
          </p>
          <p>
            Money from a card is Stripe&rsquo;s to hold and yours to receive —
            Yosher never holds your funds. Stripe&rsquo;s processing fee comes
            out of each payment, and the yearly tax form comes from Stripe in
            your business&rsquo;s name.
          </p>
        </div>
      )}
    </div>
  );
}

function CompanyCard({
  company,
  showName,
  timezone,
}: {
  company: PaymentCompany;
  showName: boolean;
  timezone: string;
}) {
  const { view } = company;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {showName ? company.name : "Card payments"}
          <Badge
            variant="outline"
            className={cn("border-transparent", TONE_STYLES[view.tone])}
          >
            {view.label}
          </Badge>
        </CardTitle>
        <CardDescription>{view.detail}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {view.outstanding.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium">Stripe still needs</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {view.outstanding.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden>·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {/**
             * A deadline is a fact worth stating plainly: after it, Stripe
             * stops accepting charges. Rendered in the business's own timezone
             * — the till reads UTC as the wrong day, and so would this.
             */}
            {company.requirementsDueBy && (
              <p className="mt-2 text-xs text-muted-foreground">
                Needed by {dateInTimezone(company.requirementsDueBy, timezone)},
                or Stripe stops accepting payments on this account.
              </p>
            )}
          </div>
        )}

        {company.stripeAccountId && (
          <p className="font-mono text-xs text-muted-foreground">
            {company.stripeAccountId}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {view.action === "connect" && (
          <ConnectButton
            entityId={company.entityId}
            label={
              view.state === "closed"
                ? "Set up card payments again"
                : "Set up card payments"
            }
          />
        )}
        {view.action === "continue" && (
          <ConnectButton
            entityId={company.entityId}
            label="Continue Stripe setup"
          />
        )}
        {company.stripeAccountId && view.state !== "closed" && (
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open your Stripe dashboard
            <ExternalLink className="size-3" />
          </a>
        )}
        {(view.state === "reviewing" ||
          view.state === "needs_information" ||
          view.state === "payouts_held") && <RefreshStatusButton />}
      </CardFooter>
    </Card>
  );
}
