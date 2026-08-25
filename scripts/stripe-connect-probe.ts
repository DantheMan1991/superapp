import "dotenv/config";
import Stripe from "stripe";

/**
 * Stripe Connect probe — the TENANT charging THEIR customer, not the platform
 * charging the tenant. Same family as the `jmap-*-probe.ts` scripts: it talks
 * to the provider and nothing else, so a question about Stripe's shape can be
 * answered without a signed-in browser, a tenant, or a database.
 *
 *   npx tsx scripts/stripe-connect-probe.ts create        create a v2 account + onboarding link
 *   npx tsx scripts/stripe-connect-probe.ts show <acct_>  what we would store, and the raw shape
 *   npx tsx scripts/stripe-connect-probe.ts link <acct_>  a fresh onboarding link
 *   npx tsx scripts/stripe-connect-probe.ts close <acct_> clean a probe account up
 *
 * **TEST MODE ONLY, and it refuses otherwise.** Every one of these creates or
 * mutates a real Connect account; against a live key that is somebody's actual
 * business. The guard is a string check on the key prefix and it is not
 * negotiable — `--force` does not exist here on purpose.
 *
 * WHY IT EXISTS. Stripe blocked `POST /v1/accounts` for new Connect
 * integrations on 2026-08-25 ("Stripe no longer recommends Accounts v1"), so
 * this integration is built on **Accounts v2**, whose object is shaped nothing
 * like v1's: no `charges_enabled`, no `payouts_enabled`, no `details_submitted`
 * — a capability status, and a list of requirements that each say who is
 * holding them up. This script is how those shapes were read off a real account
 * rather than guessed from types.
 */

const MERCHANT_INCLUDE = [
  "configuration.merchant",
  "identity",
  "requirements",
  "defaults",
] as const;

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run against a non-test key. This script creates and closes real Connect accounts.",
    );
  }
  return new Stripe(key);
}

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

async function create(name: string) {
  const account = await stripe().v2.core.accounts.create({
    display_name: name,
    // REQUIRED before `configuration.merchant` in v2 — v1 defaulted it to the
    // platform's country and v2 refuses to guess. Nothing on `tenants` holds a
    // country (the platform is single-currency and US-shaped), so this is a
    // constant until a client outside the US turns up.
    identity: { country: "US" },
    // Merchant of record = the client. That is the whole point: their KYC,
    // their liability, their bank, their tax form.
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
    dashboard: "full",
    defaults: {
      // Both "stripe" is the Standard shape in v2's vocabulary: Stripe takes
      // its fee from the account directly, and the account — not this platform
      // — carries a negative balance. v1 spelled the first one "account";
      // that value does not exist here.
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
    },
    metadata: { platform: "yosher", probe: "true" },
    include: [...MERCHANT_INCLUDE],
  });
  console.log("created:", account.id);
  await show(account.id);
  await link(account.id);
}

async function show(id: string) {
  const a = await stripe().v2.core.accounts.retrieve(id, {
    include: [...MERCHANT_INCLUDE],
  });
  const card = a.configuration?.merchant?.capabilities?.card_payments;
  console.log("\n--- what the app would store ---");
  console.log(
    JSON.stringify(
      {
        id: a.id,
        idLooksLikeAcct: /^acct_[A-Za-z0-9]+$/.test(a.id),
        displayName: a.display_name,
        closed: a.closed,
        cardPaymentsStatus: card?.status ?? null,
        statusDetails: card?.status_details ?? [],
        country: a.identity?.country ?? null,
        currency: a.defaults?.currency ?? null,
        deadline: a.requirements?.summary?.minimum_deadline ?? null,
        requirements: (a.requirements?.entries ?? []).map((e) => ({
          description: e.description,
          awaitingActionFrom: e.awaiting_action_from,
          deadline: e.minimum_deadline?.status,
          restricts: e.impact?.restricts_capabilities?.map((c) => c.capability),
          errors: e.errors?.map((x) => x.description),
        })),
      },
      null,
      2,
    ),
  );
  console.log("\n--- raw ---");
  console.log(JSON.stringify(a, null, 2).slice(0, 4000));
}

