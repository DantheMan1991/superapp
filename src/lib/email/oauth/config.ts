import "server-only";

/**
 * Where the mail server lives and who we are to it.
 *
 * Kept apart from the flow itself so that adding Google or Microsoft later is a
 * second provider in this file rather than a second copy of the flow. The
 * OAuth machinery in flow.ts and discovery.ts is already provider-agnostic —
 * this is the only part that is not.
 */

export interface MailOauthProvider {
  /** Base URL for discovery, e.g. https://mail.acme.com */
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
}

export function isMailOauthConfigured(): boolean {
  return Boolean(process.env.STALWART_BASE_URL && process.env.STALWART_CLIENT_ID);
}

export const MAIL_OAUTH_NOT_CONFIGURED =
  "Reading mail isn't set up yet — add STALWART_BASE_URL and STALWART_CLIENT_ID. See SETUP.md.";

export function mailOauthProvider(): MailOauthProvider | null {
  const baseUrl = process.env.STALWART_BASE_URL;
  const clientId = process.env.STALWART_CLIENT_ID;
  if (!baseUrl || !clientId) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    clientId,
    ...(process.env.STALWART_CLIENT_SECRET
      ? { clientSecret: process.env.STALWART_CLIENT_SECRET }
      : {}),
  };
}

/**
 * Where the mail server sends the person back.
 *
 * Must match what the OAuth client was registered with, exactly — a mismatched
 * redirect_uri is rejected by the server and produces one of the least
 * helpful error messages in the protocol.
 *
 * Built from NEXT_PUBLIC_APP_URL rather than the request, because an attacker
 * who can set the Host header could otherwise redirect the code to themselves.
 */
export function mailOauthRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}/api/email/oauth/callback`;
}
