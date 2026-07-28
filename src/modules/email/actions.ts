"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import {
  authorizedClient,
  disconnectMailbox,
  loadConnection,
} from "@/lib/email/oauth/accounts";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import { syncMailAccount } from "@/lib/email/sync/account";
import { MailError, friendlyMessage } from "./core/errors";

/**
 * Mail's server actions.
 *
 * Canonical shape, same as the Documents and Accounting slices:
 * gate → Zod → work → revalidate. Nothing throws at the client.
 *
 * One difference worth naming: most of this module's work is protocol calls to
 * a mail server rather than database writes, so there is usually no transaction
 * to put an audit row inside. `logAudit` (fire-and-forget) is therefore right
 * here, where `logAuditInTx` is right in the ledger — an audit failure must not
 * be able to fail a read of somebody's inbox.
 */

const BASE = "/dashboard/m/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

interface MailCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

async function gate(): Promise<MailCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "email");
  // Mail is denied to the external accountant outright, not made read-only.
  // The ledger is the business's numbers; the mailbox is its correspondence —
  // quotes, disputes, staff matters — and none of that is within the remit
  // somebody was given to close the books.
  if (ctx.role === "expert") {
    throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof MailError) return { error: friendlyMessage(err) };
  console.error("mail action failed", err);
  return { error: friendlyMessage(err) };
}

/**
 * Every message action resolves the connection itself rather than trusting an
 * account id from the client. `loadConnection` reads under the caller's own
 * RLS context, so a colleague's account id resolves to nothing — the id is
 * treated as a claim, and the scope is what proves it (security.md §4).
 */
async function clientFor(ctx: MailCtx, mailboxId: string) {
  const account = await loadConnection(ctx.tenantId, ctx.userId, mailboxId);
  if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");
  const client = await authorizedClient(account);
  if (!client.ok) {
    throw new MailError(
      client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
      client.message,
    );
  }
  return client.data;
}

const keywordSchema = z.object({
  mailboxId: z.string().uuid(),
  emailIds: z.array(z.string().min(1)).min(1).max(200),
  keyword: z.enum([KEYWORD_SEEN, KEYWORD_FLAGGED]),
  on: z.boolean(),
});

/** Mark read/unread and flag/unflag — the two keywords the reading pane sets. */
export async function setKeywordAction(
  input: z.infer<typeof keywordSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = keywordSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const client = await clientFor(ctx, parsed.data.mailboxId);
    const result = await client.setKeyword(
      parsed.data.emailIds,
      parsed.data.keyword,
      parsed.data.on,
    );
    if (!result.ok) return { error: result.message };

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const moveSchema = z.object({
  mailboxId: z.string().uuid(),
  emailIds: z.array(z.string().min(1)).min(1).max(200),
  targetMailboxId: z.string().min(1),
});

/**
 * Move to a folder — which is how archive, trash and junk are all expressed.
 *
 * No local record of any of this: the mail server owns where a message lives,
 * and a second opinion here would be a second thing to be wrong. The same
 * message moved from a phone is simply moved.
 */
export async function moveMessagesAction(
  input: z.infer<typeof moveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const client = await clientFor(ctx, parsed.data.mailboxId);
    const result = await client.moveToMailbox(
      parsed.data.emailIds,
      parsed.data.targetMailboxId,
    );
    if (!result.ok) return { error: result.message };

    await logAudit({
      action: "mail.messages_moved",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: parsed.data.mailboxId,
      // Counts, never subjects or addresses — S9.
      meta: { moved: result.data.updated.length },
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const pollSchema = z.object({ mailboxId: z.string().uuid() });

/**
 * "Has anything arrived?" — the poller's whole job.
 *
 * Deliberately the cheapest thing that can answer honestly: `currentState()` is
 * one small request returning a state string. When it matches what we stored,
 * this returns `changed: false` having done no `Email/changes`, no `Email/get`
 * and no database write beyond a timestamp.
 *
 * Returns a RESULT rather than throwing on a dead connection, because the
 * poller has to be able to stop itself: hammering a revoked credential every
 * 45 seconds forever is how you get rate-limited by your own mail server.
 */
export async function checkForNewMailAction(
  input: z.infer<typeof pollSchema>,
): Promise<
  { ok: true; changed: boolean; unread: number } | { error: string; stop?: boolean }
> {
  try {
    const ctx = await gate();
    const parsed = pollSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input", stop: true };

    const account = await loadConnection(
      ctx.tenantId,
      ctx.userId,
      parsed.data.mailboxId,
    );
    if (!account) return { error: "That mailbox isn't connected.", stop: true };

    const outcome = await syncMailAccount(account);
    if (!outcome.ok) {
      // A credential that needs re-authorizing will not fix itself, so the
      // poller is told to give up rather than retry on a timer.
      return { error: outcome.message ?? "Sync failed", stop: outcome.needsReauth };
    }

    // A skipped run (inside the cooldown) reports no change rather than
    // pretending to be fresh.
    const changed = !outcome.skipped && !outcome.unchanged;
    if (changed) revalidatePath(BASE);
    return { ok: true, changed, unread: outcome.unread ?? 0 };
  } catch (err) {
    const failure = fail(err);
    return { ...failure, stop: true };
  }
}

const disconnectSchema = z.object({ mailboxId: z.string().uuid() });

/**
 * Forget this person's connection to a mailbox.
 *
 * Local only, and scoped to the caller: `disconnectMailbox` filters on
 * clerkUserId, so this can never drop a colleague's connection to a shared
 * address. Revoking the token at the mail server is the person's own action
 * there — they may have connected the same mailbox from another device, and
 * signing them out of it would be a surprise.
 */
export async function disconnectMailboxAction(
  input: z.infer<typeof disconnectSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = disconnectSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    // Confirm it was ours before reporting success, so a wrong id reads as
    // "that isn't connected" rather than a silent no-op that looks like it
    // worked.
    const existing = await loadConnection(
      ctx.tenantId,
      ctx.userId,
      parsed.data.mailboxId,
    );
    if (!existing) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    await disconnectMailbox(ctx.tenantId, ctx.userId, parsed.data.mailboxId);

    await logAudit({
      action: "mail.disconnected",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: parsed.data.mailboxId,
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
