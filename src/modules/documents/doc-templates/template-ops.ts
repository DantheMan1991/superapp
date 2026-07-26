import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentTemplate, DocumentTemplateVersion } from "@/db/schema";
import { DocsError } from "../core/errors";
import type { DocsCtx } from "../folder-ops";
import {
  extractMergeFields,
  FIELDS_PER_TEMPLATE_MAX,
  isValidFieldName,
} from "./merge";

/**
 * Document template storage.
 *
 * The rule the whole file is built around: **a published version is frozen.**
 * Editing a published template produces a new DRAFT version; the published one
 * is never touched. That is what makes "the waiver we sent in March said this"
 * answerable in the argument where it matters, and it is why generation (PR 11)
 * will record which version_no it used.
 *
 * At most one draft per template is a database invariant (partial unique on
 * published_at is null), so two people editing the same template converge on
 * the same draft row rather than forking it.
 */

export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_BODY_MAX = 100_000;

/** One declared merge field, as stored in `fields` jsonb. */
export interface TemplateField {
  name: string;
  label: string;
  required: boolean;
}

export function templateNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "client_name" → "Client name", a sane default label. */
export function defaultLabel(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Derive the field list from the BODY, preserving any labels already set.
 *
 * Derived rather than independently editable on purpose: a stored field list
 * that can drift from the body is a list that will eventually promise a field
 * the document never fills, or hide one it does. The body is the truth; labels
 * and required-ness are the only things a human owns here.
 */
export function reconcileFields(
  body: string,
  existing: readonly TemplateField[],
): TemplateField[] {
  const byName = new Map(existing.map((f) => [f.name, f]));
  return extractMergeFields(body).map((name) => {
    const prior = byName.get(name);
    return {
      name,
      label: prior?.label?.trim() || defaultLabel(name),
      required: prior?.required ?? true,
    };
  });
}

/** Parse the jsonb column defensively — it is stored input like any other. */
export function parseFields(raw: unknown): TemplateField[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (!isValidFieldName(name)) continue;
    out.push({
      name,
      label:
        typeof record.label === "string" && record.label.trim()
          ? record.label
          : defaultLabel(name),
      required: record.required !== false,
    });
    if (out.length >= FIELDS_PER_TEMPLATE_MAX) break;
  }
  return out;
}

async function loadTemplate(
  tx: Tx,
  ctx: DocsCtx,
  templateId: string,
): Promise<DocumentTemplate> {
  const row = await tx.query.documentTemplates.findFirst({
    where: and(
      eq(schema.documentTemplates.tenantId, ctx.tenantId),
      eq(schema.documentTemplates.id, templateId),
    ),
  });
  if (!row) throw new DocsError("TEMPLATE_NOT_FOUND", "template not visible");
  return row;
}

export async function listTemplates(
  tx: Tx,
  tenantId: string,
): Promise<DocumentTemplate[]> {
  return tx
    .select()
    .from(schema.documentTemplates)
    .where(eq(schema.documentTemplates.tenantId, tenantId))
    .orderBy(asc(schema.documentTemplates.name));
}

export async function listTemplateVersions(
  tx: Tx,
  tenantId: string,
  templateId: string,
): Promise<DocumentTemplateVersion[]> {
  return tx
    .select()
    .from(schema.documentTemplateVersions)
    .where(
      and(
        eq(schema.documentTemplateVersions.tenantId, tenantId),
        eq(schema.documentTemplateVersions.templateId, templateId),
      ),
    )
    .orderBy(desc(schema.documentTemplateVersions.versionNo));
}

/** The draft being edited, or null when everything is published. */
export async function loadDraft(
  tx: Tx,
  tenantId: string,
  templateId: string,
): Promise<DocumentTemplateVersion | null> {
  const row = await tx.query.documentTemplateVersions.findFirst({
    where: and(
      eq(schema.documentTemplateVersions.tenantId, tenantId),
      eq(schema.documentTemplateVersions.templateId, templateId),
      isNull(schema.documentTemplateVersions.publishedAt),
    ),
  });
  return row ?? null;
}

/** The newest published version — what generation would actually use. */
export async function loadCurrentPublished(
  tx: Tx,
  tenantId: string,
  templateId: string,
): Promise<DocumentTemplateVersion | null> {
  const [row] = await tx
    .select()
    .from(schema.documentTemplateVersions)
    .where(
      and(
        eq(schema.documentTemplateVersions.tenantId, tenantId),
        eq(schema.documentTemplateVersions.templateId, templateId),
        sql`${schema.documentTemplateVersions.publishedAt} is not null`,
      ),
    )
    .orderBy(desc(schema.documentTemplateVersions.versionNo))
    .limit(1);
  return row ?? null;
}

