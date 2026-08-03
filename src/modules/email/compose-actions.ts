"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { looksLikeEmail } from "@/lib/email/identity";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "./core/errors";
import { holdComposedMessage, type HeldMessage } from "./compose/send";
import { composeBodies } from "./compose/bodies";
import {
  stripQuotedRegions,
  unfilledPlaceholders,
} from "./templates/placeholders";
import {
  isInlineImageType,
  isValidCid,
  MAX_INLINE_IMAGES,
} from "./compose/inline";

/**
 * Sending.
 *
 * Same shape as the module's other actions — gate → Zod → work → revalidate,
 * nothing thrown at the client — with one difference that is worth naming: this
 * is the only action in the product whose effect cannot be undone. A flag can be
 * unflagged and a link can be detached; a sent message is gone. So the
 * validation is stricter than elsewhere and the failure messages are specific
 * enough to act on.
 *
 * The dev guard is NOT here. It lives inside `compose/send.ts`, which is the one
 * place an envelope is built — putting it in the action would mean every future
 * caller had to remember it.
 *
 * THE BODY IS SANITIZED HERE AND THE TEXT PART IS DERIVED FROM THE RESULT, in
 * that order and nowhere else. Two reasons it is the action's job rather than
 * the composer's:
 *
 *   • A server action is a public boundary. The rich editor sanitizes nothing —
 *     it does not ship a sanitizer to the browser at all — so if this did not
 *     run, arbitrary markup would reach a recipient under this tenant's own
 *     From header. Zod proves the shape; only `sanitizeOutboundHtml` decides
 *     what a body may contain.
 *   • Deriving the text alternative from the SANITIZED html is what makes the
 *     two parts of a `multipart/alternative` the same message. Derive it from
 *     the raw input instead and a recipient on a text-only client reads words
 *     that were stripped from the version everyone else got.
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
  if (!(err instanceof MailError)) console.error("mail compose action failed", err);
  else if (err.code === "SEND_BLOCKED" || err.code === "SEND_FAILED") {
    // The user-facing sentence is deliberately vague; the operator needs the
    // real reason, and this is the only place it exists.
    console.error(`mail send refused [${err.code}]`, err.message);
  }
  return { error: friendlyMessage(err) };
}

/**
 * An address the person typed.
 *
 * Reuses `looksLikeEmail` from the send spine rather than `z.email()`, so the
 * two paths that put an address in front of a mail server agree about what one
 * is. A stricter validator here than there would produce "that worked on a share
 * link but not in Mail", which is the kind of inconsistency nobody can explain.
 */
const addressSchema = z.object({
  name: z.string().max(200).nullable().default(null),
  email: z.string().min(3).max(320).refine(looksLikeEmail, "not an email address"),
});

const sendSchema = z.object({
  mailboxId: z.string().uuid(),
  to: z.array(addressSchema).min(1).max(100),
  cc: z.array(addressSchema).max(100).default([]),
  bcc: z.array(addressSchema).max(100).default([]),
  subject: z.string().max(998).default(""),
  textBody: z.string().max(500_000).default(""),
  htmlBody: z.string().max(500_000).optional(),
  // Threading headers are opaque strings from the parent message, echoed back.
  inReplyTo: z.array(z.string().max(998)).max(4).optional(),
  references: z.array(z.string().max(998)).max(64).optional(),
  attachments: z
    .array(
      z.object({
        blobId: z.string().min(1).max(512),
        type: z.string().max(255),
        name: z.string().max(255),
      }),
    )
    .max(25)
    .optional(),
  /**
   * Pictures the html body references with `cid:`.
   *
   * Every field is re-checked rather than trusted, even though the upload route
   * minted the cid and settled the type: this is a server action, so the shape
   * arriving here is whatever the caller sent, and "we generated it earlier" is
   * a fact about a different request.
   */
  inlineImages: z
    .array(
      z.object({
        blobId: z.string().min(1).max(512),
        cid: z.string().refine(isValidCid, "not a content id we minted"),
        type: z.string().refine(isInlineImageType, "not an inline image type"),
        name: z.string().max(255),
      }),
    )
    .max(MAX_INLINE_IMAGES)
    .optional(),
});

