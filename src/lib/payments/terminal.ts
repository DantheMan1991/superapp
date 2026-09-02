import "server-only";
import type Stripe from "stripe";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { getStripe } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";

/**
 * **THE CARD READER AT THE STALL.**
 *
 * Everything here acts AS the connected account, via `{ stripeAccount }`. That
 * one option is what makes the reader the farm's device, the charge the farm's
 * charge, and the money the farm's money — and it is the difference between
 * this file and `src/lib/billing-sync.ts`, which acts as the platform.
 *
 * **TERMINAL IS A v1 API EVEN THOUGH THE ACCOUNT IS v2**, so this file mixes
 * `stripe.terminal.*` (v1) with accounts created through `stripe.v2.core.*`.
 * That is not a mistake to tidy up: Stripe has not moved Terminal to v2.
 *
 * **NO LOCATION TABLE.** A Terminal location is an address that groups readers
 * and Stripe already stores it, so `ensureLocation` asks Stripe rather than
 * keeping a second copy to fall out of step.
 *
 * See docs/decisions/0015-a-connected-account-belongs-to-a-company.md.
 */

export class TerminalError extends Error {
  constructor(
    readonly code:
      | "NOT_CONFIGURED"
      | "NO_ACCOUNT"
      | "ACCOUNT_NOT_READY"
      | "NOT_FOUND"
      | "BAD_CODE"
      | "STRIPE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "TerminalError";
  }
}

export type ReaderView = {
  id: string;
  label: string;
  stripeReaderId: string;
  deviceType: string | null;
  /** `online` | `offline` | null before the first sync. */
  status: string | null;
  /** True for a `simulated_*` device — a developer fixture, not a real till. */
  simulated: boolean;
  archivedAt: Date | null;
};

/**
 * The business's own address, needed once to create the Terminal location.
 * **Stripe requires it and the app holds no address anywhere**, so the first
 * registration asks for it. Not stored here — Stripe keeps it, and a second
 * copy would be a second thing to keep true.
 */
export type LocationAddress = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
};

function isSimulated(deviceType: string | null | undefined): boolean {
  return !!deviceType?.startsWith("simulated");
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listReaders(
  tenantId: string,
  paymentAccountId: string,
  role: "owner" | "staff" | "expert",
): Promise<ReaderView[]> {
  const rows = await withTenant(
    tenantId,
    (tx) =>
      tx.query.paymentReaders.findMany({
        where: and(
          eq(schema.paymentReaders.tenantId, tenantId),
          eq(schema.paymentReaders.paymentAccountId, paymentAccountId),
          isNull(schema.paymentReaders.archivedAt),
        ),
        orderBy: [asc(schema.paymentReaders.createdAt)],
      }),
    { role },
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    stripeReaderId: r.stripeReaderId,
    deviceType: r.deviceType,
    status: r.status,
    simulated: isSimulated(r.deviceType),
    archivedAt: r.archivedAt,
  }));
}

/**
 * Resolve the connected account a reader hangs off, proving it belongs to this
 * tenant on the way. **The id from the client is a claim** — the `withTenant`
 * scope is what makes it a fact (security.md §4).
 */
async function accountForCompany(
  tenantId: string,
  entityId: string | null,
  role: "owner" | "staff" | "expert",
) {
  const row = await withTenant(
    tenantId,
    (tx) =>
      tx.query.paymentAccounts.findFirst({
        where: and(
          eq(schema.paymentAccounts.tenantId, tenantId),
          // THIS FILE IS STRIPE TERMINAL. A company's Square row is another
          // provider's business and must never be handed to Stripe as an account.
          eq(schema.paymentAccounts.provider, "stripe"),
          entityId
            ? eq(schema.paymentAccounts.entityId, entityId)
            : isNull(schema.paymentAccounts.entityId),
          isNull(schema.paymentAccounts.closedAt),
        ),
      }),
    { role },
  );
  if (!row) {
    throw new TerminalError(
      "NO_ACCOUNT",
      "Set up card payments for this company before adding a reader.",
    );
  }
  return { ...row, stripeAccountId: requireStripeAccountId(row) };
}

/**
 * `stripe_account_id` is nullable since Square arrived, and the CHECK
 * constraint guarantees it is set on every `stripe` row — so this can only
 * fail on a row this file should never have been given. Loud rather than a
 * `stripeAccount: null` sent to Stripe, which would act on the PLATFORM account.
 */
