"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { loadConnection, authorizedClient } from "@/lib/email/oauth/accounts";
import {
  enabledMailExtensions,
  entityTypeIndex,
  filingTargetFor,
  searchLinkTargets,
  type SearchGroup,
} from "@/lib/mail-extensions/resolve";
import type { MailExtensionCtx } from "@/lib/mail-extensions/types";
import { MailError, friendlyMessage } from "./core/errors";
import { buildFiledMessage } from "./filing";
import { deleteLink, insertLink } from "./links";

/**
 * Attaching a conversation to something the business cares about — and the one
 * action in this module that writes more than a keyword.
 *
 * THE DECISION THIS FILE IMPLEMENTS, settled with the founder and written up in
 * docs/modules/email.md: **linking COPIES the message into the tenant's space;
 * it does not point at the mailbox.** A mailbox is private to one person (RLS
 * 0043) and `mail_thread_index` holds no bodies, so a bare link would show a
 * colleague "a thread called X, with these people, last Tuesday" and nothing
 * readable. So the message and its attachments are filed into Documents first,
 * and the link points at that copy.
 *
 * Which makes this an act of PUBLISHING, and the shape of the code says so:
 * every step is explicit, the copy is a point-in-time snapshot rather than a
 * live view, and the audit row naming who published what commits inside the same
 * transaction as the link.
 */

const BASE = "/dashboard/m/email";

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
  if (!(err instanceof MailError)) console.error("mail link action failed", err);
  return { error: friendlyMessage(err) };
}

const searchSchema = z.object({
  query: z.string().min(1).max(120),
});

/**
 * What this conversation could be attached to.
 *
 * Runs every enabled extension's `search` inside ONE `withTenant`, so each of
 * them sees exactly what the person asking is allowed to see and nothing more.
 * That is invariant S12 in practice: an extension is handed the caller's
 * transaction, never its own, so it cannot widen its own visibility.
 */
export async function searchLinkTargetsAction(
  input: z.infer<typeof searchSchema>,
): Promise<ActionResult<SearchGroup[]>> {
  try {
    const ctx = await gate();
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const extensions = await enabledMailExtensions(ctx.tenantId);
    const groups = await withTenant(
      ctx.tenantId,
      (tx) => searchLinkTargets(tx, ctx, extensions, parsed.data.query),
      { role: ctx.role, userId: ctx.userId },
    );
    return { ok: true, data: groups };
  } catch (err) {
    return fail(err);
  }
}

const linkSchema = z.object({
  mailboxId: z.string().uuid(),
  emailId: z.string().min(1).max(200),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  entityId: z.string().uuid(),
});

export interface LinkOutcome {
  /** For the toast: "Filed and attached", or "Already filed — attached." */
  alreadyFiled: boolean;
  attachmentsFiled: number;
  /** Allowlist refusals plus anything mail declined to download. */
  attachmentsSkipped: number;
  destinationLabel: string;
}

/**
 * Attach this message's conversation to a record, filing a copy on the way.
 *
 * The order is the design. Everything that talks to a network happens before any
 * transaction opens; the two writes at the end are small and local.
 */
