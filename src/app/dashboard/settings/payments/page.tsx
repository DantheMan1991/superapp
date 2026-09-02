import { AlertTriangle, CircleCheck, CreditCard, ExternalLink } from "lucide-react";
import { requireTenantOwner } from "@/lib/auth";
import {
  adoptUnassignedAccount,
  isConnectConfigured,
  loadPaymentCompanies,
  reconcileConnectedAccounts,
  type PaymentCompany,
} from "@/lib/payments/connect";
import {
  loadSquareConnections,
  reconcileSquareAccounts,
  squareDashboardUrl,
  type SquareConnection,
} from "@/lib/payments/square/accounts";
import { isSquareConfigured } from "@/lib/payments/square/config";
import { describeSquareAccount } from "@/lib/payments/square/status";
import { listReaders, refreshReaders, type ReaderView } from "@/lib/payments/terminal";
import { dateInTimezone } from "@/lib/timezone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
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
import { ReaderSection } from "./reader-controls";
import { SquareDisconnectButton, SquareRefreshButton } from "./square-controls";

export const dynamic = "force-dynamic";

const TONE_STYLES: Record<string, string> = {
  ok: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-accent text-accent-foreground",
  warn: "bg-warning/15 text-amber-700 dark:text-amber-300",
  idle: "bg-muted text-muted-foreground",
};

/**
 * The callback redirects with a reason CODE, never a sentence (nothing
 * sensitive in URLs). The English lives here, with the screen that shows it.
 */
const SQUARE_FAILURES: Record<string, string> = {
  declined: "Square access was declined, so nothing was connected.",
  expired:
    "That Square sign-in took too long or was already used. Try connecting again.",
  incomplete: "Square's reply was incomplete. Try connecting again.",
  mismatch: "That Square sign-in couldn't be verified. Try connecting again.",
  wrong_tenant:
    "You switched organizations during the Square sign-in. Try again from the right one.",
  not_configured: "Square isn't switched on for this deployment yet.",
  exchange:
    "Square accepted the sign-in but wouldn't hand over access. Try again in a moment.",
  square_read:
    "Connected to Square, but it wouldn't say which business this is. Try again in a moment.",
  already_connected:
    "That Square account is already connected to another of your companies. Each Square account can be connected to one company.",
  save: "Square connected, but Yosher couldn't save the connection. Try again in a moment.",
};

/**
 * **TAKING A CARD — THE FARM'S OWN ACCOUNT, WITH THE PROVIDER IT ALREADY HAS.**
 *
 * Owner-only, and not as a matter of taste: this decides which bank account the
 * business's card takings land in and whose tax ID they are reported under.
 *
 * **SQUARE IS THE PROVIDER ON OFFER; STRIPE CONNECT IS PARKED** (ADR 0017). A
 * company gets a Square card whenever Square is configured. It gets a Stripe
 * card only if a Stripe row already exists for it, or if Square is not
 * configured at all — so nothing that was connected disappears, and nothing new
 * is started on the parked provider.
 *
 * Not to be confused with `/dashboard/billing`, which is the OTHER direction —
 * the platform charging this tenant for its subscription. ADR 0015.
 */
