import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { toStatusDetailList, type PaymentAccountView } from "../status";
import {
  fetchSquareLocations,
  fetchSquareMerchant,
  type SquareLocation,
  type SquareMerchant,
} from "./api";
import {
  DASHBOARDS,
  SQUARE_NOT_CONFIGURED,
  squareConfig,
  squareEnvironment,
  type SquareConfig,
} from "./config";
import {
  needsSquareRefresh,
  refreshSquareToken,
  revokeSquareToken,
  SQUARE_SCOPES,
  type SquareTokenSet,
} from "./oauth";
import {
  describeSquareAccount,
  projectSquareAccount,
  TOKEN_REJECTED_CODE,
  toSquareLocationList,
  type SquareLocationFact,
} from "./status";

/**
 * **SQUARE — THE TENANT CHARGING THEIR CUSTOMER, THROUGH THEIR OWN ACCOUNT.**
 *
 * The Square half of what `connect.ts` is for Stripe, shaped after it on
 * purpose: reads under `withTenant`, every write under `withSystem` because
 * `payment_accounts` refuses tenant writes by policy and `payment_credentials`
 * refuses tenant READS too. Each `withSystem` below carries its own reason (S2).
 *
 * **THIS IS THE ONLY FILE THAT DECRYPTS A SQUARE TOKEN**, in exactly one
 * function (`accessTokenFor`). Everything above it — the page, the routes, the
 * till one day — asks this file to act and never sees a credential, which keeps
 * the decrypt auditable to one place rather than spread across every caller.
 *
 * **THE PROVIDER FILTER IS NOT DECORATION.** `payment_accounts` holds Stripe
 * rows too. Every query here says `provider = 'square'`; a row this file writes
 * has `square_merchant_id` set and `stripe_account_id` null, and the CHECK
 * constraints refuse anything else.
 *
 * See docs/decisions/0017-the-square-account-the-farm-already-has.md.
 */

export type SquareConnection = {
  entityId: string | null;
  paymentAccountId: string;
  /** Square's merchant id — an identifier, shown so two companies' accounts can be told apart. */
  merchantId: string | null;
  displayName: string | null;
  mainLocationId: string | null;
  locations: SquareLocationFact[];
  view: PaymentAccountView;
  syncedAt: Date | null;
};

export class SquareError extends Error {
  constructor(
    readonly code:
      | "NOT_CONFIGURED"
      | "NOT_CONNECTED"
      | "ALREADY_CONNECTED"
      | "SQUARE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "SquareError";
  }
}