export async function linkThreadAction(
  input: z.infer<typeof linkSchema>,
): Promise<ActionResult<LinkOutcome>> {
  try {
    const ctx = await gate();
    const parsed = linkSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const extensions = await enabledMailExtensions(ctx.tenantId);

    // The target type must belong to a module this tenant has switched on.
    // Unknown types are refused rather than stored: `mail_links.entity_type`
    // carries no whitelist so a future layer needs no migration, and this is
    // where that openness is bounded — by what is registered, at write time.
    const registered = entityTypeIndex(extensions).get(parsed.data.entityType);
    if (!registered) throw new MailError("LINK_TYPE_UNKNOWN", parsed.data.entityType);

    const filer = filingTargetFor(extensions);
    if (!filer?.filing) throw new MailError("FILING_UNAVAILABLE", "no filing target");

    // The mailbox id is a CLAIM. `loadConnection` reads under the caller's own
    // per-user RLS context, so a colleague's mailbox resolves to nothing here
    // exactly as an invented one does.
    const account = await loadConnection(
      ctx.tenantId,
      ctx.userId,
      parsed.data.mailboxId,
    );
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    // Prove the target exists and is visible to this caller BEFORE fetching a
    // message and writing bytes. A link to something they cannot see would be a
    // published copy nobody asked for.
    const target = await withTenant(
      ctx.tenantId,
      (tx) => registered.entityType.resolve(tx, ctx, [parsed.data.entityId]),
      { role: ctx.role, userId: ctx.userId },
    );
    if (target.length === 0) {
      throw new MailError("LINK_TARGET_NOT_FOUND", parsed.data.entityId);
    }

    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    const fetched = await client.data.getEmails([parsed.data.emailId], true);
    if (!fetched.ok) throw new MailError("MAIL_SERVER_UNREACHABLE", fetched.message);
    const message = fetched.data[0];
    if (!message) throw new MailError("MESSAGE_NOT_FOUND", parsed.data.emailId);

    // The thread id comes from the MESSAGE, never from the client. Accepting one
    // would let a caller file this message under a conversation it is not part
    // of, which is a quiet way to attach the wrong correspondence to an invoice.
    const threadId = message.threadId;
    if (!threadId) throw new MailError("THREAD_NOT_FOUND", parsed.data.emailId);

    const built = await buildFiledMessage(client.data, message);
    const filed = await filer.filing.fileMessage(ctx, built.input);

    // Two links, one transaction: the thread to the record somebody chose, and
    // the thread to the filed copy. The second is what a colleague opening the
    // invoice can actually read — the first on its own would be a pointer into
    // a mailbox they have no credential for.
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await insertLink(tx, ctx, {
          mailAccountId: account.id,
          threadId,
          extensionSlug: registered.extension.slug,
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
        });
        await insertLink(tx, ctx, {
          mailAccountId: account.id,
          threadId,
          extensionSlug: filer.slug,
          entityType: filed.entityType,
          entityId: filed.entityId,
        });
        // In-transaction, not fire-and-forget. This is the record of one person
        // publishing another person's inbox contents to their colleagues; it
        // must not be able to go missing while the links commit. Identifiers and
        // counts only — no subject, no address (S9).
        await logAuditInTx(tx, {
          action: "mail.thread_linked",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: parsed.data.entityType,
          targetId: parsed.data.entityId,
          meta: {
            mailAccountId: account.id,
            threadId,
            messageId: message.id,
            filedDocumentId: filed.entityId,
            alreadyFiled: filed.alreadyFiled,
          },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    if (target[0].href) revalidatePath(target[0].href);
    return {
      ok: true,
      data: {
        alreadyFiled: filed.alreadyFiled,
        attachmentsFiled: filed.attachmentsFiled,
        attachmentsSkipped: filed.attachmentsRejected + built.skipped,
        destinationLabel: filer.filing.destinationLabel,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const unlinkSchema = z.object({ linkId: z.string().uuid() });

/**
 * Detach a conversation from a record. **The filed copy stays.**
 *
 * Deliberate, and recorded as a decision rather than left as behaviour:
 * "this email is not about that invoice after all" and "destroy this record of
 * correspondence" are different intentions, and only one of them was expressed.
 * The copy lives in Documents under Documents' own rules, and Documents already
 * has a delete — with a trash, a restore and an audit trail — which is a better
 * place for that decision than a chip on a message.
 */
export async function unlinkThreadAction(
  input: z.infer<typeof unlinkSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = unlinkSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const removed = await deleteLink(tx, ctx.tenantId, parsed.data.linkId);
        // RLS already scoped the delete to this tenant, so a miss means gone or
        // never theirs — the same answer either way.
        if (!removed) throw new MailError("LINK_NOT_FOUND", parsed.data.linkId);
        await logAuditInTx(tx, {
          action: "mail.thread_unlinked",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: removed.entityType,
          targetId: removed.entityId,
          meta: { threadId: removed.threadId, linkId: removed.id },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
