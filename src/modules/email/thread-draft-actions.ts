"use server";

import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { loadConnection, authorizedClient } from "@/lib/email/oauth/accounts";
import {
  draftersFrom,
  enabledMailExtensions,
  findDrafter,
} from "@/lib/mail-extensions/resolve";
import type {
  DraftableThread,
  DraftedRecord,
  MailExtensionCtx,
} from "@/lib/mail-extensions/types";
import { MailError, friendlyMessage } from "./core/errors";
import { htmlToText } from "./render/transcript";

/**
 * "This conversation is an invoice" — reading a thread and proposing a record.
 *
 * MAIL FETCHES THE CONVERSATION AND ACCOUNTING READS IT, and that split is the
 * whole architecture. Message bodies are not in our database, and a mailbox is
 * private to one person by RLS (`0043`), so only the mailbox's owner can obtain
 * the text — through their own connection, which is mail's job. The extension
 * is handed the text; it never goes looking. See
 * `src/lib/mail-extensions/types.ts`.
 *
 * Nothing here posts to a ledger. `accept` produces a DRAFT, which the ordinary
 * lifecycle then edits, issues or approves.
 */

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<MailExtensionCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "email");
  if (ctx.role === "expert") {
    throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof MailError)) console.error("thread draft action failed", err);
  return { error: friendlyMessage(err) };
}

/** Which drafters this tenant has, for rendering the buttons. */
export async function listThreadDraftersAction(): Promise<
  ActionResult<Array<{ extensionSlug: string; kind: string; label: string }>>
> {
  try {
    const ctx = await gate();
    const extensions = await enabledMailExtensions(ctx.tenantId);
    return {
      ok: true,
      data: draftersFrom(extensions).map(({ extension, drafter }) => ({
        extensionSlug: extension.slug,
        kind: drafter.kind,
        label: drafter.label,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

const draftSchema = z.object({
  mailboxId: z.string().uuid(),
  threadId: z.string().min(1).max(200),
  extensionSlug: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  kind: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
});

/**
 * The conversation as a drafter sees it: oldest first, plain text, capped.
 *
 * Prefers the text part and falls back to flattening the HTML — the same
 * `htmlToText` that builds a filed message's transcript, so what the model
 * reads is what the search index would have held.
 */
function toDraftableThread(
  subject: string,
  emails: ReadonlyArray<{
    from: Array<{ name: string | null; email: string }> | null;
    receivedAt: Date | null;
    textBody: string | null;
    htmlBody: string | null;
  }>,
): DraftableThread {
  const messages = emails
    .map((e) => {
      const text = (e.textBody ?? "").trim() || htmlToText(e.htmlBody ?? "");
      return {
        from: e.from?.[0]?.email ?? "",
        // Bookkeeping dates are plain yyyy-mm-dd everywhere in this product;
        // the model is told a date, not an instant.
        date: e.receivedAt ? e.receivedAt.toISOString().slice(0, 10) : "",
        text: text.trim(),
      };
    })
    .filter((m) => m.text !== "")
    // Oldest first: an agreement is the end of a conversation, and the model
    // is told the ordering so it can weigh the last word most heavily.
    .sort((a, b) => a.date.localeCompare(b.date));
  return { subject, messages };
}

export async function draftFromThreadAction(
  input: z.infer<typeof draftSchema>,
): Promise<ActionResult<DraftedRecord>> {
  try {
    const ctx = await gate();
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const extensions = await enabledMailExtensions(ctx.tenantId);
    const found = findDrafter(extensions, parsed.data.extensionSlug, parsed.data.kind);
    if (!found) throw new MailError("LINK_TYPE_UNKNOWN", "no such drafter");

    // The mailbox id is a CLAIM. `loadConnection` reads under the caller's own
    // per-user RLS context, so a colleague's mailbox resolves to nothing here
    // exactly as an invented one does.
    const account = await loadConnection(
      ctx.tenantId,
      ctx.userId,
      parsed.data.mailboxId,
    );
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    const thread = await client.data.getThread(parsed.data.threadId);
    if (!thread.ok || thread.data.emails.length === 0) {
      throw new MailError("THREAD_NOT_FOUND", "thread has no readable messages");
    }

    const draftable = toDraftableThread(
      thread.data.emails[0]?.subject ?? "",
      thread.data.emails,
    );
    if (draftable.messages.length === 0) {
      throw new MailError("THREAD_NOT_FOUND", "thread has no readable text");
    }

    const record = await withTenant(ctx.tenantId, (tx) =>
      found.drafter.draft(tx, ctx, draftable),
    );
    if (!record) return { error: "Nothing to draft from this conversation." };

    // Audited: an AI read somebody's correspondence. Identifiers and counts
    // only — never the text, the quotes, or an address (S9).
    await withTenant(ctx.tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "mail.thread_drafted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "mail_thread",
        targetId: parsed.data.threadId,
        meta: {
          kind: parsed.data.kind,
          messages: draftable.messages.length,
          lines: record.lines.length,
          unverified: record.lines.filter((l) => !l.citation?.verified).length,
        },
      }),
    );
    return { ok: true, data: record };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The reviewed record, re-validated. Everything here has been through a
 * browser, so none of it is trusted — the drafter re-resolves the party and
 * re-parses every figure.
 */
const acceptSchema = z.object({
  extensionSlug: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  record: z.object({
    kind: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    partyId: z.string().uuid().nullable(),
    partyName: z.string().max(200),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    lines: z
      .array(
        z.object({
          description: z.string().max(500),
          quantity: z.string().max(20),
          unitPriceCents: z.number().int(),
          citation: z
            .object({
              messageIndex: z.number().int(),
              quote: z.string().max(500),
              verified: z.boolean(),
            })
            .nullable(),
        }),
      )
      .max(40),
    caveats: z.array(z.string().max(500)).max(20),
  }),
});

export async function acceptThreadDraftAction(
  input: z.infer<typeof acceptSchema>,
): Promise<ActionResult<{ entityType: string; entityId: string }>> {
  try {
    const ctx = await gate();
    const parsed = acceptSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const extensions = await enabledMailExtensions(ctx.tenantId);
    const found = findDrafter(
      extensions,
      parsed.data.extensionSlug,
      parsed.data.record.kind,
    );
    if (!found) throw new MailError("LINK_TYPE_UNKNOWN", "no such drafter");

    const ref = await withTenant(ctx.tenantId, async (tx) => {
      const created = await found.drafter.accept(tx, ctx, parsed.data.record);
      await logAuditInTx(tx, {
        action: "mail.thread_draft_accepted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: created.entityType,
        targetId: created.entityId,
        meta: {
          lines: parsed.data.record.lines.length,
          unverifiedAccepted: parsed.data.record.lines.filter(
            (l) => !l.citation?.verified,
          ).length,
        },
      });
      return created;
    });

    return { ok: true, data: ref };
  } catch (err) {
    return fail(err);
  }
}