/** Where "Open your Square dashboard" points — the sandbox has its own. */
export function squareDashboardUrl(): string {
  return DASHBOARDS[squareEnvironment()];
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every Square connection the tenant has, keyed by company (`null` for the
 * books-less tenant's one pseudo-company). Read as the member, so RLS is what
 * scopes it; `payment_credentials` is never touched here.
 */
export async function loadSquareConnections(
  tenantId: string,
  role: "owner" | "staff" | "expert",
): Promise<Map<string | null, SquareConnection>> {
  const rows = await withTenant(
    tenantId,
    (tx) =>
      tx.query.paymentAccounts.findMany({
        where: and(
          eq(schema.paymentAccounts.tenantId, tenantId),
          eq(schema.paymentAccounts.provider, "square"),
        ),
      }),
    { role },
  );

  const map = new Map<string | null, SquareConnection>();
  for (const row of rows) {
    const locations = toSquareLocationList(row.squareLocations);
    map.set(row.entityId ?? null, {
      entityId: row.entityId ?? null,
      paymentAccountId: row.id,
      merchantId: row.squareMerchantId,
      displayName: row.displayName,
      mainLocationId: row.squareMainLocationId,
      locations,
      syncedAt: row.syncedAt,
      view: describeSquareAccount({
        cardPaymentsStatus: row.cardPaymentsStatus,
        statusDetails: toStatusDetailList(row.statusDetails),
        locations,
        closedAt: row.closedAt,
      }),
    });
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Trusted writes — Square said so, or it did not happen                      */
/* -------------------------------------------------------------------------- */

/**
 * Record a connection the OAuth callback has just completed.
 *
 * Reached only from the callback, which has already: consumed the state
 * cookie, matched the state, confirmed the signed-in owner is the tenant that
 * started the flow, exchanged the code with Square using the application
 * secret, and read the merchant back with the new token. That chain is what
 * makes this `withSystem` trusted sync code in the S2 sense.
 *
 * **RECONNECTING REPLACES, NEVER DUPLICATES.** One row per company per provider
 * (unique index), so a company that disconnected last year and connects again
 * gets its old row back with `closed_at` cleared and a fresh token — its
 * history, not a second card beside the first.
 */
export async function connectSquareAccount(input: {
  tenantId: string;
  entityId: string | null;
  tokens: SquareTokenSet;
  merchant: SquareMerchant;
  locations: SquareLocation[];
  actorClerkUserId: string;
}): Promise<{ paymentAccountId: string; created: boolean }> {
  const projected = projectSquareAccount(input.merchant, input.locations);
  const now = new Date();

  const result = await withSystem(async (tx) => {
    /**
     * The same Square account on two of this tenant's companies would put one
     * bank account's takings into two sets of books. The unique index refuses
     * it; this check turns the refusal into a sentence a person can act on.
     */
    const clash = await tx.query.paymentAccounts.findFirst({
      where: and(
        eq(schema.paymentAccounts.tenantId, input.tenantId),
        eq(schema.paymentAccounts.provider, "square"),
        eq(schema.paymentAccounts.squareMerchantId, input.merchant.id),
      ),
      columns: { id: true, entityId: true },
    });
    if (clash && (clash.entityId ?? null) !== (input.entityId ?? null)) {
      throw new SquareError(
        "ALREADY_CONNECTED",
        "That Square account is already connected to another of your companies.",
      );
    }

    const existing = await tx.query.paymentAccounts.findFirst({
      where: and(
        eq(schema.paymentAccounts.tenantId, input.tenantId),
        eq(schema.paymentAccounts.provider, "square"),
        input.entityId
          ? eq(schema.paymentAccounts.entityId, input.entityId)
          : isNull(schema.paymentAccounts.entityId),
      ),
      columns: { id: true },
    });

    const values = {
      squareMerchantId: input.merchant.id,
      squareMainLocationId: projected.squareMainLocationId,
      squareLocations: projected.squareLocations,
      cardPaymentsStatus: projected.cardPaymentsStatus,
      statusDetails: projected.statusDetails,
      displayName: projected.displayName,
      country: projected.country,
      defaultCurrency: projected.defaultCurrency,
      closedAt: null,
      syncedAt: now,
      updatedAt: now,
    };

    let paymentAccountId: string;
    let created: boolean;
    if (existing) {
      await tx
        .update(schema.paymentAccounts)
        .set(values)
        .where(eq(schema.paymentAccounts.id, existing.id));
      paymentAccountId = existing.id;
      created = false;
    } else {
      const [row] = await tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: input.tenantId,
          entityId: input.entityId,
          provider: "square",
          stripeAccountId: null,
          requirements: [],
          ...values,
        })
        .returning({ id: schema.paymentAccounts.id });
      paymentAccountId = row.id;
      created = true;
    }

    /**
     * Square's consent is all-or-nothing — the seller accepts the whole list or
     * declines — so the scopes requested are the scopes granted.
     */
    const credential = {
      accessTokenEnc: encryptSecret(input.tokens.accessToken),
      refreshTokenEnc: input.tokens.refreshToken
        ? encryptSecret(input.tokens.refreshToken)
        : "",
      accessTokenExpiresAt: input.tokens.expiresAt,
      scopes: [...SQUARE_SCOPES],
      obtainedAt: now,
      revokedAt: null,
      updatedAt: now,
    };
    await tx
      .insert(schema.paymentCredentials)
      .values({
        tenantId: input.tenantId,
        paymentAccountId,
        ...credential,
      })
      .onConflictDoUpdate({
        target: [
          schema.paymentCredentials.tenantId,
          schema.paymentCredentials.paymentAccountId,
        ],
        set: credential,
      });

    return { paymentAccountId, created };
  });

  await logAudit({
    action: "payments.square_connected",
    tenantId: input.tenantId,
    actorClerkUserId: input.actorClerkUserId,
    targetType: "payment_account",
    targetId: result.paymentAccountId,
    // Identifiers only (S9): which company, which Square merchant, and whether
    // this was a first connection or a reconnect. Never a token.
    meta: {
      entityId: input.entityId ?? null,
      merchantId: input.merchant.id,
      created: result.created,
    },
  });

  return result;
}

type TokenAccess =
  | { ok: true; accessToken: string; merchantId: string }
  | { ok: false; message: string; needsReauth: boolean };

/**
 * **THE ONE PLACE A SQUARE TOKEN IS DECRYPTED.** Refreshes it first when it is
 * inside its last week — before the request rather than after a 401, because a
 * 401 halfway through anything has already cost the round trip and leaves the
 * caller wondering what was applied.
 *
 * `withSystem` justified: `payment_credentials` has no member policy at all, so
 * there is no other way to read it, and the id arrives from a row the caller
 * already resolved — never from client input.
 */
async function accessTokenFor(
  config: SquareConfig,
  paymentAccountId: string,
): Promise<TokenAccess> {
  const found = await withSystem(async (tx) => {
    const account = await tx.query.paymentAccounts.findFirst({
      where: eq(schema.paymentAccounts.id, paymentAccountId),
      columns: {
        id: true,
        provider: true,
        squareMerchantId: true,
        closedAt: true,
      },
    });
    if (
      !account ||
      account.provider !== "square" ||
      !account.squareMerchantId ||
      account.closedAt
    ) {
      return null;
    }
    const credential = await tx.query.paymentCredentials.findFirst({
      where: and(
        eq(schema.paymentCredentials.paymentAccountId, account.id),
        isNull(schema.paymentCredentials.revokedAt),
      ),
    });
    return credential
      ? { merchantId: account.squareMerchantId, credential }
      : null;
  });
  if (!found) {
    return {
      ok: false,
      needsReauth: true,
      message: "Square isn't connected for this company.",
    };
  }

  const read = (ciphertext: string): string | null => {
    if (!ciphertext) return null;
    try {
      return decryptSecret(ciphertext) || null;
    } catch {
      // A rotated key or a damaged row. Either way the connection is finished
      // and the owner has to connect again.
      return null;
    }
  };

  let accessToken = read(found.credential.accessTokenEnc);
  if (!accessToken) {
    return {
      ok: false,
      needsReauth: true,
      message: "The stored Square access could not be read. Connect Square again.",
    };
  }

  if (needsSquareRefresh(found.credential.accessTokenExpiresAt)) {
    const refreshToken = read(found.credential.refreshTokenEnc);
    if (!refreshToken) {
      return {
        ok: false,
        needsReauth: true,
        message: "Square's access has expired and cannot be renewed. Connect Square again.",
      };
    }
    const refreshed = await refreshSquareToken(config, refreshToken);
    if (!refreshed.ok) {
      return {
        ok: false,
        needsReauth: refreshed.needsReauth ?? false,
        message: refreshed.message,
      };
    }
    accessToken = refreshed.data.accessToken;
    // withSystem: writes a freshly minted token, which members cannot do. The
    // credential row was loaded above from an id the caller resolved.
    await withSystem((tx) =>
      tx
        .update(schema.paymentCredentials)
        .set({
          accessTokenEnc: encryptSecret(refreshed.data.accessToken),
          // The code flow returns the SAME refresh token; a null here means
          // keep what we have. Overwriting with empty would break the
          // connection at the next expiry, a month later and far from the cause.
          ...(refreshed.data.refreshToken
            ? { refreshTokenEnc: encryptSecret(refreshed.data.refreshToken) }
            : {}),
          accessTokenExpiresAt: refreshed.data.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentCredentials.id, found.credential.id)),
    );
  }

  return { ok: true, accessToken, merchantId: found.merchantId };
}

/**
 * Square has stopped honouring the token. Not a disconnection — nothing was
 * revoked on purpose, and `closed_at` stays null — but the till must not treat
 * this account as able to take a card, so the status goes to `restricted` with
 * a detail the screen renders as "Needs reconnecting".
 */
async function markTokenRejected(paymentAccountId: string) {
  await withSystem((tx) =>
    tx
      .update(schema.paymentAccounts)
      .set({
        cardPaymentsStatus: "restricted",
        statusDetails: [{ code: TOKEN_REJECTED_CODE, resolution: "reconnect" }],
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentAccounts.id, paymentAccountId)),
  );
}

/**
 * Ask Square about every open connection the tenant has and write what it says.
 *
 * The page-load reconcile, as `reconcileConnectedAccounts` is for Stripe. It is
 * also the token refresh: `accessTokenFor` renews inside the last week, so a
 * farm that opens this page once a month never sees an expired token.
 *
 * **A NETWORK FAILURE IS NOT A DISCONNECTION** — logged and left. **A REJECTED
 * TOKEN IS A DEFINITE ANSWER FROM SQUARE** and is written as "needs
 * reconnecting"; the difference is that Square said so.
 */
export async function reconcileSquareAccounts(tenantId: string) {
  const config = squareConfig();
  if (!config) return;

  const rows = await withSystem((tx) =>
    tx.query.paymentAccounts.findMany({
      where: and(
        eq(schema.paymentAccounts.tenantId, tenantId),
        eq(schema.paymentAccounts.provider, "square"),
        isNull(schema.paymentAccounts.closedAt),
      ),
      columns: { id: true },
    }),
  );
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(async ({ id }) => {
      try {
        const access = await accessTokenFor(config, id);
        if (!access.ok) {
          if (access.needsReauth) await markTokenRejected(id);
          else console.error("square reconcile: token unavailable", id, access.message);
          return;
        }
        const merchant = await fetchSquareMerchant(config, access.accessToken);
        if (!merchant.ok) {
          if (merchant.tokenRejected) await markTokenRejected(id);
          else console.error("square reconcile: merchant read failed", id, merchant.message);
          return;
        }
        const locations = await fetchSquareLocations(config, access.accessToken);
        if (!locations.ok) {
          if (locations.tokenRejected) await markTokenRejected(id);
          else console.error("square reconcile: locations read failed", id, locations.message);
          return;
        }
        const projected = projectSquareAccount(merchant.data, locations.data);
        // withSystem: Square's verdict, written from a server→Square read (S7).
        await withSystem((tx) =>
          tx
            .update(schema.paymentAccounts)
            .set({
              squareMainLocationId: projected.squareMainLocationId,
              squareLocations: projected.squareLocations,
              cardPaymentsStatus: projected.cardPaymentsStatus,
              statusDetails: projected.statusDetails,
              displayName: projected.displayName,
              country: projected.country,
              defaultCurrency: projected.defaultCurrency,
              syncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentAccounts.id, id)),
        );
      } catch (err) {
        console.error("square reconcile failed", id, err);
      }
    }),
  );
}

/**
 * The grant is gone: the seller revoked it from Square, or the owner
 * disconnected here. Every row for that merchant closes and every token for
 * those rows is blanked — a revoked token is dead ciphertext, and keeping it
 * would only make a row look connected to someone reading the table.
 *
 * **THE ROWS SURVIVE.** Payments taken through this account will reference it.
 *
 * `withSystem` justified: reached from the signature-verified webhook and from
 * `disconnectSquare`, which has already proved the row belongs to the caller.
 */
export async function markSquareRevoked(
  merchantId: string,
): Promise<Array<{ tenantId: string; paymentAccountId: string }>> {
  return withSystem(async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(schema.paymentAccounts)
      .set({ closedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.paymentAccounts.provider, "square"),
          eq(schema.paymentAccounts.squareMerchantId, merchantId),
          isNull(schema.paymentAccounts.closedAt),
        ),
      )
      .returning({
        id: schema.paymentAccounts.id,
        tenantId: schema.paymentAccounts.tenantId,
      });
    if (rows.length === 0) return [];

    await tx
      .update(schema.paymentCredentials)
      .set({
        revokedAt: now,
        accessTokenEnc: "",
        refreshTokenEnc: "",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            schema.paymentCredentials.paymentAccountId,
            rows.map((r) => r.id),
          ),
          isNull(schema.paymentCredentials.revokedAt),
        ),
      );

    return rows.map((r) => ({ tenantId: r.tenantId, paymentAccountId: r.id }));
  });
}

