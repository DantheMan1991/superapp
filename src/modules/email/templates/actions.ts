"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { MailError, friendlyMessage } from "../core/errors";
import { PLACEHOLDERS, validateTemplateBody } from "./placeholders";
import {
  MAX_TEMPLATE_HTML,
  MAX_TEMPLATE_NAME,
  MAX_TEMPLATE_SUBJECT,
  prepareTemplateBody,
  templateIsEmpty,
  templateNameKey,
} from "./validate";

/**
 * Creating, editing and deleting canned responses.
 *
 * The first mail feature stored in OUR database rather than on the mail server,
 * and `npm run mail:probe-templates` is why: the server can hold a template
 * perfectly well, but only inside one account — so sharing the company's
 * payment-terms wording would mean granting a colleague the mailbox it lives in
 * and every message in it.
 *
 * Tenant-scoped, so any member may edit any template. That is deliberate and
 * matches `document_templates`: a colleague correcting the payment terms is
 * doing their job, and the worst case is retyping a paragraph. The author is
 * recorded rather than enforced.
 */

const BASE = "/dashboard/m/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

const saveSchema = z.object({
  /** Absent when creating. A claim; RLS is what proves it belongs here. */
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(MAX_TEMPLATE_NAME),
  subject: z.string().max(MAX_TEMPLATE_SUBJECT),
  /**
   * The HTML the editor produced. Sanitized here on the way in — see
   * `prepareTemplateBody`. There is no plain-text field: the text alternative
   * is derived at send time from the composed body, so storing one would create
   * the second source of truth the whole compose path was built to avoid.
   */
  html: z.string().max(MAX_TEMPLATE_HTML),
});

/** Both create and update — the form is the same and so is the validation. */
export async function saveTemplateAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireTenant();
    await requireModuleEnabled(ctx.tenant.id, "email");
    if (ctx.role === "expert") {
      throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
    }

    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const data = parsed.data;

    const name = data.name.trim();
    if (name.length === 0) return { error: "Give the template a name." };

    const bodyHtml = prepareTemplateBody(data.html);
    if (templateIsEmpty(bodyHtml)) {
      // Asked of the SANITIZED body: an untouched editor emits `<div><br></div>`,
      // and a template that inserts nothing reads as a broken feature rather
      // than as an empty template.
      return { error: "The template is empty. Write the message it should insert." };
    }

    /**
     * PLACEHOLDERS ARE CHECKED HERE BECAUSE THIS IS THE LAST MOMENT SOMEBODY IS
     * LOOKING AT THEM.
     *
     * A template is written once and sent many times, so a mistake in one is
     * not one bad email — it is every email until somebody notices. Both
     * failures below would otherwise reach a customer as literal braces in the
     * middle of a sentence.
     *
     * Checked AFTER sanitizing, so the answer is about the markup that will
     * actually be stored rather than about whatever the editor happened to emit.
     */
    const problem = validateTemplateBody(bodyHtml);
    if (problem?.kind === "unknown") {
      return {
        error:
          `Yosher doesn't know ${problem.keys.map((k) => `{{${k}}}`).join(", ")}. ` +
          `You can use: ${PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(", ")}.`,
      };
    }
    if (problem?.kind === "split") {
      // The editor's doing: bolding part of a token, or a browser splitting a
      // text node mid-word, leaves `{{recipient.<b>name}}</b>` — which reads
      // correctly and can never be substituted.
      return {
        error:
          `${problem.keys.map((k) => `{{${k}}}`).join(", ")} has formatting ` +
          "inside it, so it can't be filled in. Delete it and type it again " +
          "without changing the formatting part-way through.",
      };
    }

    const nameKey = templateNameKey(name);
    const subject = data.subject.trim();

    const saved = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        // The name collision is caught here rather than left to the unique
        // index, so the message names the problem. The index is still what
        // guarantees it — two people saving at once reach the constraint.
        const clash = await tx
          .select({ id: schema.mailTemplates.id })
          .from(schema.mailTemplates)
          .where(
            and(
              eq(schema.mailTemplates.tenantId, ctx.tenant.id),
              eq(schema.mailTemplates.nameKey, nameKey),
            ),
          );
        if (clash.some((row) => row.id !== data.id)) return null;

        if (data.id) {
          const [row] = await tx
            .update(schema.mailTemplates)
            .set({ name, nameKey, subject, bodyHtml, updatedAt: new Date() })
            .where(
              and(
                eq(schema.mailTemplates.tenantId, ctx.tenant.id),
                eq(schema.mailTemplates.id, data.id),
              ),
            )
            .returning({ id: schema.mailTemplates.id });
          return row ?? null;
        }

        const [row] = await tx
          .insert(schema.mailTemplates)
          .values({
            tenantId: ctx.tenant.id,
            name,
            nameKey,
            subject,
            bodyHtml,
            createdByClerkUserId: ctx.userId,
          })
          .returning({ id: schema.mailTemplates.id });
        return row ?? null;
      },
      { role: ctx.role },
    );

    if (!saved) {
      return {
        error: `A template called "${name}" already exists. Pick another name, or edit that one.`,
      };
    }

    await logAudit({
      action: data.id ? "mail.template_updated" : "mail.template_created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mail_template",
      targetId: saved.id,
      // Identifiers and sizes only. A template's NAME is close enough to
      // business content to leave out, and its body certainly is (S9) — the
      // same rule that keeps rule names out of `mail.rules_published`.
      meta: { bytes: bodyHtml.length, hasSubject: subject.length > 0 },
    });

    revalidatePath(BASE);
    return { ok: true, data: { id: saved.id } };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("template save failed", err);
    return { error: friendlyMessage(err) };
  }
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteTemplateAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await requireTenant();
    await requireModuleEnabled(ctx.tenant.id, "email");
    if (ctx.role === "expert") {
      throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
    }

    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    // No ownership check beyond the tenant, on purpose — see the file header
    // and drizzle/0056. The id is a claim and RLS is what confines it.
    const deleted = await withTenant(
      ctx.tenant.id,
      (tx) =>
        tx
          .delete(schema.mailTemplates)
          .where(
            and(
              eq(schema.mailTemplates.tenantId, ctx.tenant.id),
              eq(schema.mailTemplates.id, parsed.data.id),
            ),
          )
          .returning({ id: schema.mailTemplates.id }),
      { role: ctx.role },
    );
    if (deleted.length === 0) return { error: "That template no longer exists." };

    await logAudit({
      action: "mail.template_deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mail_template",
      targetId: parsed.data.id,
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("template delete failed", err);
    return { error: friendlyMessage(err) };
  }
}
