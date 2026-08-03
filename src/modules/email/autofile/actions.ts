"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "../core/errors";
import { filingDestinationIsUsable } from "./load";

/**
 * Setting up "everything from this supplier goes in the Bills folder".
 *
 * The one action in this module that arranges for correspondence to be
 * published to colleagues WITHOUT a person present each time. The manual path
 * (`link-actions.ts`) has somebody press a button and audits inside the
 * transaction because of what it discloses; this creates a standing instruction
 * to do the same thing on a schedule. Everything below follows from that.
 */

const BASE = "/dashboard/m/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  mailboxId: z.string().uuid(),
  name: z.string().min(1).max(80),
  /** A JMAP mailbox id. Opaque, and only meaningful inside this connection. */
  matchMailboxId: z.string().max(255).nullable(),
  matchFrom: z.string().max(200),
  /** A Documents folder id. Null files into the Documents inbox. */
  destinationFolderId: z.string().uuid().nullable(),
  isEnabled: z.boolean(),
});

export async function saveAutofileRuleAction(
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

    // The mailbox id is a claim; RLS through `loadConnection` is what proves it
    // is this person's connection. A rule may only ever watch your own mailbox.
    const account = await loadConnection(ctx.tenant.id, ctx.userId, data.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const name = data.name.trim();
    const matchFrom = data.matchFrom.trim();
    if (name.length === 0) return { error: "Give the rule a name." };

    /**
     * A RULE MUST CONSTRAIN SOMETHING.
     *
     * With neither a folder nor a sender it matches every message with an
     * attachment, which is not a filing rule — it is "publish my entire mailbox
     * to my colleagues", arrived at by leaving two fields blank. The Sieve
     * compiler refuses a rule with no tests for the same reason and it is
     * recorded in `0052`; this is the higher-stakes version of it, because what
     * this one over-matches gets copied where everybody can read it.
     */
    if (!data.matchMailboxId && matchFrom.length === 0) {
      return {
        error:
          "Choose a folder or a sender. A rule with neither would file every " +
          "attachment in this mailbox into Documents, where the whole business " +
          "can read it.",
      };
    }

    /**
     * The destination has to be somewhere the SWEEP can write.
     *
     * Checked as `staff`, which is what the cron will be — see `load.ts`. An
     * owners-only folder is invisible to it, so a rule pointing at one would
     * look configured and file nothing, silently, every night. Refusing here
     * makes that a message at the moment somebody chooses.
     */
    if (data.destinationFolderId) {
      const usable = await filingDestinationIsUsable(
        ctx.tenant.id,
        ctx.userId,
        data.destinationFolderId,
      );
      if (!usable) {
        return {
          error:
            "That folder can't be used for automatic filing. Filing runs in the " +
            "background with no one signed in, so it cannot reach an owners-only " +
            "folder — pick one everybody in the business can see.",
        };
      }
    }

    const saved = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        if (data.id) {
          const [row] = await tx
            .update(schema.mailAutofileRules)
            .set({
              name,
              matchMailboxId: data.matchMailboxId,
              matchFrom,
              destinationFolderId: data.destinationFolderId,
              isEnabled: data.isEnabled,
              // Clearing the error on save: whatever was wrong, the person has
              // just had another go, and a stale failure beside a fresh edit
              // reads as though the edit did not take.
              lastError: "",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.mailAutofileRules.tenantId, ctx.tenant.id),
                eq(schema.mailAutofileRules.id, data.id),
              ),
            )
            .returning({ id: schema.mailAutofileRules.id });
          return row ?? null;
        }

        const [row] = await tx
          .insert(schema.mailAutofileRules)
          .values({
            tenantId: ctx.tenant.id,
            clerkUserId: ctx.userId,
            mailAccountId: account.id,
            name,
            matchMailboxId: data.matchMailboxId,
            matchFrom,
            destinationFolderId: data.destinationFolderId,
            isEnabled: data.isEnabled,
            /**
             * FROM NOW, NOT FROM THE BEGINNING.
             *
             * A new rule is a statement about what arrives next. Starting at
             * null would make the first sweep walk the whole mailbox and
             * publish years of attachments into a shared folder — which is a
             * disclosure nobody asked for and could not easily undo.
             */
            cursor: new Date(),
          })
          .returning({ id: schema.mailAutofileRules.id });
        return row ?? null;
      },
      { role: ctx.role, userId: ctx.userId },
    );

    if (!saved) return { error: "That rule no longer exists." };

    await logAudit({
      action: data.id ? "mail.autofile_rule_updated" : "mail.autofile_rule_created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mail_autofile_rule",
      targetId: saved.id,
      // Identifiers and shape only. The SENDER pattern is deliberately absent:
      // "anything from the solicitor" says what somebody is dealing with, which
      // is the same reason rule names stay out of `mail.rules_published` (S9).
      meta: {
        mailAccountId: account.id,
        scoped: data.matchMailboxId ? "folder" : "sender",
        toFolder: Boolean(data.destinationFolderId),
        enabled: data.isEnabled,
      },
    });

    revalidatePath(BASE);
    return { ok: true, data: { id: saved.id } };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("autofile save failed", err);
    return { error: friendlyMessage(err) };
  }
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteAutofileRuleAction(
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

    // No ownership predicate beyond the tenant: the per-user policy (0058) is
    // what confines this to the caller's own rules, and a colleague's id
    // resolves to nothing exactly as an invented one does.
    const deleted = await withTenant(
      ctx.tenant.id,
      (tx) =>
        tx
          .delete(schema.mailAutofileRules)
          .where(
            and(
              eq(schema.mailAutofileRules.tenantId, ctx.tenant.id),
              eq(schema.mailAutofileRules.id, parsed.data.id),
            ),
          )
          .returning({ id: schema.mailAutofileRules.id }),
      { role: ctx.role, userId: ctx.userId },
    );
    if (deleted.length === 0) return { error: "That rule no longer exists." };

    await logAudit({
      action: "mail.autofile_rule_deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mail_autofile_rule",
      targetId: parsed.data.id,
    });

    // Deliberately does NOT remove anything already filed. "Stop filing new
    // mail here" and "destroy the records you filed" are different intentions,
    // and only one was expressed — the same call unlinking makes.
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("autofile delete failed", err);
    return { error: friendlyMessage(err) };
  }
}
