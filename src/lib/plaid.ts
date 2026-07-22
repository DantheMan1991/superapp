import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Lazy Plaid client, matching the getClaude()/Stripe convention: the app
 * builds and boots without keys; the first Plaid feature use requires
 * PLAID_CLIENT_ID + PLAID_SECRET (+ PLAID_ENV, default sandbox).
 * Plaid holds the bank credentials — this platform never sees them.
 */

let client: PlaidApi | undefined;

export function getPlaid(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET are not set. See SETUP.md.");
  }
  if (!client) {
    const env = process.env.PLAID_ENV ?? "sandbox";
    client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": clientId,
            "PLAID-SECRET": secret,
          },
        },
      }),
    );
  }
  return client;
}

export function plaidEnv(): string {
  return process.env.PLAID_ENV ?? "sandbox";
}

export function plaidConfigured(): boolean {
  return !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;
}