function requireStripeAccountId(row: {
  provider: string;
  stripeAccountId: string | null;
}): string {
  if (row.provider !== "stripe" || !row.stripeAccountId) {
    throw new TerminalError(
      "NO_ACCOUNT",
      "This company takes cards through Square, not Stripe.",
    );
  }
  return row.stripeAccountId;
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Find the connected account's Terminal location, or create one.
 *
 * **STRIPE IS THE SOURCE OF TRUTH FOR LOCATIONS**, so this asks rather than
 * keeping a column. A farm with two market addresses is already representable
 * — `payment_readers.stripe_location_id` is per reader — and slice 1 simply
 * always uses the first.
 */
async function ensureLocation(
  stripeAccountId: string,
  displayName: string,
  address: LocationAddress | null,
): Promise<string> {
  const stripe = getStripe();
  const as = { stripeAccount: stripeAccountId };

  const existing = await stripe.terminal.locations.list({ limit: 1 }, as);
  if (existing.data[0]) return existing.data[0].id;

  if (!address) {
    throw new TerminalError(
      "BAD_CODE",
      "Stripe needs the address this reader will be used at before it can be registered.",
    );
  }

  const location = await stripe.terminal.locations.create(
    {
      display_name: displayName,
      address: {
        line1: address.line1,
        city: address.city,
        state: address.state,
        postal_code: address.postalCode,
        // The app is single-currency and US-shaped; same constant, same reason
        // as `DEFAULT_COUNTRY` in connect.ts, and the same open item.
        country: "US",
      },
    },
    as,
  );
  return location.id;
}

/**
 * Register a physical (or simulated) reader against one company's account.
 *
 * The registration code is printed on the device — or is `simulated-wpe` for
 * Stripe's simulated WisePOS E, which behaves like the real thing and needs no
 * hardware.
 *
 * `withSystem` justified (S2): `payment_readers` refuses tenant writes by
 * policy for the same reason `payment_accounts` does, authorization happened in
 * the caller, and the row is only written after Stripe has already accepted the
 * device. A row Stripe has never heard of is a device the till would try to
 * push a payment to.
 */
export async function registerReader(input: {
  tenantId: string;
  entityId: string | null;
  companyName: string;
  label: string;
  registrationCode: string;
  address: LocationAddress | null;
  role: "owner" | "staff" | "expert";
  actorClerkUserId: string;
}): Promise<ReaderView> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new TerminalError(
      "NOT_CONFIGURED",
      "Card payments are not set up on this deployment yet.",
    );
  }
  const account = await accountForCompany(
    input.tenantId,
    input.entityId,
    input.role,
  );

  const locationId = await ensureLocation(
    account.stripeAccountId,
    input.companyName,
    input.address,
  );

  let reader: Stripe.Terminal.Reader;
  try {
    reader = await getStripe().terminal.readers.create(
      {
        registration_code: input.registrationCode,
        location: locationId,
        label: input.label,
      },
      { stripeAccount: account.stripeAccountId },
    );
  } catch (err) {
    console.error("terminal reader register failed", err);
    if (err instanceof Error && /registration code/i.test(err.message)) {
      throw new TerminalError(
        "BAD_CODE",
        "That pairing code was not accepted. Check the code on the reader's screen — they expire after a few minutes.",
      );
    }
    throw new TerminalError(
      "STRIPE_FAILED",
      "Stripe could not register that reader. Try again in a moment.",
    );
  }

  const row = await withSystem(async (tx) => {
    const rows = await tx
      .insert(schema.paymentReaders)
      .values({
        tenantId: input.tenantId,
        paymentAccountId: account.id,
        stripeReaderId: reader.id,
        stripeLocationId: locationId,
        label: input.label,
        deviceType: reader.device_type ?? null,
        status: reader.status ?? null,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        // Re-registering a device we already know is an update, not a second
        // row. Stripe hands back the same `tmr_` id.
        target: [
          schema.paymentReaders.tenantId,
          schema.paymentReaders.stripeReaderId,
        ],
        set: {
          label: input.label,
          stripeLocationId: locationId,
          deviceType: reader.device_type ?? null,
          status: reader.status ?? null,
          archivedAt: null,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0];
  });

  await logAudit({
    action: "payments.reader_registered",
    tenantId: input.tenantId,
    actorClerkUserId: input.actorClerkUserId,
    targetType: "payment_reader",
    targetId: reader.id,
    // Identifiers only (S9). The company is the fact worth having: it says
    // whose bank this device's takings will land in.
    meta: { entityId: input.entityId ?? null, deviceType: reader.device_type },
  });

  return {
    id: row.id,
    label: row.label,
    stripeReaderId: row.stripeReaderId,
    deviceType: row.deviceType,
    status: row.status,
    simulated: isSimulated(row.deviceType),
    archivedAt: row.archivedAt,
  };
}

/** Rename on Stripe first, then here — the device's screen shows the label. */
export async function renameReader(input: {
  tenantId: string;
  readerId: string;
  label: string;
  role: "owner" | "staff" | "expert";
}): Promise<void> {
  const { row, account } = await loadReader(
    input.tenantId,
    input.readerId,
    input.role,
  );
  await getStripe().terminal.readers.update(
    row.stripeReaderId,
    { label: input.label },
    { stripeAccount: account.stripeAccountId },
  );
  await withSystem((tx) =>
    tx
      .update(schema.paymentReaders)
      .set({ label: input.label, updatedAt: new Date() })
      .where(eq(schema.paymentReaders.id, row.id)),
  );
}

/**
 * Retire a reader. **Deleted on Stripe, archived here** — a device that took
 * money last season is still the answer to "what collected that payment", so
 * the row survives even though the registration does not.
 */
export async function archiveReader(input: {
  tenantId: string;
  readerId: string;
  role: "owner" | "staff" | "expert";
  actorClerkUserId: string;
}): Promise<void> {
  const { row, account } = await loadReader(
    input.tenantId,
    input.readerId,
    input.role,
  );
  try {
    // `del(id, params, options)` — the account goes in the THIRD argument.
    // Passing it second sends `stripeAccount` as a query parameter, Stripe
    // rejects the call, and the catch below would have swallowed it: the
    // reader would stay registered while the app said it was retired.
    await getStripe().terminal.readers.del(
      row.stripeReaderId,
      {},
      { stripeAccount: account.stripeAccountId },
    );
  } catch (err) {
    // Already gone on Stripe's side is the outcome we wanted anyway.
    console.error("terminal reader delete failed", row.stripeReaderId, err);
  }
  await withSystem((tx) =>
    tx
      .update(schema.paymentReaders)
      .set({ archivedAt: new Date(), status: null, updatedAt: new Date() })
      .where(eq(schema.paymentReaders.id, row.id)),
  );
  await logAudit({
    action: "payments.reader_archived",
    tenantId: input.tenantId,
    actorClerkUserId: input.actorClerkUserId,
    targetType: "payment_reader",
    targetId: row.stripeReaderId,
  });
}

async function loadReader(
  tenantId: string,
  readerId: string,
  role: "owner" | "staff" | "expert",
) {
  const found = await withTenant(
    tenantId,
    async (tx) => {
      const row = await tx.query.paymentReaders.findFirst({
        where: and(
          eq(schema.paymentReaders.tenantId, tenantId),
          eq(schema.paymentReaders.id, readerId),
        ),
      });
      if (!row) return null;
      const account = await tx.query.paymentAccounts.findFirst({
        where: eq(schema.paymentAccounts.id, row.paymentAccountId),
      });
      return account ? { row, account } : null;
    },
    { role },
  );
  if (!found) {
    throw new TerminalError("NOT_FOUND", "That reader no longer exists.");
  }
  return {
    row: found.row,
    account: {
      ...found.account,
      stripeAccountId: requireStripeAccountId(found.account),
    },
  };
}

/**
 * Ask Stripe what each of a company's readers is actually doing.
 *
 * **A READER THE APP THINKS IS ONLINE MAY BE IN A VAN**, so `status` is only
 * ever as good as its last sync. Best effort: the page renders from local state
 * when Stripe is unreachable, exactly as the account reconcile does.
 */
export async function refreshReaders(tenantId: string, paymentAccountId: string) {
  if (!process.env.STRIPE_SECRET_KEY) return;
  const rows = await withSystem((tx) =>
    tx.query.paymentReaders.findMany({
      where: and(
        eq(schema.paymentReaders.tenantId, tenantId),
        eq(schema.paymentReaders.paymentAccountId, paymentAccountId),
        isNull(schema.paymentReaders.archivedAt),
      ),
    }),
  );
  if (rows.length === 0) return;

  const account = await withSystem((tx) =>
    tx.query.paymentAccounts.findFirst({
      where: eq(schema.paymentAccounts.id, paymentAccountId),
      columns: { stripeAccountId: true, provider: true },
    }),
  );
  // A Square account has no Stripe readers to refresh; the FK means the rows
  // above can only exist on a Stripe account, so this is belt and braces.
  if (!account?.stripeAccountId || account.provider !== "stripe") return;
  const stripeAccountId = account.stripeAccountId;

  await Promise.all(
    rows.map(async (row) => {
      try {
        const reader = await getStripe().terminal.readers.retrieve(
          row.stripeReaderId,
          {},
          { stripeAccount: stripeAccountId },
        );
        // Stripe returns a DeletedReader for a device removed on their side.
        // Treat it as offline rather than crashing: the row stays, because a
        // reader that took money last season is still the answer to "what
        // collected that payment".
        const live = "deleted" in reader ? null : reader;
        await withSystem((tx) =>
          tx
            .update(schema.paymentReaders)
            .set({
              status: live?.status ?? null,
              deviceType: live?.device_type ?? row.deviceType,
              label: live?.label ?? row.label,
              syncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentReaders.id, row.id)),
        );
      } catch (err) {
        console.error("reader refresh failed", row.stripeReaderId, err);
      }
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Taking the money                                                           */
/* -------------------------------------------------------------------------- */

export type CollectResult = {
  stripePaymentIntentId: string;
  /** Stripe's PaymentIntent status at the moment we pushed it. */
  status: string;
  /** What the reader is doing: `in_progress` while the customer taps. */
  readerAction: string | null;
};

/**
 * **PUSH A CHARGE TO THE READER AND RETURN. DO NOT WAIT.**
 *
 * A customer takes as long as a customer takes — finding the card, tapping,
 * entering a PIN, trying a second card. Blocking the request on that would tie
 * up a server handler for a minute and give the stall a spinner it cannot
 * cancel. The till pushes, then polls `readPaymentStatus`.
 *
 * **THE IDEMPOTENCY KEY IS THE WHOLE SAFETY STORY**, and it is the same lesson
 * `retail_sales.client_ref` exists for: a till with bad signal retries, and a
 * retry whose request arrived but whose reply did not would charge the customer
 * twice. Passing the till's own `clientRef` to Stripe makes the second attempt
 * return the FIRST PaymentIntent rather than creating another.
 */
export async function collectPayment(input: {
  tenantId: string;
  readerId: string;
  amountCents: number;
  description?: string;
  /**
   * Minted by the till BEFORE it touches the network, exactly as
   * `retail_sales.client_ref` is. Without it a retry takes the money twice.
   */
  clientRef: string;
  role: "owner" | "staff" | "expert";
}): Promise<CollectResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new TerminalError("BAD_CODE", "A card payment needs a positive amount.");
  }
  const { row, account } = await loadReader(
    input.tenantId,
    input.readerId,
    input.role,
  );

  /**
   * **THE GUARD THAT KEEPS A DECLINE OFF THE STALL.** Stripe refuses a charge
   * on an account whose `card_payments` capability is not active — but it
   * refuses at the worst possible moment, with a customer holding a card. So
   * the app refuses first, and says what Stripe is waiting for.
   *
   * Worth knowing when testing: **Stripe TEST MODE does not enforce this**, so
   * a restricted account will happily take a simulated tap. This guard is
   * therefore the only thing standing between a live farm and a mid-market
   * decline, and it cannot be verified by test-mode behaviour alone.
   */
  if (account.cardPaymentsStatus !== "active") {
    throw new TerminalError(
      "ACCOUNT_NOT_READY",
      "This company cannot take card payments yet — finish the Stripe setup on the payments page first.",
    );
  }
  if (row.archivedAt) {
    throw new TerminalError("NOT_FOUND", "That reader has been retired.");
  }

  const as = { stripeAccount: account.stripeAccountId };
  const stripe = getStripe();

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: account.defaultCurrency ?? "usd",
        payment_method_types: ["card_present"],
        // Automatic: a market stall has no reason to authorise now and capture
        // later, and an uncaptured authorisation expires into a refund nobody
        // is watching for.
        capture_method: "automatic",
        description: input.description,
        metadata: { tenantId: input.tenantId, clientRef: input.clientRef },
      },
      { ...as, idempotencyKey: `pi:${input.tenantId}:${input.clientRef}` },
    );
  } catch (err) {
    console.error("payment intent create failed", err);
    throw new TerminalError(
      "STRIPE_FAILED",
      "Stripe could not start that payment. Try again.",
    );
  }

  let reader: Stripe.Terminal.Reader;
  try {
    reader = await stripe.terminal.readers.processPaymentIntent(
      row.stripeReaderId,
      { payment_intent: intent.id },
      // Idempotent on the same key too: pushing the same intent to the same
      // reader twice should be one prompt, not two.
      { ...as, idempotencyKey: `push:${input.tenantId}:${input.clientRef}` },
    );
  } catch (err) {
    console.error("reader process failed", err);
    throw new TerminalError(
      "STRIPE_FAILED",
      "The reader did not accept that payment. Check it is switched on and connected.",
    );
  }

  return {
    stripePaymentIntentId: intent.id,
    status: intent.status,
    readerAction: reader.action?.status ?? null,
  };
}

