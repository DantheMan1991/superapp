/**
 * The platform's "closed for a few minutes" switch, read by the proxy on
 * every request.
 *
 * It exists for the Clerk production-instance cutover
 * (docs/runbooks/clerk-production-cutover.md). Every Clerk user and
 * organization id changes with the instance, and the database mirrors those
 * ids. Between the deploy that carries the new keys and the script that
 * rewrites the ids, a signed-in person has an organization the database has
 * never heard of — and `/onboarding` would mint a duplicate tenant for it,
 * idempotently and on purpose. Closing the platform for that window makes
 * the cutover safe by construction instead of by timing.
 *
 * Only the platform's own hosts close. A business's marketing site reads the
 * database and never a session, so it stays up; the proxy decides that by
 * host before it asks this module anything.
 *
 * Pure and dependency-free, like everything the proxy calls.
 */

/**
 * Machine callers that must keep landing while people are shut out: the
 * signature-verified webhooks (Clerk, Stripe, Square), the crons, inbound
 * mail from Resend, and the mail-provider event feed. Everything they touch
 * is keyed by ids the cutover script rewrites in the same transaction, and a
 * webhook answered 503 is retried by its sender anyway — but a cron skipped
 * is a digest nobody gets.
 */
const EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/inbound/",
  "/api/email/events",
];

/**
 * The index signature is what lets `process.env` be handed in as-is; the
 * named key is the only one read.
 */
export interface MaintenanceEnv {
  MAINTENANCE_MODE?: string;
  [key: string]: string | undefined;
}

/** `MAINTENANCE_MODE=1` (or true/on/yes). Anything else, including unset, is open. */
export function maintenanceModeFromEnv(env: MaintenanceEnv): boolean {
  const raw = env.MAINTENANCE_MODE?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export function isMaintenanceExempt(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The whole decision in one call, so the proxy stays a one-liner and the
 * rule is testable without a request object.
 */
export function shouldServeMaintenance(
  pathname: string,
  env: MaintenanceEnv,
): boolean {
  return maintenanceModeFromEnv(env) && !isMaintenanceExempt(pathname);
}

/**
 * Deliberately plain: no stylesheet, no script, no asset — a page that
 * depends on nothing cannot itself be down. Inline styles only.
 */
export const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Back in a few minutes</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f7f5;color:#1f1f1f">
<main style="max-width:28rem;padding:2rem;text-align:center">
<h1 style="font-size:1.5rem;font-weight:600;margin:0 0 .75rem">Back in a few minutes</h1>
<p style="margin:0;line-height:1.5;color:#555">Yosher is being updated. Nothing you saved is affected. Please try again shortly.</p>
</main>
</body>
</html>
`;
