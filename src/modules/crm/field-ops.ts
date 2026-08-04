import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmFieldDef, CrmFieldOption, CrmFieldType } from "@/db/schema";
import { CrmError } from "./core/errors";
import { isChoiceType } from "./core/custom-fields";
import type { CrmCtx } from "./core/types";

/**
 * Custom field DEFINITIONS — the shape of a tenant's records.
 *
 * WRITING THESE IS AN OWNER ACT and RLS enforces it (drizzle/0067): adding a
 * required field changes what a stage transition demands of the entire tenant,
 * and archiving one takes a column off everybody's form. Reading stays open to
 * staff, because the record form cannot render without the definitions.
 *
 * The action layer gates on role as well. That is not redundancy for its own
 * sake — RLS makes an unauthorized write return zero rows, and "nothing
 * happened" is a worse message than "you need to be an owner".
 */

export const FIELD_KEY_MAX = 63;
export const FIELD_LABEL_MAX = 80;
export const HELP_TEXT_MAX = 200;
export const MAX_OPTIONS = 100;

/**
 * An option as a CALLER supplies it — label optional, because `normalizeOptions`
 * falls back to the value. Distinct from the stored `CrmFieldOption`, where the
 * label is always present so no reader has to repeat that fallback.
 */
export interface FieldOptionInput {
  value: string;
  label?: string;
}

export interface FieldDefInput {
  entityType?: string;
  key: string;
  label: string;
  fieldType: CrmFieldType;
  options?: FieldOptionInput[];
  isRequired?: boolean;
  helpText?: string;
}

/**
 * Live definitions for an entity type, in display order.
 *
 * Archived ones are EXCLUDED by default and that exclusion is load-bearing
 * rather than cosmetic: `sanitizeCustomValues` treats a definition it was not
 * given as unknown and drops its incoming value, which is exactly the desired
 * behaviour for a field somebody retired. Their already-stored values survive
 * because the write path merges rather than replaces.
 */
export async function listFieldDefs(
  tx: Tx,
  tenantId: string,
  entityType = "party",
  opts: { includeArchived?: boolean } = {},
): Promise<CrmFieldDef[]> {
  return tx.query.crmFieldDefs.findMany({
    where: and(
      eq(schema.crmFieldDefs.tenantId, tenantId),
      eq(schema.crmFieldDefs.entityType, entityType),
      ...(opts.includeArchived ? [] : [isNull(schema.crmFieldDefs.archivedAt)]),
    ),
    orderBy: [
      asc(schema.crmFieldDefs.sortOrder),
      sql`lower(${schema.crmFieldDefs.label})`,
    ],
  });
}

async function loadFieldDef(
  tx: Tx,
  tenantId: string,
  fieldId: string,
): Promise<CrmFieldDef> {
  const row = await tx.query.crmFieldDefs.findFirst({
    where: and(
      eq(schema.crmFieldDefs.tenantId, tenantId),
      eq(schema.crmFieldDefs.id, fieldId),
    ),
  });
  if (!row) throw new CrmError("FIELD_NOT_FOUND", `field ${fieldId} missing`);
  return row;
}

/** A choice field with no choices is a control nobody can answer. */
function assertOptions(fieldType: CrmFieldType, options: CrmFieldOption[]): void {
  if (isChoiceType(fieldType) && options.length === 0) {
    throw new CrmError("FIELD_OPTIONS_REQUIRED", "choice fields need options");
  }
}

/** Duplicate option values would make one of them unselectable. */
function normalizeOptions(options: FieldOptionInput[] = []): CrmFieldOption[] {
  const seen = new Set<string>();
  const out: CrmFieldOption[] = [];
  for (const o of options.slice(0, MAX_OPTIONS)) {
    const value = o.value.trim();
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: (o.label ?? "").trim() || value });
  }
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /unique|duplicate key/i.test(err.message);
}

export async function createFieldDef(
  tx: Tx,
  ctx: CrmCtx,
  input: FieldDefInput,
): Promise<CrmFieldDef> {
  const options = normalizeOptions(input.options);
  assertOptions(input.fieldType, options);

  // Appended, not inserted: a new field goes at the bottom of the form rather
  // than silently reordering everything somebody already arranged.
  const [{ next }] = await tx
    .select({
      next: sql<number>`coalesce(max(${schema.crmFieldDefs.sortOrder}), -1) + 1`,
    })
    .from(schema.crmFieldDefs)
    .where(
      and(
        eq(schema.crmFieldDefs.tenantId, ctx.tenantId),
        eq(schema.crmFieldDefs.entityType, input.entityType ?? "party"),
      ),
    );

  try {
    const [row] = await tx
      .insert(schema.crmFieldDefs)
      .values({
        tenantId: ctx.tenantId,
        entityType: input.entityType ?? "party",
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        options,
        isRequired: input.isRequired ?? false,
        helpText: input.helpText ?? "",
        sortOrder: next,
      })
      .returning();
    return row;
  } catch (err) {
    // The partial unique is the enforcement; this only translates it.
    if (isUniqueViolation(err)) {
      throw new CrmError("FIELD_KEY_TAKEN", "a live field already uses that name");
    }
    throw err;
  }
}

