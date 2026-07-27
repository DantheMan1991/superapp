import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type { MailAccount } from "@/db/schema";
import {
  createJmapClient,
  discoverJmapSession,
  type JmapClient,
} from "@/lib/email/jmap/client";
import { decryptToken, encryptToken } from "./crypto";
import { mailOauthProvider } from "./config";
import { discoverOidc } from "./discovery";
import { needsRefresh, refreshAccessToken, type TokenSet } from "./flow";

/**
 * Stored mailbox connections, and getting a usable client out of one.
 *
 * The single place tokens are decrypted. Everything above this reads mail
 * through `authorizedClient()` and never sees a credential, which keeps the
 * decrypt call auditable to one file rather than spread across every route
 * that lists a folder.
 */

export type ConnectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; needsReauth?: boolean };

export async function saveConnection(input: {
  tenantId: string;
  mailboxId: string;
  clerkUserId: string;
  jmapSessionUrl: string;
  jmapAccountId: string;
  tokens: TokenSet;
}): Promise<MailAccount> {
  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(schema.mailAccounts)
      .values({
        tenantId: input.tenantId,
        mailboxId: input.mailboxId,
        clerkUserId: input.clerkUserId,
        jmapSessionUrl: input.jmapSessionUrl,
        jmapAccountId: input.jmapAccountId,
        accessTokenEnc: encryptToken(input.tokens.accessToken),
        refreshTokenEnc: input.tokens.refreshToken
          ? encryptToken(input.tokens.refreshToken)
          : "",
        tokenExpiresAt: input.tokens.expiresAt,
        status: "connected",
        lastError: "",
      })
      // Reconnecting replaces the tokens rather than creating a second row —
      // one person, one mailbox, one connection.
      .onConflictDoUpdate({
        target: [
          schema.mailAccounts.tenantId,
          schema.mailAccounts.mailboxId,
          schema.mailAccounts.clerkUserId,
        ],
        set: {
          jmapSessionUrl: input.jmapSessionUrl,
          jmapAccountId: input.jmapAccountId,
          accessTokenEnc: encryptToken(input.tokens.accessToken),
          refreshTokenEnc: input.tokens.refreshToken
            ? encryptToken(input.tokens.refreshToken)
            : "",
          tokenExpiresAt: input.tokens.expiresAt,
          status: "connected",
          lastError: "",
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });
}

export async function loadConnection(
  tenantId: string,
  clerkUserId: string,
  mailboxId: string,
): Promise<MailAccount | null> {
  const row = await withSystem((tx) =>
    tx.query.mailAccounts.findFirst({
      where: and(
        eq(schema.mailAccounts.tenantId, tenantId),
        eq(schema.mailAccounts.clerkUserId, clerkUserId),
        eq(schema.mailAccounts.mailboxId, mailboxId),
      ),
    }),
  );
  return row ?? null;
}

export async function listConnections(
  tenantId: string,
  clerkUserId: string,
): Promise<MailAccount[]> {
  return withSystem((tx) =>
    tx
      .select()
      .from(schema.mailAccounts)
      .where(
        and(
          eq(schema.mailAccounts.tenantId, tenantId),
          eq(schema.mailAccounts.clerkUserId, clerkUserId),
        ),
      ),
  );
}

async function markNeedsReauth(id: string, reason: string): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.mailAccounts)
      .set({
        status: "needs_reauth",
        lastError: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(schema.mailAccounts.id, id)),
  );
}

/**
 * A JMAP client for a stored connection, with the token refreshed if it is
 * close to expiring.
 *
 * Refresh happens BEFORE the request rather than in response to a 401, because
 * a 401 halfway through a batch has already cost the round trip and leaves the
 * caller deciding whether the operation was partially applied. Refreshing on a
 * timer is boring and boring is correct here.
 */
export async function authorizedClient(
  account: MailAccount,
): Promise<ConnectionResult<JmapClient>> {
  const provider = mailOauthProvider();
  if (!provider) {
    return { ok: false, message: "Reading mail isn't configured on this server." };
  }

  let accessToken = decryptToken(account.accessTokenEnc);
  if (!accessToken) {
    // Unreadable ciphertext means a rotated key or a damaged row. Either way
    // the connection is finished and the person has to reconnect.
    await markNeedsReauth(account.id, "stored token could not be decrypted");
    return {
      ok: false,
      needsReauth: true,
      message: "This mailbox needs to be reconnected.",
    };
  }

  if (needsRefresh(account.tokenExpiresAt)) {
    const refreshToken = decryptToken(account.refreshTokenEnc);
    if (!refreshToken) {
      await markNeedsReauth(account.id, "no usable refresh token");
      return {
        ok: false,
        needsReauth: true,
        message: "This mailbox needs to be reconnected.",
      };
    }

    const config = await discoverOidc(provider.baseUrl);
    if (!config.ok) return { ok: false, message: config.message };

    const refreshed = await refreshAccessToken(config.data, {
      refreshToken,
      clientId: provider.clientId,
      ...(provider.clientSecret ? { clientSecret: provider.clientSecret } : {}),
    });
    if (!refreshed.ok) {
      if (refreshed.needsReauth) {
        await markNeedsReauth(account.id, refreshed.message);
      }
      return {
        ok: false,
        message: refreshed.message,
        ...(refreshed.needsReauth ? { needsReauth: true } : {}),
      };
    }

    accessToken = refreshed.data.accessToken;
    await withSystem((tx) =>
      tx
        .update(schema.mailAccounts)
        .set({
          accessTokenEnc: encryptToken(refreshed.data.accessToken),
          // A null refreshToken means the server does not rotate — KEEP the
          // one we have. Overwriting with empty would break the connection at
          // the next expiry, hours later and far from the cause.
          ...(refreshed.data.refreshToken
            ? { refreshTokenEnc: encryptToken(refreshed.data.refreshToken) }
            : {}),
          tokenExpiresAt: refreshed.data.expiresAt,
          status: "connected",
          lastError: "",
          updatedAt: new Date(),
        })
        .where(eq(schema.mailAccounts.id, account.id)),
    );
  }

  const session = await discoverJmapSession(account.jmapSessionUrl, accessToken);
  if (!session.ok) {
    if (session.needsReauth) {
      await markNeedsReauth(account.id, session.message);
    }
    return {
      ok: false,
      message: session.message,
      ...(session.needsReauth ? { needsReauth: true } : {}),
    };
  }

  return { ok: true, data: createJmapClient(session.data, accessToken) };
}

/**
 * Forget a connection.
 *
 * Local only. Revoking our access at the mail server is the person's own
 * action there, and doing it for them would be surprising — they may have
 * connected the same mailbox from another device.
 */
export async function disconnectMailbox(
  tenantId: string,
  clerkUserId: string,
  mailboxId: string,
): Promise<void> {
  await withSystem((tx) =>
    tx
      .delete(schema.mailAccounts)
      .where(
        and(
          eq(schema.mailAccounts.tenantId, tenantId),
          eq(schema.mailAccounts.clerkUserId, clerkUserId),
          eq(schema.mailAccounts.mailboxId, mailboxId),
        ),
      ),
  );
}