/**
 * The owner disconnects Square from here. **Square first, then the row** — the
 * revoke call is what makes the token dead, and the row is only marked once
 * Square has confirmed. If Square says the grant is already gone, the row is
 * marked anyway: refusing to disconnect an account the seller has already
 * revoked would leave it stuck looking connected.
 *
 * @param paymentAccountId proved to belong to this tenant by the CALLER, inside
 *   its own `withTenant` scope. The `tenantId` predicate below is belt and braces.
 */
export async function disconnectSquare(input: {
  tenantId: string;
  paymentAccountId: string;
  actorClerkUserId: string;
}): Promise<void> {
  const config = squareConfig();
  if (!config) throw new SquareError("NOT_CONFIGURED", SQUARE_NOT_CONFIGURED);

  // withSystem: a read of a row the caller already proved is theirs; needed
  // only because the merchant id is what Square's revoke call wants.
  const row = await withSystem((tx) =>
    tx.query.paymentAccounts.findFirst({
      where: and(
        eq(schema.paymentAccounts.id, input.paymentAccountId),
        eq(schema.paymentAccounts.tenantId, input.tenantId),
        eq(schema.paymentAccounts.provider, "square"),
        isNull(schema.paymentAccounts.closedAt),
      ),
      columns: { squareMerchantId: true },
    }),
  );
  if (!row?.squareMerchantId) {
    throw new SquareError("NOT_CONNECTED", "Square isn't connected for this company.");
  }

  const revoked = await revokeSquareToken(config, row.squareMerchantId);
  if (!revoked.ok && !revoked.needsReauth) {
    throw new SquareError("SQUARE_FAILED", revoked.message);
  }

  await markSquareRevoked(row.squareMerchantId);
  await logAudit({
    action: "payments.square_disconnected",
    tenantId: input.tenantId,
    actorClerkUserId: input.actorClerkUserId,
    targetType: "payment_account",
    targetId: input.paymentAccountId,
    meta: { merchantId: row.squareMerchantId },
  });
}
