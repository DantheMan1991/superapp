"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "./core/errors";
import { mailViewSchema } from "./organise/filters";
import {
  createSavedSearch,
  deleteSavedSearch,
  type SavedSearchEntry,
} from "./organise/saved-searches";
import { snoozeMessages, type SnoozeOutcome } from "./triage/snooze";
import { isAcceptableDueAt } from "./triage/snooze-times";

/**
 * Organising: bulk actions, folders, saved searches.
 *
 * Same shape as the module's other actions. The one thing worth reading is how
 * partial success is reported — a bulk operation over hundreds of messages can
 * genuinely half-succeed, and saying "done" when 300 of 900 moved is the kind
 * of lie that costs somebody an afternoon looking for their mail.
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
  if (!(err instanceof MailError)) console.error("mail organise action failed", err);
  return { error: friendlyMessage(err) };
}

async function clientFor(ctx: MailCtx, mailboxId: string) {
  // The mailbox id is a claim; RLS is what proves it.
  const account = await loadConnection(ctx.tenantId, ctx.userId, mailboxId);
  if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");
  const client = await authorizedClient(account);
  if (!client.ok) {
    throw new MailError(
      client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
      client.message,
    );
  }
  return { account, client: client.data };
}

/**
 * The cap on one bulk operation.
 *
 * Well above `maxObjectsInSet` (500) because the client chunks — this bounds the
 * REQUEST rather than the protocol call, so a runaway selection cannot turn one
 * action into a hundred round trips.
 */
const BULK_MAX = 2_000;

const bulkSchema = z.object({
  mailboxId: z.string().uuid(),
  emailIds: z.array(z.string().min(1).max(255)).min(1).max(BULK_MAX),
  action: z.enum(["read", "unread", "flag", "unflag", "move"]),
  /** Required for `move`; ignored otherwise. */
  targetMailboxId: z.string().min(1).max(255).optional(),
});

export interface BulkOutcome {
  updated: number;
  failed: number;
  requested: number;
}

/**
 * Apply one action to many messages.
 *
 * Archive, trash and junk are all `move` — the mail server owns where a message
 * lives, and a second opinion here would be a second thing to be wrong.
 */
export async function bulkAction(
  input: z.infer<typeof bulkSchema>,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const ctx = await gate();
    const parsed = bulkSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const data = parsed.data;

    if (data.action === "move" && !data.targetMailboxId) {
      throw new MailError("MAILBOX_NOT_FOUND", "move without a target");
    }

    const { client } = await clientFor(ctx, data.mailboxId);

    const result =
      data.action === "move"
        ? await client.moveToMailbox(data.emailIds, data.targetMailboxId!)
        : await client.setKeyword(
            data.emailIds,
            data.action === "flag" || data.action === "unflag"
              ? KEYWORD_FLAGGED
              : KEYWORD_SEEN,
            data.action === "read" || data.action === "flag",
          );
    if (!result.ok) return { error: result.message };

    const updated = result.data.updated.length;
    const failed = data.emailIds.length - updated;

    await logAudit({
      action: "mail.bulk_action",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: data.mailboxId,
      // Counts, never ids or subjects (S9).
      meta: { op: data.action, requested: data.emailIds.length, updated },
    });

    revalidatePath(BASE);
    return {
      ok: true,
      data: { updated, failed, requested: data.emailIds.length },
    };
  } catch (err) {
    return fail(err);
  }
}

const folderSchema = z.object({
  mailboxId: z.string().uuid(),
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).max(255).nullable().default(null),
});

