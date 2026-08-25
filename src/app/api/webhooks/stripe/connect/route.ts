import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { markClosed, refreshConnectedAccount } from "@/lib/payments/connect";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * **CONNECT EVENTS — THE TENANT'S OWN STRIPE ACCOUNT.**
 *
 * A SECOND route, not a branch inside `/api/webhooks/stripe`, and the split is
 * the point: that endpoint is the PLATFORM charging the TENANT (subscriptions,
 * hour blocks) over Stripe's v1 API and v1 webhooks; this one is the TENANT
 * charging THEIR customer, over **Accounts v2 and v2 event notifications**. Two
 * APIs, two payload shapes, two signing secrets. They could not share a route
 * even if somebody wanted them to.
 *
 * **A V2 EVENT CARRIES NO OBJECT — ONLY A REFERENCE**, so this handler fetches
 * the account from the API before writing anything. That is not a chore, it is
 * the best property of the whole design: the event is a NUDGE, and the trusted
 * data always comes from a server→Stripe read. S7 holds by construction here
 * rather than by discipline, and a forged payload could at worst make us
 * re-read an account we already own.
 *
 * **THE HANDLER KEYS OFF THE RELATED OBJECT, NOT THE EVENT NAME.** Stripe adds
 * v2 event types (`…capability_status_updated`, `…requirements.updated`, and
 * more since) faster than any hard-coded list stays current, and every one of
 * them means the same thing to us: go and look at the account. Matching on
 * `related_object.type` cannot go stale.
 *
 * **MISSING THIS ENDPOINT FAILS QUIETLY.** The payments page reconciles from
 * the Stripe API on load, so the state is right whenever somebody looks at it
 * and stale when nobody does. Acceptable only while nothing acts on it without
 * a person present; the moment the till reads the capability status, this
 * endpoint stops being optional. Locally:
 *
 *   stripe listen --forward-connect-to \
 *     localhost:3000/api/webhooks/stripe/connect
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_CONNECT_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const payload = await req.text();
  let notification: ReturnType<
    ReturnType<typeof getStripe>["parseEventNotification"]
  >;
  try {
    // The v2 equivalent of `constructEvent`: verifies the signature and returns
    // a thin notification. Unverified payloads never reach a side effect.
    notification = getStripe().parseEventNotification(
      payload,
      signature,
      secret,
    );
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const related = "related_object" in notification
    ? notification.related_object
    : null;

  // Not about a connected account — acknowledge and do nothing. A 200 here is
  // correct: retrying would not make it about one.
  if (!related || related.type !== "v2.core.account") {
    return NextResponse.json({ received: true });
  }

  const stripeAccountId = related.id;

  /**
   * Closure is the one transition worth handling on its own, because the
   * account may no longer be readable afterwards — so believing the event is
   * the only option, and it is safe: a close event can only make us stop
   * trusting an account, never start.
   */
  if (notification.type.includes("closed")) {
    const tenantId = await markClosed(stripeAccountId);
    if (tenantId) {
      await logAudit({
        action: "payments.account_closed",
        tenantId,
        actorLabel: "stripe-connect-webhook",
        targetType: "payment_account",
        targetId: stripeAccountId,
      });
    }
    return NextResponse.json({ received: true });
  }

  try {
    const result = await refreshConnectedAccount(stripeAccountId);
    /**
     * These events fire on every keystroke's worth of progress through the
     * hosted form, so auditing all of them would bury the log. Only the
     * transitions that matter are recorded: the moment a company can take
     * money, or stops being able to.
     */
    if (result && (result.state === "active" || result.state === "restricted")) {
      await logAudit({
        action:
          result.state === "active"
            ? "payments.account_ready"
            : "payments.account_restricted",
        tenantId: result.tenantId,
        actorLabel: "stripe-connect-webhook",
        targetType: "payment_account",
        targetId: stripeAccountId,
      });
    }
  } catch (err) {
    /**
     * 500 so Stripe retries. The page's reconcile would heal this eventually,
     * but only when somebody looks — and a silent 200 on a failed read is the
     * shape that loses a row for good, which the Clerk webhook already learned.
     */
    console.error("connect webhook refresh failed", stripeAccountId, err);
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