/**
 * Edit a definition.
 *
 * `fieldType` IS NOT CHANGEABLE, and refusing that is cheaper than the
 * alternative. Flipping `text` to `number` would leave every stored value in a
 * shape the new type rejects, so the write path would start failing on records
 * nobody had touched. Archiving the field and making a new one keeps the old
 * values readable and makes the discontinuity visible.
 */
export async function updateFieldDef(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    fieldId: string;
    expectedVersion: number;
    patch: {
      key?: string;
      label?: string;
      options?: FieldOptionInput[];
      isRequired?: boolean;
      helpText?: string;
    };
  },
): Promise<CrmFieldDef> {
  const before = await loadFieldDef(tx, ctx.tenantId, args.fieldId);

  const options =
    args.patch.options !== undefined ? normalizeOptions(args.patch.options) : undefined;
  if (options !== undefined) assertOptions(before.fieldType, options);

  try {
    const rows = await tx
      .update(schema.crmFieldDefs)
      .set({
        ...(args.patch.key !== undefined ? { key: args.patch.key } : {}),
        ...(args.patch.label !== undefined ? { label: args.patch.label } : {}),
        ...(options !== undefined ? { options } : {}),
        ...(args.patch.isRequired !== undefined
          ? { isRequired: args.patch.isRequired }
          : {}),
        ...(args.patch.helpText !== undefined ? { helpText: args.patch.helpText } : {}),
        version: args.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.crmFieldDefs.tenantId, ctx.tenantId),
          eq(schema.crmFieldDefs.id, args.fieldId),
          eq(schema.crmFieldDefs.version, args.expectedVersion),
        ),
      )
      .returning();
    if (rows.length === 0) {
      throw new CrmError("STALE_VERSION", "field changed since loaded");
    }
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CrmError("FIELD_KEY_TAKEN", "a live field already uses that name");
    }
    throw err;
  }
}

/**
 * Archive or restore. There is no delete, anywhere, on purpose — stored values
 * are keyed by this row's id, so removing it would turn every one of them into
 * a number nobody can interpret. The data would still be there and would no
 * longer mean anything.
 */
export async function setFieldDefArchived(
  tx: Tx,
  ctx: CrmCtx,
  args: { fieldId: string; expectedVersion: number; archived: boolean },
): Promise<CrmFieldDef> {
  try {
    const rows = await tx
      .update(schema.crmFieldDefs)
      .set({
        archivedAt: args.archived ? new Date() : null,
        version: args.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.crmFieldDefs.tenantId, ctx.tenantId),
          eq(schema.crmFieldDefs.id, args.fieldId),
          eq(schema.crmFieldDefs.version, args.expectedVersion),
        ),
      )
      .returning();
    if (rows.length === 0) {
      throw new CrmError("STALE_VERSION", "field changed since loaded");
    }
    return rows[0];
  } catch (err) {
    // Restoring can collide: another field may have taken the freed key while
    // this one was archived. The partial unique catches it.
    if (isUniqueViolation(err)) {
      throw new CrmError(
        "FIELD_KEY_TAKEN",
        "another live field has taken that name since this one was archived",
      );
    }
    throw err;
  }
}

/**
 * Reorder by listing ids in the wanted order.
 *
 * Ids not in the list are left alone rather than pushed to the end, so a
 * reorder submitted against a stale list cannot silently reshuffle a field
 * somebody else added in the meantime.
 */
export async function reorderFieldDefs(
  tx: Tx,
  ctx: CrmCtx,
  fieldIds: string[],
): Promise<void> {
  for (const [index, fieldId] of fieldIds.entries()) {
    await tx
      .update(schema.crmFieldDefs)
      .set({ sortOrder: index, updatedAt: new Date() })
      .where(
        and(
          eq(schema.crmFieldDefs.tenantId, ctx.tenantId),
          eq(schema.crmFieldDefs.id, fieldId),
        ),
      );
  }
}
