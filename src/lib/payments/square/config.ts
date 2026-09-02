import "server-only";

/**
 * **SQUARE — THE TENANT CHARGING THEIR CUSTOMER, THROUGH THE SQUARE ACCOUNT
 * THEY ALREADY HAVE.**
 *
 * The second provider on `payment_accounts`, and the one the pilot actually
 * pays with (docs/modules/homestead-farm.md: "Square plus cash today"). The
 * model is the opposite of Stripe Connect's and the difference decides the
 * whole shape of this directory:
 *
 *   - Stripe Connect: the PLATFORM creates an account for the farm and acts on
 *     it with the platform key. We store an identifier (`acct_…`), never a
 *     credential.
 *   - Square: the farm ALREADY HAS an account. It authorises this application
 *     through OAuth and we hold a per-company access token, scoped and
 *     revocable, encrypted at rest (S8) in `payment_credentials` — a table no
 *     member policy can read.
 *
 * Square has no equivalent of Connect's hosted onboarding, KYC or requirements
 * list: whether the farm can take a card is Square's business, settled long
 * before we were involved, and the API tells us the verdict rather than the
 * homework. See ADR 0017.
 *
 * Kept apart from the flow so that the flow is testable without an
 * environment, the same split `src/lib/email/oauth/config.ts` draws.
 */

export type SquareEnvironment = "sandbox" | "production";

export interface SquareConfig {
  applicationId: string;
  applicationSecret: string;
  environment: SquareEnvironment;
  /** `https://connect.squareup.com` or the sandbox host. OAuth and the API share it. */
  baseUrl: string;
  /** Set once a webhook subscription exists in the Developer Console. */
  webhookSignatureKey: string | null;
}

const HOSTS: Record<SquareEnvironment, string> = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
};

/** Where "Open your Square dashboard" points, per environment. */
export const DASHBOARDS: Record<SquareEnvironment, string> = {
  sandbox: "https://app.squareupsandbox.com/dashboard/",
  production: "https://app.squareup.com/dashboard/",
};

export function isSquareConfigured(): boolean {
  return Boolean(
    process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_APPLICATION_SECRET,
  );
}

export const SQUARE_NOT_CONFIGURED =
  "Square payments are not switched on for this deployment yet. See SETUP.md.";

/**
 * **THE ENVIRONMENT DEFAULTS TO SANDBOX.** A deployment that forgets
 * `SQUARE_ENVIRONMENT` must be unable to take real money by accident; the only
 * way to reach production Square is to say so. The Stripe side gets the same
 * property for free from its key prefix (`sk_test_`), and Square's credentials
 * carry no such marker, so it has to be a rule here.
 */
export function squareEnvironment(): SquareEnvironment {
  return process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
}

export function squareConfig(): SquareConfig | null {
  const applicationId = process.env.SQUARE_APPLICATION_ID;
  const applicationSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!applicationId || !applicationSecret) return null;
  const environment = squareEnvironment();
  return {
    applicationId,
    applicationSecret,
    environment,
    baseUrl: HOSTS[environment],
    webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? null,
  };
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/**
 * Where Square sends the owner back after the permission form.
 *
 * Must match the redirect URL registered in the Developer Console EXACTLY, and
 * is built from `NEXT_PUBLIC_APP_URL` rather than the request so that a forged
 * Host header cannot steer the authorization code somewhere else — the same
 * reasoning as `mailOauthRedirectUri()`.
 */
export function squareRedirectUri(): string {
  return `${appBase()}/api/payments/square/callback`;
}

/**
 * The notification URL Square signs webhooks against. Part of the HMAC input,
 * so it has to be the URL registered in the Developer Console character for
 * character — a trailing slash or an http/https mismatch fails every signature.
 */
export function squareWebhookUrl(): string {
  return `${appBase()}/api/webhooks/square`;
}
