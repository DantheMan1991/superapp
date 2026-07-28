import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { requireTenant } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  MAIL_OAUTH_NOT_CONFIGURED,
  mailOauthProvider,
  mailOauthRedirectUri,
} from "@/lib/email/oauth/config";
import { discoverOidc } from "@/lib/email/oauth/discovery";
import { buildAuthorizeUrl, createPkcePair, createState } from "@/lib/email/oauth/flow";
import { storePending } from "@/lib/email/oauth/pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start connecting a mailbox.
 *
 * Sends the person to their own mail server to authorize us. Deliberately a
 * route rather than a server action: the response is a redirect to a third
 * party, which is what a browser navigation does naturally and what a fetch
 * from a form action does not.
 *
 * `requireTenant` rather than `requireTenantOwner` — connecting YOUR mailbox is
 * your business, not an administrative act. Provisioning the mailbox in the
 * first place is owner-only; reading the one you were given is not.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await requireTenant();
  const url = new URL(request.url);
  const mailboxId = url.searchParams.get("mailboxId");

  if (!mailboxId) {
    return NextResponse.json({ error: "No mailbox specified." }, { status: 400 });
  }

  const provider = mailOauthProvider();
  if (!provider) {
    return NextResponse.json({ error: MAIL_OAUTH_NOT_CONFIGURED }, { status: 503 });
  }

  // The mailbox must belong to this tenant. Without this check the mailboxId
  // is attacker-controlled and could bind someone else's address to this
  // person's connection.
  const mailbox = await withSystem((tx) =>
    tx.query.mailboxes.findFirst({
      where: and(
        eq(schema.mailboxes.tenantId, ctx.tenant.id),
        eq(schema.mailboxes.id, mailboxId),
      ),
    }),
  );
  if (!mailbox) {
    return NextResponse.json({ error: "That mailbox doesn't exist." }, { status: 404 });
  }

  const config = await discoverOidc(provider.baseUrl);
  if (!config.ok) {
    return NextResponse.json({ error: config.message }, { status: 502 });
  }
  if (!config.data.supportsRefreshToken) {
    // Without refresh the connection dies at the first expiry and the person
    // is asked to reconnect forever. Better to refuse than to ship that.
    return NextResponse.json(
      { error: "This mail server can't keep a connection alive. Ask your administrator." },
      { status: 502 },
    );
  }

  const state = createState();
  const { verifier, challenge } = createPkcePair();

  await storePending({
    state,
    verifier,
    mailboxId,
    tenantId: ctx.tenant.id,
    returnTo: url.searchParams.get("returnTo") ?? "/dashboard/m/email",
    issuedAt: Date.now(),
  });

  await logAudit({
    action: "mail.connect_started",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "mailbox",
    targetId: mailboxId,
    meta: { localPart: mailbox.localPart },
  });

  return NextResponse.redirect(
    buildAuthorizeUrl(config.data, {
      clientId: provider.clientId,
      redirectUri: mailOauthRedirectUri(),
      state,
      challenge,
    }),
  );
}