/**
 * What happened to a charge. Polled by the till after `collectPayment`.
 *
 * **READ FROM STRIPE, NOT FROM ANYTHING WE STORED.** Whether a customer's card
 * was accepted is the definition of a fact only Stripe holds (S7), and it is
 * the fact somebody hands over goods on the strength of.
 */
export async function readPaymentStatus(input: {
  tenantId: string;
  readerId: string;
  stripePaymentIntentId: string;
  role: "owner" | "staff" | "expert";
}): Promise<{ status: string; failureMessage: string | null }> {
  const { row, account } = await loadReader(
    input.tenantId,
    input.readerId,
    input.role,
  );
  const as = { stripeAccount: account.stripeAccountId };
  const intent = await getStripe().paymentIntents.retrieve(
    input.stripePaymentIntentId,
    {},
    as,
  );
  // A decline surfaces on the READER's action, not on the intent, so both are
  // read: the intent says what state the money is in, the reader says why.
  let failure: string | null = intent.last_payment_error?.message ?? null;
  if (!failure) {
    try {
      const reader = await getStripe().terminal.readers.retrieve(
        row.stripeReaderId,
        {},
        as,
      );
      failure =
        "deleted" in reader ? null : (reader.action?.failure_message ?? null);
    } catch {
      // The intent's own status is enough to answer the question.
    }
  }
  return { status: intent.status, failureMessage: failure };
}