async function link(id: string) {
  const l = await stripe().v2.core.accountLinks.create({
    account: id,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant"],
        collection_options: { fields: "eventually_due" },
        refresh_url: appUrl("/dashboard/settings/payments?status=expired"),
        return_url: appUrl("/dashboard/settings/payments?status=returned"),
      },
    },
  });
  console.log("\nonboarding url (expires " + l.expires_at + "):\n" + l.url);
}

/**
 * **THE QUESTION THAT DECIDES THE SHAPE OF THE READER SLICE:** can a Terminal
 * location and reader be registered on a connected account that has NOT passed
 * KYC? If yes, the hardware half is buildable and provable before anybody fills
 * a form in; if no, the whole slice waits on a human.
 *
 * Terminal is a v1 API even though the account is v2, and everything here acts
 * AS the connected account via `stripeAccount` — that is what makes the reader
 * theirs rather than ours.
 */
async function terminal(id: string) {
  const s = stripe();
  const as = { stripeAccount: id };

  const location = await s.terminal.locations.create(
    {
      display_name: "Probe market stall",
      address: {
        line1: "1 Elm Street",
        city: "Denver",
        state: "CO",
        postal_code: "80202",
        country: "US",
      },
    },
    as,
  );
  console.log("location:", location.id, location.display_name);

  // Stripe's published registration code for a simulated reader. No hardware,
  // and it behaves like the real thing.
  const code = process.env.PROBE_REG_CODE ?? "simulated-wpe";
  const reader = await s.terminal.readers.create(
    { registration_code: code, location: location.id, label: "Probe reader" },
    as,
  );
  console.log(
    "reader:",
    JSON.stringify(
      {
        id: reader.id,
        label: reader.label,
        status: reader.status,
        device_type: reader.device_type,
        action: reader.action,
      },
      null,
      1,
    ),
  );

  /**
   * **HOW FAR DOES A RESTRICTED ACCOUNT ACTUALLY GET?** The assumption was that
   * nothing here would work without KYC. Creating a PaymentIntent turns out to
   * be fine, so the real question is where the wall is — and the answer decides
   * how much of this slice can be proven before anybody fills a form in.
   */
  try {
    const pi = await s.paymentIntents.create(
      {
        amount: 1234,
        currency: "usd",
        payment_method_types: ["card_present"],
        capture_method: "automatic",
      },
      as,
    );
    console.log("payment intent:", pi.id, pi.status);

    const pushed = await s.terminal.readers.processPaymentIntent(
      reader.id,
      { payment_intent: pi.id },
      as,
    );
    console.log("pushed to reader:", JSON.stringify(pushed.action, null, 1));

    // Simulate the customer tapping a card.
    const tapped = await s.testHelpers.terminal.readers.presentPaymentMethod(
      reader.id,
      {},
      as,
    );
    console.log("after tap:", JSON.stringify(tapped.action, null, 1));

    const after = await s.paymentIntents.retrieve(pi.id, {}, as);
    console.log("payment intent now:", after.id, after.status);
  } catch (e) {
    console.log("STOPPED HERE:", (e as Error).message);
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "terminal":
      if (!arg) throw new Error("usage: terminal <acct_...>");
      return terminal(arg);
    case "create":
      return create(arg ?? "Yosher probe farm");
    case "show":
      if (!arg) throw new Error("usage: show <acct_...>");
      return show(arg);
    case "link":
      if (!arg) throw new Error("usage: link <acct_...>");
      return link(arg);
    case "close": {
      if (!arg) throw new Error("usage: close <acct_...>");
      const a = await stripe().v2.core.accounts.close(arg, {
        applied_configurations: ["merchant"],
      });
      console.log("closed:", a.id, a.closed);
      return;
    }
    default:
      console.error(
        "usage: stripe-connect-probe.ts create|show|link|close [acct_...]",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
