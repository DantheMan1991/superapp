"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { DocsError, friendlyMessage } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import { TAG_NAME_MAX, TAGS_PER_DOCUMENT_MAX, diffTags } from "./core/tags";
import { createTag, deleteTag, setDocumentTags, updateTag } from "./tag-ops";

/**
 * The tag registry and per-document tagging.
 *
 * Deleting a tag is owner-only and the gate enforces it here as well as in
 * tag-ops: the operation sweeps documents across the whole tenant, and RLS
 * hides owners-only ones from staff.
 */

const BASE = "/dashboard/m/documents";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(opts?: { ownerOnly?: boolean }): Promise<DocsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");
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
  console.error("tag action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(`${BASE}/tags`);
  revalidatePath(`${BASE}/browse`);
  revalidatePath(`${BASE}/inbox`);
  revalidatePath(`${BASE}/search`);
}

const createSchema = z.object({
  name: z.string().min(1).max(TAG_NAME_MAX),
  color: z.string().max(32).default(""),
});

export async function createTagAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ tagId: string; slug: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const tag = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createTag(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.tag_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_tag",
          targetId: created.id,
          meta: { slug: created.slug },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { tagId: tag.id, slug: tag.slug } };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  tagId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  name: z.string().min(1).max(TAG_NAME_MAX).optional(),
  color: z.string().max(32).optional(),
});

export async function updateTagAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const tag = await updateTag(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.tag_updated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_tag",
          targetId: tag.id,
          // The slug is unchanged by design — recording it makes that visible
          // in the log rather than implied.
          meta: { slug: tag.slug },
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
  tagId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function deleteTagAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<{ documentsUpdated: number }>> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const deleted = await deleteTag(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.tag_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_tag",
          targetId: parsed.data.tagId,
          meta: {
            slug: deleted.slug,
            documentsUpdated: deleted.documentsUpdated,
          },
        });
        return deleted;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { documentsUpdated: result.documentsUpdated } };
  } catch (err) {
    return fail(err);
  }
}

const setSchema = z.object({
  documentId: z.string().uuid(),
  slugs: z.array(z.string().max(64)).max(TAGS_PER_DOCUMENT_MAX),
});

export async function setDocumentTagsAction(
  input: z.infer<typeof setSchema>,
): Promise<ActionResult<{ tags: string[] }>> {
  try {
    const ctx = await gate();
    const parsed = setSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const changed = await setDocumentTags(tx, ctx, parsed.data);
        const delta = diffTags(changed.before, changed.after);
        await logAuditInTx(tx, {
          action: "documents.tags_set",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentId,
          // Slugs are a controlled vocabulary the business chose, not file
          // contents — safe to record, and useless without them.
          meta: { added: delta.added, removed: delta.removed },
        });
        return changed;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { tags: result.after } };
  } catch (err) {
    return fail(err);
  }
}