export async function createTemplate(
  tx: Tx,
  ctx: DocsCtx,
  input: { name: string; description?: string; docKind?: string; body?: string },
): Promise<{ template: DocumentTemplate; draft: DocumentTemplateVersion }> {
  const name = input.name.trim().slice(0, TEMPLATE_NAME_MAX);
  if (!name) throw new DocsError("TEMPLATE_NAME_INVALID", "blank name");

  const inserted = await tx
    .insert(schema.documentTemplates)
    .values({
      tenantId: ctx.tenantId,
      name,
      nameKey: templateNameKey(name),
      description: input.description?.slice(0, 2000) ?? "",
      docKind: input.docKind?.slice(0, 64) ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    throw new DocsError("TEMPLATE_NAME_TAKEN", `name ${name} exists`);
  }
  const template = inserted[0];

  // A template always has something to edit, so the editor never has to
  // special-case "no versions yet".
  const body = (input.body ?? "").slice(0, TEMPLATE_BODY_MAX);
  const [draft] = await tx
    .insert(schema.documentTemplateVersions)
    .values({
      tenantId: ctx.tenantId,
      templateId: template.id,
      versionNo: 1,
      body,
      fields: reconcileFields(body, []),
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  return { template, draft };
}

/**
 * Save the draft body.
 *
 * If everything is published, this OPENS a new draft at the next version
 * number rather than editing the published row — the single place publish
 * immutability is turned into behaviour instead of a rule people remember.
 */
export async function saveDraft(
  tx: Tx,
  ctx: DocsCtx,
  input: {
    templateId: string;
    body: string;
    /** Labels/required flags the user edited; names always come from the body. */
    fields?: readonly TemplateField[];
  },
): Promise<DocumentTemplateVersion> {
  await loadTemplate(tx, ctx, input.templateId);
  const body = input.body.slice(0, TEMPLATE_BODY_MAX);

  const draft = await loadDraft(tx, ctx.tenantId, input.templateId);
  // The stored column is jsonb, so it goes through the defensive parser rather
  // than being trusted as a TemplateField[].
  const fields = reconcileFields(
    body,
    input.fields ?? parseFields(draft?.fields),
  );

  if (draft) {
    const [updated] = await tx
      .update(schema.documentTemplateVersions)
      .set({ body, fields, updatedAt: new Date() })
      .where(
        and(
          eq(schema.documentTemplateVersions.tenantId, ctx.tenantId),
          eq(schema.documentTemplateVersions.id, draft.id),
          // Belt and braces: the WHERE itself refuses to touch a published row,
          // so even a mis-targeted id cannot rewrite history.
          isNull(schema.documentTemplateVersions.publishedAt),
        ),
      )
      .returning();
    if (!updated) throw new DocsError("TEMPLATE_PUBLISHED", "version is frozen");
    return updated;
  }

  const published = await loadCurrentPublished(tx, ctx.tenantId, input.templateId);
  const nextNo = (published?.versionNo ?? 0) + 1;
  const [created] = await tx
    .insert(schema.documentTemplateVersions)
    .values({
      tenantId: ctx.tenantId,
      templateId: input.templateId,
      versionNo: nextNo,
      body,
      fields,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return created;
}

/**
 * Freeze the draft.
 *
 * Refuses a body with no content, and refuses one whose merge fields are
 * malformed — publishing is the moment the template becomes something the
 * business will put its name on, so it is the right place to be strict.
 */
export async function publishDraft(
  tx: Tx,
  ctx: DocsCtx,
  input: { templateId: string },
): Promise<DocumentTemplateVersion> {
  await loadTemplate(tx, ctx, input.templateId);
  const draft = await loadDraft(tx, ctx.tenantId, input.templateId);
  if (!draft) throw new DocsError("TEMPLATE_NO_DRAFT", "nothing to publish");
  if (draft.body.trim().length === 0) {
    throw new DocsError("TEMPLATE_BODY_EMPTY", "empty body");
  }

  const [published] = await tx
    .update(schema.documentTemplateVersions)
    .set({
      publishedAt: new Date(),
      publishedByClerkUserId: ctx.userId,
      // Re-derived at the moment of freezing, so the stored field list and the
      // frozen body can never disagree.
      fields: reconcileFields(draft.body, parseFields(draft.fields)),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentTemplateVersions.tenantId, ctx.tenantId),
        eq(schema.documentTemplateVersions.id, draft.id),
        isNull(schema.documentTemplateVersions.publishedAt),
      ),
    )
    .returning();
  if (!published) throw new DocsError("TEMPLATE_PUBLISHED", "already published");
  return published;
}

/**
 * Archive or restore a template.
 *
 * Never a delete: a generated document names the template it came from, and a
 * missing template turns that into a dangling reference nobody can explain.
 */
export async function setTemplateArchived(
  tx: Tx,
  ctx: DocsCtx,
  input: { templateId: string; expectedVersion: number; archived: boolean },
): Promise<DocumentTemplate> {
  const rows = await tx
    .update(schema.documentTemplates)
    .set({
      archivedAt: input.archived ? new Date() : null,
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentTemplates.tenantId, ctx.tenantId),
        eq(schema.documentTemplates.id, input.templateId),
        eq(schema.documentTemplates.version, input.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    const exists = await tx.query.documentTemplates.findFirst({
      where: and(
        eq(schema.documentTemplates.tenantId, ctx.tenantId),
        eq(schema.documentTemplates.id, input.templateId),
      ),
    });
    throw exists
      ? new DocsError("STALE_VERSION", "template changed")
      : new DocsError("TEMPLATE_NOT_FOUND", "template missing");
  }
  return rows[0];
}