export async function sendMessageAction(
  input: z.infer<typeof sendSchema>,
): Promise<ActionResult<HeldMessage>> {
  try {
    const ctx = await gate();
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) {
      // Recipients are the field people actually get wrong, and "Invalid input"
      // on a message somebody just typed is a cruel error.
      const badAddress = parsed.error.issues.some((i) =>
        ["to", "cc", "bcc"].includes(String(i.path[0])),
      );
      throw new MailError(
        badAddress ? "RECIPIENT_INVALID" : "SEND_FAILED",
        parsed.error.message,
      );
    }
    const data = parsed.data;

    // The mailbox id is a claim; RLS is what proves it.
    const account = await loadConnection(ctx.tenantId, ctx.userId, data.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    /**
     * The cids this message is allowed to reference, and nothing else.
     *
     * Built from the inline list the caller sent, which Zod has already checked
     * for shape and type. That is what makes an `<img>` in the body meaningful:
     * the sanitizer rebuilds every `src` from a cid in THIS set, so a body
     * naming a picture that is not attached loses the picture rather than
     * shipping a dangling reference — and one naming a remote URL never had a
     * `src` copied in the first place.
     */
    const inlineImages = data.inlineImages ?? [];
    const allowedCids = new Set(inlineImages.map((i) => i.cid));

    // See the header. Sanitize, THEN derive — the text part is a rendering of
    // what actually goes out, never of what was submitted.
    const bodies = composeBodies(data.htmlBody, data.textBody, allowedCids);

    /**
     * A TEMPLATE NOBODY FINISHED DOES NOT GO OUT.
     *
     * Placeholders are filled in the browser when a template is inserted, so
     * reaching here with one still in the body means the value could not be
     * resolved — usually because the template was inserted before a recipient
     * was chosen — and nobody noticed the toast that said so. Sending it puts
     * `{{recipient.name}}` in front of a customer under our user's own name.
     *
     * NARROW BY CONSTRUCTION, which is what makes refusing safe: only EXACT
     * members of the closed vocabulary count. Somebody writing to a developer
     * about `{{mustache}}` syntax, or pasting a config file, is unaffected —
     * the same "exact member of the set" test the style sanitizer applies
     * rather than a rule about what braces might mean.
     *
     * Checked on the SANITIZED bodies, so it judges what would actually be
     * sent, and on the text rendering too — a placeholder surviving only in the
     * plain-text alternative would reach exactly the recipients who never see
     * the HTML.
     *
     * The QUOTE is excluded. Somebody replying to "how do I use
     * {{recipient.name}}?" did not write that token and must not be stopped
     * from answering the question — see `stripQuotedRegions`.
     */
    const unfilled = unfilledPlaceholders(
      stripQuotedRegions(bodies.htmlBody ?? "", bodies.textBody ?? ""),
    );
    if (unfilled.length > 0) {
      return {
        error:
          `This message still has ${unfilled.map((k) => `{{${k}}}`).join(", ")} in it. ` +
          "Fill those in before sending — a template was inserted before there " +
          "was anything to fill them from.",
      };
    }

    /**
     * Only the pictures the SANITIZED body still points at are attached.
     *
     * A person who inserts an image and then deletes it from the editor leaves
     * the upload behind in the composer's list, and attaching it anyway would
     * put a file in the message with nothing referencing it — which most clients
     * show as an ordinary attachment. So the body decides, not the list.
     */
    const referenced = inlineImages.filter((image) =>
      bodies.htmlBody?.includes(`cid:${image.cid}`),
    );

    /**
     * HELD, not sent. The draft is created on the mail server and the decision
     * about what happens to it — release now, release after an undo window, or
     * queue for later — belongs to `schedule/actions.ts`.
     *
     * This is not an extra step for its own sake. `npm run mail:probe-send`
     * found this server refuses `sendAt` outright, so a delay cannot be a JMAP
     * submission dated in the future; it has to be a draft plus a decision. The
     * upside is that an interrupted undo window leaves a finished message in
     * Drafts rather than losing it.
     */
    const outcome = await holdComposedMessage(
      client.data,
      client.data.session.username,
      {
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        textBody: bodies.textBody,
        ...(bodies.htmlBody ? { htmlBody: bodies.htmlBody } : {}),
        ...(data.inReplyTo ? { inReplyTo: data.inReplyTo } : {}),
        ...(data.references ? { references: data.references } : {}),
        ...(data.attachments ? { attachments: data.attachments } : {}),
        ...(referenced.length > 0 ? { inlineImages: referenced } : {}),
      },
    );

    await logAudit({
      // NOT `mail.sent` — nothing has left yet. The send is audited by whichever
      // action releases it, so the log never claims a message went out because
      // somebody pressed a button.
      action: "mail.held",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: data.mailboxId,
      // Counts and ids only — never a subject, never an address (S9). The
      // recipient COUNT is the useful operational fact; who they were is the
      // tenant's own correspondence and belongs in their Sent folder, not in a
      // superadmin-visible log.
      meta: {
        emailId: outcome.emailId,
        recipients: data.to.length + data.cc.length + data.bcc.length,
        attachments: data.attachments?.length ?? 0,
        isReply: Boolean(data.inReplyTo?.length),
        redirected: outcome.redirected,
        // Whether it went as HTML, never the body. An operator debugging "the
        // formatting arrived wrong" needs to know which shape was sent; nobody
        // needs the words (S9).
        html: Boolean(bodies.htmlBody),
        inlineImages: referenced.length,
      },
    });

    revalidatePath(BASE);
    return { ok: true, data: outcome };
  } catch (err) {
    return fail(err);
  }
}
