"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { DocsError, friendlyMessage } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import { SEARCH_QUERY_MAX } from "./search";
import { createSavedView, deleteSavedView } from "./saved-views";

/** Saved views: naming the filter you just built so you can come back to it. */

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
  console.error("saved view action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(BASE, "layout");
}

/**
 * Mirrors savedViewQuerySchema, but as a strict boundary parser: a client may
 * only ever propose these four fields, and the ops layer re-parses whatever
 * arrives before it is stored.
 */
const createSchema = z.object({
  name: z.string().min(1).max(60),
  scope: z.enum(["tenant", "private"]).default("tenant"),
  query: z.object({
    q: z.string().max(SEARCH_QUERY_MAX).optional(),
    folderId: z.string().uuid().optional(),
    tags: z.array(z.string().max(64)).max(10).optional(),
    origin: z.enum(["dms", "accounting"]).optional(),
  }),
});

export async function createSavedViewAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ viewId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const view = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createSavedView(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.view_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_saved_view",
          targetId: created.id,
          meta: { scope: created.scope },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { viewId: view.id } };
  } catch (err) {
    return fail(err);
  }
}

const deleteSchema = z.object({ viewId: z.string().uuid() });

export async function deleteSavedViewAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await deleteSavedView(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.view_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_saved_view",
          targetId: parsed.data.viewId,
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