export async function createFolderAction(
  input: z.infer<typeof folderSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = folderSchema.safeParse(input);
    if (!parsed.success) throw new MailError("FOLDER_NAME_INVALID", "bad input");
    const name = parsed.data.name.trim();
    if (name.length === 0) throw new MailError("FOLDER_NAME_INVALID", "blank");

    const { client } = await clientFor(ctx, parsed.data.mailboxId);
    const created = await client.createMailbox(name, parsed.data.parentId);
    if (!created.ok) return { error: created.message };

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const renameSchema = z.object({
  mailboxId: z.string().uuid(),
  folderId: z.string().min(1).max(255),
  name: z.string().min(1).max(120),
});

export async function renameFolderAction(
  input: z.infer<typeof renameSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = renameSchema.safeParse(input);
    if (!parsed.success) throw new MailError("FOLDER_NAME_INVALID", "bad input");
    const name = parsed.data.name.trim();
    if (name.length === 0) throw new MailError("FOLDER_NAME_INVALID", "blank");

    const { client } = await clientFor(ctx, parsed.data.mailboxId);

    // A role folder is refused HERE rather than trusting the UI to hide the
    // option. Roles are how archive, trash, sent and drafts are resolved
    // throughout the module — renaming one does not break its name, it breaks
    // every lookup that depends on it. The server may allow it; we do not.
    const folders = await client.listMailboxes();
    if (!folders.ok) return { error: folders.message };
    const target = folders.data.find((f) => f.id === parsed.data.folderId);
    if (!target) throw new MailError("MAILBOX_NOT_FOUND", "no such folder");
    if (target.role !== null) throw new MailError("FOLDER_PROTECTED", target.role);

    const renamed = await client.renameMailbox(parsed.data.folderId, name);
    if (!renamed.ok) return { error: renamed.message };

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const saveSchema = z.object({
  mailboxId: z.string().uuid(),
  name: z.string().min(1).max(60),
  query: mailViewSchema,
});

export async function saveSearchAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<SavedSearchEntry>> {
  try {
    const ctx = await gate();
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) throw new MailError("SEARCH_NAME_INVALID", "bad input");

    const account = await loadConnection(
      ctx.tenantId,
      ctx.userId,
      parsed.data.mailboxId,
    );
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const entry = await withTenant(
      ctx.tenantId,
      (tx) =>
        createSavedSearch(tx, ctx, {
          mailAccountId: account.id,
          name: parsed.data.name,
          query: parsed.data.query,
        }),
      // `{ userId }` is not optional here: 0048 scopes the row to one person,
      // and the WITH CHECK would refuse the insert without it.
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true, data: entry };
  } catch (err) {
    return fail(err);
  }
}

const deleteSearchSchema = z.object({ searchId: z.string().uuid() });

export async function deleteSearchAction(
  input: z.infer<typeof deleteSearchSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = deleteSearchSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => deleteSavedSearch(tx, ctx.tenantId, parsed.data.searchId),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const snoozeSchema = z.object({
  mailboxId: z.string().uuid(),
  emailIds: z.array(z.string().min(1).max(255)).min(1).max(BULK_MAX),
  /**
   * An absolute instant, resolved in the BROWSER.
   *
   * "Tomorrow morning" is a statement about the user's calendar, and this
   * server's clock is UTC — resolving it here would wake a message at 08:00
   * UTC, the middle of the night for a good share of the people being
   * reminded. The timezone is not in the request and is not worth putting
   * there, so the client sends the answer and the server only bounds it.
   */
  dueAt: z.string().datetime(),
  /** Where it goes back to. Usually the inbox, but not necessarily. */
  returnToMailboxId: z.string().min(1).max(255),
});

/**
 * Put messages out of sight until a date.
 *
 * The mail really moves, into a folder called Snoozed on the mail server —
 * triage/snooze.ts explains why hiding it in this list instead would have been
 * a fraction of the code and quietly wrong.
 */
export async function snoozeAction(
  input: z.infer<typeof snoozeSchema>,
): Promise<ActionResult<SnoozeOutcome>> {
  try {
    const ctx = await gate();
    const parsed = snoozeSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const dueAt = new Date(parsed.data.dueAt);
    // Bounded, not corrected. A time already gone means a broken client, and
    // silently rewriting it to "now" would move somebody's mail into a folder
    // and straight back out — which reads as the feature flickering rather
    // than as a bug worth reporting.
    if (!isAcceptableDueAt(dueAt, new Date())) {
      return { error: "Pick a time in the future, within the next year." };
    }

    const { account, client } = await clientFor(ctx, parsed.data.mailboxId);
    const result = await snoozeMessages({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role: ctx.role,
      account,
      client,
      emailIds: parsed.data.emailIds,
      returnToMailboxId: parsed.data.returnToMailboxId,
      dueAt,
    });
    if (!result.ok) return { error: result.message };

    await logAudit({
      action: "mail.snooze",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: parsed.data.mailboxId,
      // Counts and a time, never ids or subjects (S9).
      meta: {
        requested: parsed.data.emailIds.length,
        moved: result.data.moved,
        dueAt: dueAt.toISOString(),
      },
    });

    revalidatePath(BASE);
    return { ok: true, data: result.data };
  } catch (err) {
    return fail(err);
  }
}
