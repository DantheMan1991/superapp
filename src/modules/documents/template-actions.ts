"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { DocsError, friendlyMessage } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import { FIELD_NAME_MAX, FIELDS_PER_TEMPLATE_MAX } from "./doc-templates/merge";
import {
  createTemplate,
  publishDraft,
  saveDraft,
  setTemplateArchived,
  TEMPLATE_BODY_MAX,
  TEMPLATE_NAME_MAX,
} from "./doc-templates/template-ops";

/** Document templates. Folder templates are a different thing entirely. */

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
  console.error("template action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(templateId?: string): void {
  revalidatePath(`${BASE}/templates`);
  if (templateId) revalidatePath(`${BASE}/templates/${templateId}`);
}

const createSchema = z.object({
  name: z.string().min(1).max(TEMPLATE_NAME_MAX),
  description: z.string().max(2000).default(""),
  docKind: z.string().max(64).default(""),
});

export async function createTemplateAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ templateId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const created = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await createTemplate(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.template_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_template",
          targetId: result.template.id,
          meta: { docKind: parsed.data.docKind },
        });
        return result;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { templateId: created.template.id } };
  } catch (err) {
    return fail(err);
  }
}

const saveSchema = z.object({
  templateId: z.string().uuid(),
  body: z.string().max(TEMPLATE_BODY_MAX),
  fields: z
    .array(
      z.object({
        name: z.string().max(FIELD_NAME_MAX),
        label: z.string().max(120),
        required: z.boolean(),
      }),
    )
    .max(FIELDS_PER_TEMPLATE_MAX)
    .optional(),
});

export async function saveTemplateDraftAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ versionNo: number }>> {
  try {
    const ctx = await gate();
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const draft = await withTenant(
      ctx.tenantId,
      (tx) => saveDraft(tx, ctx, parsed.data),
      { role: ctx.role },
    );
    revalidate(parsed.data.templateId);
    // No audit entry: a draft save is a keystroke, not an event. Publishing is
    // the moment worth recording, and it is recorded below.
    return { ok: true, data: { versionNo: draft.versionNo } };
  } catch (err) {
    return fail(err);
  }
}

const publishSchema = z.object({ templateId: z.string().uuid() });

export async function publishTemplateAction(
  input: z.infer<typeof publishSchema>,
): Promise<ActionResult<{ versionNo: number }>> {
  try {
    const ctx = await gate();
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const published = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const version = await publishDraft(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "documents.template_published",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_template",
          targetId: parsed.data.templateId,
          // The version number is the point: it is what a generated document
          // will name when someone asks what the waiver said that day.
          meta: { versionNo: version.versionNo },
        });
        return version;
      },
      { role: ctx.role },
    );
    revalidate(parsed.data.templateId);
    return { ok: true, data: { versionNo: published.versionNo } };
  } catch (err) {
    return fail(err);
  }
}

const archiveSchema = z.object({
  templateId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  archived: z.boolean(),
});

export async function archiveTemplateAction(
  input: z.infer<typeof archiveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await setTemplateArchived(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: parsed.data.archived
            ? "documents.template_archived"
            : "documents.template_restored",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document_template",
          targetId: parsed.data.templateId,
          meta: {},
        });
      },
      { role: ctx.role },
    );
    revalidate(parsed.data.templateId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
