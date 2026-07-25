"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { DocsError, friendlyMessage } from "./core/errors";
import { FOLDER_NAME_MAX } from "./core/tree";
import {
  createFolder,
  deleteFolder,
  moveFolder,
  renameFolder,
  setFolderVisibility,
  type DocsCtx,
} from "./folder-ops";
import {
  disableFolderInbound,
  enableFolderInbound,
  folderInboundAddress,
} from "./inbound";

/**
 * Server actions for the Documents module. Canonical shape, same as the
 * accounting slices: gate → Zod → withTenant(core + audit) → revalidate.
 *
 * The one addition is that every withTenant call passes the caller's role, so
 * the RLS policy can apply folder visibility. Forgetting it does not open a
 * hole — the GUC defaults to 'staff' — it just denies an owner a row they
 * should have seen.
 */

const BASE = "/dashboard/m/documents";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(opts?: { ownerOnly?: boolean }): Promise<DocsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");
  // Fail closed for the expert (accountant) role: this module has no
  // read-only-safe writes, so there is nothing to opt into.
  if (ctx.role === "expert") {
    throw new DocsError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (opts?.ownerOnly && ctx.role !== "owner") {
    throw new DocsError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof DocsError) return { error: friendlyMessage(err) };
  console.error("documents action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/browse`);
}

const folderName = z.string().min(1).max(FOLDER_NAME_MAX);
const visibility = z.enum(["members", "owners"]);

const createSchema = z.object({
  parentId: z.string().uuid().nullable(),
  name: folderName,
  visibility: visibility.default("members"),
});

export async function createFolderAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ folderId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const folder = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createFolder(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.folder_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: created.id,
          meta: {
            parentId: parsed.data.parentId,
            visibility: created.visibility,
            depth: created.depth,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { folderId: folder.id } };
  } catch (err) {
    return fail(err);
  }
}

const renameSchema = z.object({
  folderId: z.string().uuid(),
  name: folderName,
  expectedVersion: z.number().int().min(1),
});

export async function renameFolderAction(
  input: z.infer<typeof renameSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = renameSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const folder = await renameFolder(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.folder_renamed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: folder.id,
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

const moveSchema = z.object({
  folderId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().min(1),
});

export async function moveFolderAction(
  input: z.infer<typeof moveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await moveFolder(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.folder_moved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: parsed.data.folderId,
          meta: {
            newParentId: parsed.data.newParentId,
            foldersMoved: result.foldersMoved,
          },
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

const visibilitySchema = z.object({
  folderId: z.string().uuid(),
  visibility,
  expectedVersion: z.number().int().min(1),
});

export async function setFolderVisibilityAction(
  input: z.infer<typeof visibilitySchema>,
): Promise<ActionResult<{ foldersUpdated: number; documentsUpdated: number }>> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = visibilitySchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const counts = await setFolderVisibility(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.folder_visibility_changed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: parsed.data.folderId,
          // Counts, never names: the audit log records that access changed and
          // how far it reached, not what is inside the folder.
          meta: { visibility: parsed.data.visibility, ...counts },
        });
        return counts;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

const inboundSchema = z.object({ folderId: z.string().uuid() });

/**
 * Give a folder its own email address, so a subcontractor can send drawings
 * straight into it.
 *
 * Owner-only: it is an anonymous write surface — anyone who learns the address
 * can put files in that folder — so switching one on is not a staff decision.
 */
export async function enableFolderInboundAction(
  input: z.infer<typeof inboundSchema>,
): Promise<ActionResult<{ address: string }>> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = inboundSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const domain = process.env.INBOUND_EMAIL_DOMAIN;
    if (!domain) {
      return {
        error: "Email receiving isn't configured — add INBOUND_EMAIL_DOMAIN. See SETUP.md.",
      };
    }

    const token = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const value = await enableFolderInbound(tx, ctx.tenantId, parsed.data.folderId);
        await logAuditInTx(tx, {
          action: "documents.folder_inbound_enabled",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: parsed.data.folderId,
          // Never the token — it is the credential.
          meta: {},
        });
        return value;
      },
      { role: ctx.role },
    );

    revalidate();
    return { ok: true, data: { address: folderInboundAddress(token, domain) } };
  } catch (err) {
    return fail(err);
  }
}

export async function disableFolderInboundAction(
  input: z.infer<typeof inboundSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = inboundSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await disableFolderInbound(tx, ctx.tenantId, parsed.data.folderId);
        await logAuditInTx(tx, {
          action: "documents.folder_inbound_disabled",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: parsed.data.folderId,
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

const deleteSchema = z.object({
  folderId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  strategy: z.enum(["refuse", "move_to_parent"]).default("refuse"),
});

export async function deleteFolderAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<{ movedFolders: number; movedDocuments: number }>> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const counts = await deleteFolder(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.folder_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_folder",
          targetId: parsed.data.folderId,
          meta: { strategy: parsed.data.strategy, ...counts },
        });
        return counts;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}
