"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { sendEmail } from "@/lib/email/send";
import { isShareSecretConfigured } from "@/lib/public-token";
import { DocsError, friendlyMessage } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import {
  createShare,
  loadShare,
  resetShareLock,
  revokeShare,
} from "./shares/shares";

/**
 * Tenant-side share management. The public surface lives in
 * src/app/s/[token]/.
 */

const BASE = "/dashboard/m/documents";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<DocsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");
  if (ctx.role === "expert") {
    throw new DocsError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof DocsError) return { error: friendlyMessage(err) };
  if (err instanceof Error && err.message.includes("SHARE_SECRET")) {
    return {
      error: "Sharing isn't configured yet — add SHARE_SECRET. See SETUP.md.",
    };
  }
  console.error("share action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(`${BASE}/shares`);
  revalidatePath(`${BASE}/browse`);
}

const createSchema = z.object({
  scope: z.enum(["document", "folder"]),
  targetId: z.string().uuid(),
  label: z.string().max(120).default(""),
  canDownload: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365),
  passcode: z.string().min(4).max(64).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
});

export async function createShareAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ shareId: string; url: string }>> {
  try {
    if (!isShareSecretConfigured()) {
      throw new Error("SHARE_SECRET is not set");
    }
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const created = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await createShare(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "share.created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_share",
          targetId: result.share.id,
          // Never the token, and never the file's contents or name.
          meta: {
            scope: parsed.data.scope,
            targetId: parsed.data.targetId,
            hasPasscode: Boolean(parsed.data.passcode),
            canDownload: parsed.data.canDownload,
            expiresAt: result.share.expiresAt.toISOString(),
            maxUses: parsed.data.maxUses ?? null,
          },
        });
        return result;
      },
      { role: ctx.role },
    );

    revalidate();
    return {
      ok: true,
      data: {
        shareId: created.share.id,
        url: shareUrl(created.token),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

function shareUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  return `${base}/s/${token}`;
}

const revokeSchema = z.object({
  shareId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function revokeShareAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await revokeShare(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "share.revoked",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_share",
          targetId: parsed.data.shareId,
          meta: {},
        });
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const revealSchema = z.object({ shareId: z.string().uuid() });

/**
 * Decrypt and return the link so an owner can copy it again.
 *
 * This is the reason the ciphertext column exists: a raw token column would be
 * readable by anyone who could read the database, silently. Here the reveal is
 * a deliberate, audited act, and the encryption key lives in the environment
 * rather than beside the data.
 */
export async function revealShareUrlAction(
  input: z.infer<typeof revealSchema>,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await gate();
    const parsed = revealSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const url = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const share = await loadShare(tx, ctx.tenantId, parsed.data.shareId);
        await logAuditInTx(tx, {
          action: "share.url_revealed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_share",
          targetId: share.id,
          meta: {},
        });
        return shareUrl(decryptSecret(share.tokenCiphertext));
      },
      { role: ctx.role },
    );
    return { ok: true, data: { url } };
  } catch (err) {
    return fail(err);
  }
}

const emailSchema = z.object({
  shareId: z.string().uuid(),
  to: z.array(z.string().min(6).max(254)).min(1).max(10),
  message: z.string().max(1000).default(""),
});

/**
 * Email a link instead of copying it.
 *
 * Refuses outright when the link has a passcode. A link and the passcode that
 * opens it in the same message is not two factors — it is one factor and a
 * longer email. The owner delivers the passcode by phone or text.
 */
export async function emailShareAction(
  input: z.infer<typeof emailSchema>,
): Promise<ActionResult<{ sent: number; sentFrom: string }>> {
  try {
    const ctx = await gate();
    const parsed = emailSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const prepared = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const share = await loadShare(tx, ctx.tenantId, parsed.data.shareId);
        if (share.passcodeHash) {
          throw new DocsError(
            "SHARE_HAS_PASSCODE",
            "cannot email a passcode-protected link",
          );
        }
        if (share.revokedAt) {
          throw new DocsError("SHARE_NOT_FOUND", "link is off");
        }
        return {
          url: shareUrl(decryptSecret(share.tokenCiphertext)),
          label: share.label,
          expiresAt: share.expiresAt,
        };
      },
      { role: ctx.role },
    );

    const tenantName = (await requireTenant()).tenant.name;
    let sent = 0;
    let sentFrom = "";
    for (const recipient of parsed.data.to) {
      const result = await sendEmail({
        tenantId: ctx.tenantId,
        kind: "share_link",
        to: recipient,
        subject: `${tenantName} shared "${prepared.label}" with you`,
        text: buildShareEmail({
          tenantName,
          label: prepared.label,
          url: prepared.url,
          message: parsed.data.message,
          expiresAt: prepared.expiresAt,
        }),
        // Derived from what the message IS, so a double-click or a retry
        // cannot send the same person the same link twice.
        idempotencyKey: `share:${parsed.data.shareId}:${recipient.toLowerCase()}`,
      });
      if (result.ok) {
        sent += 1;
        sentFrom = result.sentAs.fromAddress;
      } else if (result.reason !== "invalid_recipient") {
        return { error: result.message };
      }
    }

    await withTenant(
      ctx.tenantId,
      (tx) =>
        logAuditInTx(tx, {
          action: "share.emailed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_share",
          targetId: parsed.data.shareId,
          // Count, not addresses: recipients are third-party contacts and the
          // audit log is identifiers-only. The addresses live in the send log.
          meta: { recipientCount: sent },
        }),
      { role: ctx.role },
    );

    revalidate();
    return { ok: true, data: { sent, sentFrom } };
  } catch (err) {
    return fail(err);
  }
}

function buildShareEmail(input: {
  tenantName: string;
  label: string;
  url: string;
  message: string;
  expiresAt: Date;
}): string {
  const expires = input.expiresAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return [
    `${input.tenantName} has shared "${input.label}" with you.`,
    "",
    ...(input.message ? [input.message, ""] : []),
    input.url,
    "",
    `This link stops working on ${expires}.`,
    "",
    `Sent by ${input.tenantName}.`,
  ].join("\n");
}

export async function resetShareLockAction(
  input: z.infer<typeof revealSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = revealSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await resetShareLock(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "share.unlock_reset",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_share",
          targetId: parsed.data.shareId,
          meta: {},
        });
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
