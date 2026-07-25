"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
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