export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; square?: string; reason?: string }>;
}) {
  const ctx = await requireTenantOwner();
  const { status, square: squareStatus, reason } = await searchParams;

  const squareOn = isSquareConfigured();
  const stripeOn = isConnectConfigured();

  if (squareOn || stripeOn) {
    // The books may have opened since a connection was made; join them up
    // before reading (ADR 0015 — adoption is lazy because the table refuses
    // tenant writes and `provisionAccounting` runs in a tenant transaction).
    await adoptUnassignedAccount(ctx.tenant.id);
  }
  /**
   * Each provider's webhook is its primary sync; these direct API reads cover
   * local dev, heal a missed event, and are the reason the return trip from a
   * provider can be believed. `?status=returned` and `?square=connected` mean
   * "they came back" — the state on screen is what the API said just now.
   */
  if (stripeOn) await reconcileConnectedAccounts(ctx.tenant.id);
  if (squareOn) await reconcileSquareAccounts(ctx.tenant.id);

  const companies = await loadPaymentCompanies(
    ctx.tenant.id,
    ctx.tenant.name,
    ctx.role,
  );
  const square = squareOn
    ? await loadSquareConnections(ctx.tenant.id, ctx.role)
    : new Map<string | null, SquareConnection>();

  /**
   * A reader that has been unplugged is offline whatever this app believes, so
   * the status is refreshed from Stripe on load — the same bargain the account
   * reconcile makes, and best effort for the same reason.
   */
  const readers = new Map<string, ReaderView[]>();
  for (const company of companies) {
    if (!company.paymentAccountId) continue;
    await refreshReaders(ctx.tenant.id, company.paymentAccountId);
    readers.set(
      company.paymentAccountId,
      await listReaders(ctx.tenant.id, company.paymentAccountId, ctx.role),
    );
  }
  // Gates the simulated-tap button and nothing else. A real charge is a real
  // charge in either mode.
  const testMode = !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_");

  // ADR 0010's rule: the picker — here, the per-company heading — appears at
  // two. A one-company client never learns the word.
  const realCompanies = companies.filter((c) => c.entityId !== null);
  const namesCompanies = realCompanies.length > 1;

  /**
   * One Square card per company. A tenant with no books has no company and
   * gets one card named after the business; a tenant with books gets one per
   * company, plus — only if it exists — a card for a connection made before the
   * books opened that adoption has not yet joined up. Never a "no company" card
   * a tenant with companies could connect to: the start route refuses that.
   */
  const squareCards: Array<{
    key: string;
    name: string;
    entityId: string | null;
    connection: SquareConnection | null;
  }> = [];
  if (squareOn) {
    if (realCompanies.length === 0) {
      squareCards.push({
        key: "none",
        name: ctx.tenant.name,
        entityId: null,
        connection: square.get(null) ?? null,
      });
    } else {
      for (const c of realCompanies) {
        squareCards.push({
          key: c.entityId as string,
          name: c.name,
          entityId: c.entityId,
          connection: square.get(c.entityId) ?? null,
        });
      }
      const orphan = square.get(null);
      if (orphan) {
        squareCards.push({
          key: "orphan",
          name: ctx.tenant.name,
          entityId: null,
          connection: orphan,
        });
      }
    }
  }

  // Stripe stays visible where it was connected, and is offered fresh only
  // where Square is not available at all.
  const stripeCards = companies.filter(
    (c) => c.stripeAccountId !== null || (stripeOn && !squareOn),
  );

  const squareFailure =
    squareStatus === "failed"
      ? (SQUARE_FAILURES[reason ?? ""] ??
        "Square could not be connected. Try again in a moment.")
      : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Taking payments"
        description="Card payments go straight to your own bank account, in your own name."
        icon={<CreditCard />}
      />

      {squareStatus === "connected" && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-300/50 bg-success/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            Square is connected. What you see below is what Square said just
            now, not what the redirect claimed.
          </span>
        </div>
      )}

      {squareFailure && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-warning/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{squareFailure}</span>
        </div>
      )}

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

      {!squareOn && !stripeOn && (
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

      {squareCards.map((card) => (
        <SquareCard
          key={card.key}
          name={card.name}
          showName={namesCompanies || card.key === "orphan"}
          entityId={card.entityId}
          connection={card.connection}
          dashboardUrl={squareDashboardUrl()}
        />
      ))}

      {stripeCards.map((company) => (
        <StripeCard
          key={company.entityId ?? "unassigned"}
          company={company}
          showName={namesCompanies}
          timezone={ctx.tenant.timezone}
          readers={
            company.paymentAccountId
              ? (readers.get(company.paymentAccountId) ?? [])
              : []
          }
          testMode={testMode}
        />
      ))}

      {squareOn && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Square handles the card, its fee and the payout, in your
            business&rsquo;s name — Yosher never holds your funds and never sees
            a card number. What Yosher holds is a permission to act for your
            Square account, which you can withdraw here or from your Square
            dashboard at any time.
          </p>
        </div>
      )}

      {stripeCards.length > 0 && (
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

function SquareCard({
  name,
  showName,
  entityId,
  connection,
  dashboardUrl,
}: {
  name: string;
  showName: boolean;
  entityId: string | null;
  connection: SquareConnection | null;
  dashboardUrl: string;
}) {
  const view = connection?.view ?? describeSquareAccount(null);
  // A plain GET: the route sets the state cookie and redirects to Square, which
  // is what a browser navigation does naturally and a form action does not.
  const startHref = `/api/payments/square/start?entity=${entityId ?? "none"}`;
  const open = connection !== null && view.state !== "closed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {showName ? `Square · ${name}` : "Square"}
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
            <p className="text-sm font-medium">Before Square will take a card</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {view.outstanding.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden>·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {open && connection.locations.length > 0 && (
          <div>
            <p className="text-sm font-medium">Locations</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {connection.locations.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-foreground">{l.name}</span>
                  <span>· {l.type === "MOBILE" ? "on the move" : "fixed address"}</span>
                  <span>
                    ·{" "}
                    {l.status !== "ACTIVE"
                      ? "inactive"
                      : l.canTakeCards
                        ? "takes cards"
                        : "no card processing"}
                  </span>
                  {l.id === connection.mainLocationId && (
                    <Badge variant="outline" className="text-xs">
                      the till charges here
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {connection?.merchantId && (
          <p className="font-mono text-xs text-muted-foreground">
            {connection.displayName ? `${connection.displayName} · ` : ""}
            {connection.merchantId}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {view.action === "connect" && (
          <Button asChild>
            <a href={startHref}>
              {view.state === "closed" ? "Connect Square again" : "Connect Square"}
            </a>
          </Button>
        )}
        {view.action === "reconnect" && (
          <Button asChild>
            <a href={startHref}>Reconnect Square</a>
          </Button>
        )}
        {open && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open your Square dashboard
            <ExternalLink className="size-3" />
          </a>
        )}
        {open &&
          (view.state === "needs_information" || view.state === "reviewing") && (
            <SquareRefreshButton />
          )}
        {open && <SquareDisconnectButton entityId={entityId} businessName={name} />}
      </CardFooter>
    </Card>
  );
}

function StripeCard({
  company,
  showName,
  timezone,
  readers,
  testMode,
}: {
  company: PaymentCompany;
  showName: boolean;
  timezone: string;
  readers: ReaderView[];
  testMode: boolean;
}) {
  const { view } = company;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {showName ? `Stripe · ${company.name}` : "Stripe"}
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

        {company.paymentAccountId && view.state !== "closed" && (
          <ReaderSection
            entityId={company.entityId}
            readers={readers}
            canRegister
            testMode={testMode}
          />
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
