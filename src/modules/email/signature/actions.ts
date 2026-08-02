"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "../core/errors";
import { MAX_SIGNATURE_HTML, prepareSignature } from "./validate";

/**
 * Saving a signature.
 *
 * Nothing is stored here, and that is the design rather than a shortcut. The
 * signature lives on the mail server's Identity, so it applies to mail sent from
 * Outlook and a phone as well as from Yosher — a signature that only worked in
 * one client would be a worse version of the thing it replaced. It is also why
 * this module has never needed a signatures table.
 *
 * The identity id is a CLAIM from the form. It is not re-derived here, but the
 * account it is set on is proved by RLS through `loadConnection`, and the client
 * sends only the two signature fields — so the worst a wrong id can do is fail.
 */

const BASE = "/dashboard/m/email";

type ActionResult = { ok: true } | { error: string };

const schema = z.object({
  mailboxId: z.string().uuid(),
  identityId: z.string().min(1).max(255),
  /**
   * The HTML the editor produced. There is no `textSignature` field on purpose:
   * it is DERIVED from this, so the two halves cannot disagree — see
   * `validate.ts`. Accepting one here would create the second source of truth
   * the whole compose path was built to avoid.
   */
  html: z.string().max(MAX_SIGNATURE_HTML),
});

export async function saveSignatureAction(
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

    // Sanitized and derived before it goes anywhere. See `validate.ts`: this is
    // the most-sent markup in the product.
    const prepared = prepareSignature(data.html);

    const saved = await client.data.setSignature(data.identityId, prepared);
    if (!saved.ok) throw new MailError("SEND_FAILED", saved.message);

    await logAudit({
      action: "mail.signature_saved",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: data.mailboxId,
      /**
       * Whether there is one and how big it is — never the signature itself.
       * A signature is the most quotable thing in a mailbox after an
       * out-of-office: it routinely carries a direct line, a home address and a
       * job title, and that belongs on the mail server rather than in a
       * superadmin-visible audit row (S9).
       */
      meta: {
        cleared: prepared.htmlSignature.length === 0,
        bytes: prepared.htmlSignature.length,
      },
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("mail signature action failed", err);
    return { error: friendlyMessage(err) };
  }
}
