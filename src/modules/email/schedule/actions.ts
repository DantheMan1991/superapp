"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "../core/errors";
import { releaseHeldMessage } from "../compose/send";
import { MAX_SCHEDULE_DAYS, MIN_SCHEDULE_SECONDS, validateSendAt } from "./times";

/**
 * Releasing, cancelling and queueing a message that is already on the mail
 * server as a draft.
 *
 * The composer holds every message this way now — `holdComposedMessage` creates
 * the draft, and one of these decides what happens to it. That indirection is
 * not architecture for its own sake: `npm run mail:probe-send` found this server
 * refuses `sendAt` (`invalidProperties`, naming the field) and advertises no
 * `maxDelayedSend`, so a delay cannot be a JMAP submission dated in the future.
 * It has to be a draft plus a decision — and the draft is what makes losing the
 * decision harmless.
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
  if (ctx.role === "expert") {
    throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof MailError)) console.error("mail schedule action failed", err);
  return { error: friendlyMessage(err) };
}

/** Everything needed to submit a draft, as the composer hands it back. */
const heldSchema = z.object({
  mailboxId: z.string().uuid(),
  emailId: z.string().min(1).max(512),
  identityId: z.string().min(1).max(255),
  fromEmail: z.string().min(3).max(320),
  draftsMailboxId: z.string().min(1).max(512),
  sentMailboxId: z.string().max(512).nullable().default(null),
  /** The envelope from the guard, re-guarded at release. */
  envelopeRcptTo: z.array(z.string().min(3).max(320)).min(1).max(300),
});

/**
 * Send it now — the end of an undo window that nobody interrupted.
 *
 * The composer calls this after its countdown. Nothing about the DELAY is
 * enforced here: the message is already a draft the caller owns, so submitting
 * it early is the same operation as pressing Send, and inventing a server-side
 * "not yet" would only be a rule to work around.
 */
export async function releaseHeldMessageAction(
  input: z.infer<typeof heldSchema>,
): Promise<ActionResult<{ deliveredTo: string[] }>> {
  try {
    const ctx = await gate();
    const parsed = heldSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const data = parsed.data;

    const account = await loadConnection(ctx.tenantId, ctx.userId, data.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");
    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    const sent = await releaseHeldMessage(
      client.data,
      {
        emailId: data.emailId,
        identityId: data.identityId,
        fromEmail: data.fromEmail,
        draftsMailboxId: data.draftsMailboxId,
        sentMailboxId: data.sentMailboxId,
      },
      data.envelopeRcptTo,
    );

    await logAudit({
      action: "mail.sent",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: data.mailboxId,
      meta: {
        emailId: data.emailId,
        recipients: data.envelopeRcptTo.length,
        held: true,
      },
    });

    revalidatePath(BASE);
    return { ok: true, data: { deliveredTo: sent.deliveredTo } };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Undo — the message never goes.
 *
 * The draft is DESTROYED rather than left behind, and that is the deliberate
 * half. Somebody who presses Undo has decided not to send this; finding it in
 * Drafts afterwards would be a second copy to deal with, and the text is still
 * in the composer they were just looking at. A draft left after a FAILURE is a
 * rescue; one left after an explicit cancel is litter.
 */
export async function cancelHeldMessageAction(input: {
  mailboxId: string;
  emailId: string;
}): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = z
      .object({ mailboxId: z.string().uuid(), emailId: z.string().min(1).max(512) })
      .safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const data = parsed.data;

    const account = await loadConnection(ctx.tenantId, ctx.userId, data.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");
    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    // Any queued row for this draft goes FIRST. A scheduled send whose draft has
    // been destroyed would fail on every sweep, forever, with nothing to fix.
    await withTenant(
      ctx.tenantId,
      (tx) =>
        tx
          .delete(schema.mailScheduledSends)
          .where(
            and(
              eq(schema.mailScheduledSends.tenantId, ctx.tenantId),
              eq(schema.mailScheduledSends.emailId, data.emailId),
            ),
          ),
      { role: ctx.role, userId: ctx.userId },
    );

    const destroyed = await client.data.destroyEmails([data.emailId]);
    if (!destroyed.ok) throw new MailError("SEND_FAILED", destroyed.message);

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const scheduleSchema = heldSchema.extend({
  /** An absolute instant, computed in the BROWSER. See `times.ts`. */
  sendAt: z.string().min(10).max(40),
});

/** Queue a held message for later. */
export async function scheduleHeldMessageAction(
  input: z.infer<typeof scheduleSchema>,
): Promise<ActionResult<{ sendAt: string }>> {
  try {
    const ctx = await gate();
    const parsed = scheduleSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const data = parsed.data;

    const at = new Date(data.sendAt);
    // The server BOUNDS what the browser computed; it cannot recompute it,
    // because the timezone is not in the request. Rejects rather than clamps —
    // clamping a past time to "now" would send immediately, which is the one
    // thing somebody choosing a schedule did not ask for.
    const problem = validateSendAt(at, new Date());
    if (problem) {
      throw new MailError(
        "SEND_FAILED",
        problem === "too soon"
          ? `Pick a time at least ${MIN_SCHEDULE_SECONDS / 60} minute away.`
          : problem === "too far ahead"
            ? `Messages can be scheduled up to ${MAX_SCHEDULE_DAYS} days ahead.`
            : "Pick a time in the future.",
      );
    }

    const account = await loadConnection(ctx.tenantId, ctx.userId, data.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    await withTenant(
      ctx.tenantId,
      (tx) =>
        tx
          .insert(schema.mailScheduledSends)
          .values({
            tenantId: ctx.tenantId,
            clerkUserId: ctx.userId,
            mailAccountId: account.id,
            emailId: data.emailId,
            identityId: data.identityId,
            fromEmail: data.fromEmail,
            draftsMailboxId: data.draftsMailboxId,
            sentMailboxId: data.sentMailboxId,
            envelopeRcptTo: data.envelopeRcptTo,
            sendAt: at,
          })
          // Scheduling the same draft twice is a double-click, and two rows
          // would race to submit it — which would send it twice.
          .onConflictDoNothing(),
      { role: ctx.role, userId: ctx.userId },
    );

    await logAudit({
      action: "mail.scheduled",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: data.mailboxId,
      // When, and how many. Never who, never what.
      meta: { sendAt: at.toISOString(), recipients: data.envelopeRcptTo.length },
    });

    revalidatePath(BASE);
    return { ok: true, data: { sendAt: at.toISOString() } };
  } catch (err) {
    return fail(err);
  }
}
