import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { requireTenant } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { discoverJmapSession } from "@/lib/email/jmap/client";
import { sessionMatchesAddress } from "@/lib/email/jmap/parse";
import { saveConnection } from "@/lib/email/oauth/accounts";
import {
  MAIL_OAUTH_NOT_CONFIGURED,
  mailOauthProvider,
  mailOauthRedirectUri,
} from "@/lib/email/oauth/config";
import { discoverOidc } from "@/lib/email/oauth/discovery";
import { describeOauthError, exchangeCode } from "@/lib/email/oauth/flow";
import { takePending } from "@/lib/email/oauth/pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the mail server sends the person back.
 *
 * Everything arriving here is attacker-supplied — the code, the state, the
 * error — so nothing is trusted until the state matches a pending
 * authorization this browser started. The order of checks below is the
 * security of the flow:
 *
 *   1. consume the pending cookie (single-use, so a replay finds nothing)
 *   2. compare state (CSRF: proves this callback belongs to that request)
 *   3. confirm the signed-in tenant still matches the one that started it
 *   4. only then exchange the code, presenting the PKCE verifier
 *
 * Failures redirect with a readable message rather than returning JSON,
 * because a person arrives here in a browser and a raw error object is a dead
 * end for them.
 */
function back(returnTo: string, params: Record<string, string>): Response {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  // returnTo is joined against our own origin, so a value smuggled into the
  // cookie cannot turn this into an open redirect.
  const target = new URL(returnTo.startsWith("/") ? returnTo : "/dashboard", base);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target.toString());
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pending = await takePending();
  const returnTo = pending?.returnTo ?? "/dashboard/m/email";

  // The mail server reports a refusal here rather than sending a code.
  const errorCode = url.searchParams.get("error");
  if (errorCode) {
    return back(returnTo, {
      mailError: describeOauthError(
        errorCode,
        url.searchParams.get("error_description") ?? undefined,
      ),
    });
  }

  if (!pending) {
    return back(returnTo, {
      mailError: "That sign-in took too long or was already used. Try connecting again.",
    });
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return back(returnTo, { mailError: "The mail server's reply was incomplete." });
  }
  if (state !== pending.state) {
    // Someone is replaying or forging a callback. Say nothing specific.
    return back(returnTo, { mailError: "That sign-in couldn't be verified." });
  }

  const ctx = await requireTenant();
  if (ctx.tenant.id !== pending.tenantId) {
    // Switched organizations mid-flow, or the cookie belongs to another
    // context entirely. Either way this connection would land in the wrong
    // tenant.
    return back(returnTo, {
      mailError: "You switched organizations during sign-in. Try again.",
    });
  }

  const provider = mailOauthProvider();
  if (!provider) return back(returnTo, { mailError: MAIL_OAUTH_NOT_CONFIGURED });

  const config = await discoverOidc(provider.baseUrl);
  if (!config.ok) return back(returnTo, { mailError: config.message });

  const tokens = await exchangeCode(config.data, {
    code,
    clientId: provider.clientId,
    ...(provider.clientSecret ? { clientSecret: provider.clientSecret } : {}),
    redirectUri: mailOauthRedirectUri(),
    verifier: pending.verifier,
  });
  if (!tokens.ok) return back(returnTo, { mailError: tokens.message });

  // Prove the token actually opens the mailbox before recording a connection.
  // Storing one that turns out not to work produces a mailbox that looks
  // connected and fails on every read — worse than a failure here.
  const sessionUrl = `${provider.baseUrl}/.well-known/jmap`;
  const session = await discoverJmapSession(sessionUrl, tokens.data.accessToken);
  if (!session.ok) {
    return back(returnTo, {
      mailError: `Signed in, but the mailbox couldn't be opened: ${session.message}`,
    });
  }

  // ...and prove it opens THIS mailbox, not merely some mailbox. The mailbox
  // id came from our own encrypted cookie and was checked against the tenant
  // when the flow started, so this read is safe; what is unverified until now
  // is which address the person actually authorized at the mail server.
  const mailbox = await withSystem((tx) =>
    tx.query.mailboxes.findFirst({
      where: and(
        eq(schema.mailboxes.tenantId, pending.tenantId),
        eq(schema.mailboxes.id, pending.mailboxId),
      ),
    }),
  );
  if (!mailbox) {
    return back(returnTo, { mailError: "That mailbox no longer exists." });
  }
  if (!sessionMatchesAddress(session.data, mailbox.address)) {
    // Names the mismatch, because the fix is "sign in as the right person" and
    // a vague failure here sends people round the loop repeatedly. Safe to say:
    // both addresses already belong to whoever is looking.
    return back(returnTo, {
      mailError:
        `You signed in as ${session.data.username || session.data.accountName || "another account"}, ` +
        `but this is ${mailbox.address}. Connect it while signed in as that address.`,
    });
  }

  const account = await saveConnection({
    tenantId: pending.tenantId,
    mailboxId: pending.mailboxId,
    clerkUserId: ctx.userId,
    jmapSessionUrl: sessionUrl,
    jmapAccountId: session.data.primaryAccountId,
    tokens: tokens.data,
  });

  await logAudit({
    action: "mail.connected",
    tenantId: pending.tenantId,
    actorClerkUserId: ctx.userId,
    targetType: "mail_account",
    targetId: account.id,
    // Identifiers only — no address, no token, per the module's rule.
    meta: { mailboxId: pending.mailboxId, hasRefreshToken: Boolean(tokens.data.refreshToken) },
  });

  return back(returnTo, { mailConnected: "1" });
}
