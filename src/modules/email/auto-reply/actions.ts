"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "../core/errors";
import {
  MAX_BODY,
  MAX_SUBJECT,
  validateAutoReply,
  type AutoReplyDraft,
} from "./validate";

/**
 * Turning the out-of-office reply on and off.
 *
 * Nothing is stored here. The mail server holds the setting and sends the
 * replies, so this reads and writes one JMAP singleton — which is the reason
 * the feature works at all: it fires while nobody is signed in, and that is
 * precisely when somebody is away.
 */

const BASE = "/dashboard/m/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

const schema = z.object({
  mailboxId: z.string().uuid(),
  isEnabled: z.boolean(),
  /** Empty string means "no date", which is what the form sends for a blank. */
  fromDate: z.string().max(40),
  toDate: z.string().max(40),
  subject: z.string().max(MAX_SUBJECT),
  textBody: z.string().max(MAX_BODY),
});

export async function saveAutoReplyAction(
  input: z.infer<typeof schema>,
): Promise<ActionResult> {
  try {
    const ctx = await requireTenant();
    await requireModuleEnabled(ctx.tenant.id, "email");
    if (ctx.role === "expert") {
      throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
    }

    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const data = parsed.data;

    const draft: AutoReplyDraft = {
      isEnabled: data.isEnabled,
      fromDate: data.fromDate === "" ? null : data.fromDate,
      toDate: data.toDate === "" ? null : data.toDate,
      subject: data.subject,
      textBody: data.textBody,
    };

    // The same check the form runs, re-run here. Not belt and braces: the form
    // can be bypassed, and the failure it prevents — a window that has already
    // closed — saves cleanly and then silently never sends.
    const problem = validateAutoReply(draft, new Date());
    if (problem) return { error: problem.message };

    // The mailbox id is a claim; RLS is what proves it.
    const account = await loadConnection(ctx.tenant.id, ctx.userId, data.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");
    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    const saved = await client.data.setVacationResponse({
      isEnabled: draft.isEnabled,
      fromDate: draft.fromDate,
      toDate: draft.toDate,
      // Empty strings become null so the server treats them as unset rather
      // than as an intentionally blank subject on every reply.
      subject: draft.subject.trim() === "" ? null : draft.subject,
      textBody: draft.textBody.trim() === "" ? null : draft.textBody,
    });
    if (!saved.ok) return { error: saved.message };

    await logAudit({
      action: "mail.auto_reply",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: data.mailboxId,
      /**
       * Whether it is on and for how long — NEVER the subject or the body.
       * An out-of-office message is the most quotable thing in a mailbox: it
       * routinely says who is covering, where somebody is, and until when.
       * That belongs in the mail server, not in an audit row (S9).
       */
      meta: {
        enabled: draft.isEnabled,
        hasWindow: draft.fromDate !== null || draft.toDate !== null,
      },
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("auto-reply save failed", err);
    return { error: friendlyMessage(err) };
  }
}