/** Stop a prompt that is still on the reader's screen. */
export async function cancelCollection(input: {
  tenantId: string;
  readerId: string;
  role: "owner" | "staff" | "expert";
}): Promise<void> {
  const { row, account } = await loadReader(
    input.tenantId,
    input.readerId,
    input.role,
  );
  try {
    await getStripe().terminal.readers.cancelAction(
      row.stripeReaderId,
      {},
      { stripeAccount: account.stripeAccountId },
    );
  } catch (err) {
    // Nothing to cancel is the outcome we wanted.
    console.error("reader cancel failed", row.stripeReaderId, err);
  }
}

/**
 * Simulate a customer tapping a card. **Simulated readers only** — Stripe's
 * test helpers refuse a real device, and this refuses one too rather than
 * relying on that.
 *
 * It exists because a reader slice with no way to complete a payment can only
 * ever be half-driven, and half-driven is what shipped six defects in retail
 * slice 1.
 */
export async function simulateTap(input: {
  tenantId: string;
  readerId: string;
  role: "owner" | "staff" | "expert";
}): Promise<void> {
  const { row, account } = await loadReader(
    input.tenantId,
    input.readerId,
    input.role,
  );
  if (!isSimulated(row.deviceType)) {
    throw new TerminalError(
      "BAD_CODE",
      "That is a real reader — present a card to it instead.",
    );
  }
  await getStripe().testHelpers.terminal.readers.presentPaymentMethod(
    row.stripeReaderId,
    {},
    { stripeAccount: account.stripeAccountId },
  );
}
