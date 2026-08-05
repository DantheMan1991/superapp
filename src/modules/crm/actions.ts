"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { CONTACT_VALUE_MAX } from "@/lib/parties/contact-values";
import {
  addContactPoint,
  deleteContactPoint,
  findPartiesByContact,
  setPrimaryContactPoint,
  updateContactPoint,
} from "@/lib/parties/contacts";
import { CrmError, friendlyMessage } from "./core/errors";
import {
  LIFECYCLE_STAGE_MAX,
  NOTES_MAX,
  SOURCE_MAX,
  TITLE_MAX,
  type CrmCtx,
} from "./core/types";
import {
  addAffiliation,
  adoptRecord,
  createRecord,
  endAffiliation,
  listRecords,
  setRecordActive,
  updateRecord,
} from "./party-ops";
import {
  createFieldDef,
  FIELD_KEY_MAX,
  FIELD_LABEL_MAX,
  HELP_TEXT_MAX,
  MAX_OPTIONS,
  reorderFieldDefs,
  setFieldDefArchived,
  updateFieldDef,
} from "./field-ops";

/** An option's `value` and `label` share a cap; neither is prose. */
const OPTION_VALUE_MAX = 80;

/**
 * Server actions for CRM. Canonical shape: gate → Zod → withTenant(core +
 * audit) → revalidate.
 *
 * EVERY `withTenant` PASSES `{ role: ctx.role }`, without exception, because
 * `crm_party_details` carries a visibility term in its RLS policy. Forgetting
 * it does not open a hole — the GUC defaults to 'staff' — it denies an owner a
 * row they should have seen, which is the direction that fails safe.
 */

const BASE = "/dashboard/m/crm";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | {
      error: string;
      /**
       * Per-field messages, so a form can put each one beside its input rather
       * than showing one toast for six problems.
       */
      issues?: { fieldId: string; label: string; message: string }[];
    };

async function gate(opts?: { ownerOnly?: boolean }): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  // Fail closed for the expert (accountant) role, as Documents does: this
  // module has no read-only-safe writes, so there is nothing to opt into.
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  // Checked here as well as in RLS, and the duplication is deliberate: the
  // policy makes an unauthorized write affect zero rows, and "nothing happened"
  // is a worse thing to tell somebody than "you need to be an owner".
  if (opts?.ownerOnly && ctx.role !== "owner") {
    throw new CrmError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string; issues?: CrmError["issues"] } {
  if (err instanceof CrmError) {
    return { error: friendlyMessage(err), ...(err.issues ? { issues: err.issues } : {}) };
  }
  console.error("crm action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(partyId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/records`);
  if (partyId) revalidatePath(`${BASE}/records/${partyId}`);
}

/**
 * A definition change reshapes EVERY record's form, so the whole module's
 * cached pages go — not just the settings page that was edited.
 */
function revalidateFields(): void {
  revalidatePath(`${BASE}/fields`);
  revalidatePath(BASE, "layout");
}

/* -- Schemas -------------------------------------------------------------- */

const optionalText = (max: number) => z.string().max(max).optional();

const identitySchema = {
  kind: z.enum(["person", "organization"]),
  displayName: z.string().max(200).optional(),
  givenName: z.string().max(100).nullable().optional(),
  familyName: z.string().max(100).nullable().optional(),
  legalName: z.string().max(200).nullable().optional(),
};

const crmFields = {
  lifecycleStage: optionalText(LIFECYCLE_STAGE_MAX),
  source: optionalText(SOURCE_MAX),
  notes: optionalText(NOTES_MAX),
  ownerClerkUserId: z.string().max(120).nullable().optional(),
  visibility: z.enum(["members", "restricted"]).optional(),
  /**
   * Deliberately `z.unknown()` per value rather than a union of the storage
   * types. Zod's job at this boundary is to prove the SHAPE is an object keyed
   * by uuid; what each value may be depends on a field definition Zod cannot
   * see, and `sanitizeCustomValues` decides it against the live definitions.
   * Two validators disagreeing about the same value is worse than one.
   */
  custom: z.record(z.string().uuid(), z.unknown()).optional(),
};

const createSchema = z.object({ ...identitySchema, ...crmFields });

const updateSchema = z.object({
  partyId: z.string().uuid(),
  partyVersion: z.number().int().positive(),
  detailsVersion: z.number().int().positive(),
  ...identitySchema,
  kind: identitySchema.kind.optional(),
  ...crmFields,
});

/* -- Records -------------------------------------------------------------- */

export async function createRecordAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ partyId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const partyId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const { party, details } = await createRecord(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.record_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: party.id,
          // Identifiers and coarse metadata only (S9). The display name is the
          // customer's own name and does not belong in a superadmin-visible log.
          meta: { kind: party.kind, visibility: details.visibility },
        });
        return party.id;
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(partyId);
    return { ok: true, data: { partyId } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateRecordAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { partyId, partyVersion, detailsVersion, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await updateRecord(tx, ctx, {
          partyId,
          partyVersion,
          detailsVersion,
          patch,
        });
        await logAuditInTx(tx, {
          action: "crm.record_updated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: partyId,
          // Which FIELDS changed, never their values.
          meta: { fields: Object.keys(patch).sort() },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const adoptSchema = z.object({ partyId: z.string().uuid() });

/** "Start working this one" for a party Accounting created. */
export async function adoptRecordAction(
  input: z.infer<typeof adoptSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = adoptSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await adoptRecord(tx, ctx, parsed.data.partyId);
        await logAuditInTx(tx, {
          action: "crm.record_adopted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: parsed.data.partyId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const archiveSchema = z.object({
  partyId: z.string().uuid(),
  partyVersion: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function setRecordActiveAction(
  input: z.infer<typeof archiveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await setRecordActive(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: parsed.data.isActive
            ? "crm.record_restored"
            : "crm.record_archived",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: parsed.data.partyId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- Custom field definitions --------------------------------------------- */

const optionSchema = z.object({
  value: z.string().min(1).max(OPTION_VALUE_MAX),
  label: z.string().max(OPTION_VALUE_MAX).optional(),
});

const fieldKey = z
  .string()
  .min(1)
  .max(FIELD_KEY_MAX)
  // Mirrors the database CHECK exactly. Both exist: the app gives a usable
  // message, the constraint means no other writer can get it wrong.
  .regex(/^[a-z][a-z0-9_]{0,62}$/, "Use lowercase letters, numbers and underscores");

const createFieldSchema = z.object({
  key: fieldKey,
  label: z.string().min(1).max(FIELD_LABEL_MAX),
  fieldType: z.enum([
    "text",
    "number",
    "date",
    "boolean",
    "select",
    "multi_select",
    "url",
  ]),
  options: z.array(optionSchema).max(MAX_OPTIONS).optional(),
  isRequired: z.boolean().optional(),
  helpText: z.string().max(HELP_TEXT_MAX).optional(),
});

export async function createFieldDefAction(
  input: z.infer<typeof createFieldSchema>,
): Promise<ActionResult<{ fieldId: string }>> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = createFieldSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const fieldId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const def = await createFieldDef(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.field_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_field_def",
          targetId: def.id,
          // The key and type are schema, not somebody's data — safe to record,
          // and they are what makes this audit row worth having.
          meta: { key: def.key, fieldType: def.fieldType, required: def.isRequired },
        });
        return def.id;
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFields();
    return { ok: true, data: { fieldId } };
  } catch (err) {
    return fail(err);
  }
}

const updateFieldSchema = z.object({
  fieldId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  key: fieldKey.optional(),
  label: z.string().min(1).max(FIELD_LABEL_MAX).optional(),
  options: z.array(optionSchema).max(MAX_OPTIONS).optional(),
  isRequired: z.boolean().optional(),
  helpText: z.string().max(HELP_TEXT_MAX).optional(),
});

export async function updateFieldDefAction(
  input: z.infer<typeof updateFieldSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = updateFieldSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const { fieldId, expectedVersion, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await updateFieldDef(tx, ctx, { fieldId, expectedVersion, patch });
        await logAuditInTx(tx, {
          action: "crm.field_updated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_field_def",
          targetId: fieldId,
          meta: { fields: Object.keys(patch).sort() },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFields();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const archiveFieldSchema = z.object({
  fieldId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  archived: z.boolean(),
});

export async function setFieldDefArchivedAction(
  input: z.infer<typeof archiveFieldSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = archiveFieldSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await setFieldDefArchived(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: parsed.data.archived
            ? "crm.field_archived"
            : "crm.field_restored",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_field_def",
          targetId: parsed.data.fieldId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFields();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const reorderSchema = z.object({
  fieldIds: z.array(z.string().uuid()).max(200),
});

export async function reorderFieldDefsAction(
  input: z.infer<typeof reorderSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = reorderSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => reorderFieldDefs(tx, ctx, parsed.data.fieldIds),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFields();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- Contact points ------------------------------------------------------- */

const contactKind = z.enum(["email", "phone", "website"]);

const addContactSchema = z.object({
  partyId: z.string().uuid(),
  kind: contactKind,
  value: z.string().min(1).max(CONTACT_VALUE_MAX),
  label: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
});

export async function addContactPointAction(
  input: z.infer<typeof addContactSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = addContactSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { partyId, ...rest } = parsed.data;

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await addContactPoint(tx, ctx.tenantId, partyId, rest);
        await logAuditInTx(tx, {
          action: "crm.contact_point_added",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: partyId,
          // The KIND only. An address is a client's own contact detail (C4) and
          // does not belong in a superadmin-visible log (S9).
          meta: { kind: rest.kind },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const editContactSchema = z.object({
  contactPointId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  partyId: z.string().uuid(),
  value: z.string().min(1).max(CONTACT_VALUE_MAX).optional(),
  label: z.string().max(40).optional(),
});

export async function updateContactPointAction(
  input: z.infer<typeof editContactSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = editContactSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { contactPointId, expectedVersion, partyId, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      (tx) =>
        updateContactPoint(tx, ctx.tenantId, {
          contactPointId,
          expectedVersion,
          patch,
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const contactRefSchema = z.object({
  contactPointId: z.string().uuid(),
  partyId: z.string().uuid(),
});

export async function setPrimaryContactPointAction(
  input: z.infer<typeof contactRefSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = contactRefSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => setPrimaryContactPoint(tx, ctx.tenantId, parsed.data.contactPointId),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteContactPointAction(
  input: z.infer<typeof contactRefSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = contactRefSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => deleteContactPoint(tx, ctx.tenantId, parsed.data.contactPointId),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const duplicateSchema = z.object({
  kind: contactKind,
  value: z.string().max(CONTACT_VALUE_MAX),
  excludePartyId: z.string().uuid().optional(),
});

/**
 * "Somebody already has this address" — the duplicate warning.
 *
 * A WARNING AND NOT A BLOCK, deliberately. Two people at one company genuinely
 * share `info@`, a family business genuinely shares a mobile, and a product
 * that refuses the second record teaches its users to put a full stop in the
 * address to get past it. Showing who already has it lets the person decide,
 * which is the same "the machine suggests, a person commits" line the merge
 * tool and the AI slices sit on.
 *
 * Returns names and ids only, under the caller's own `withTenant` — so this
 * cannot become a way to discover whether an address belongs to another
 * tenant's client by typing it.
 */
export async function findDuplicateContactAction(
  input: z.infer<typeof duplicateSchema>,
): Promise<ActionResult<{ partyId: string; displayName: string }[]>> {
  try {
    const ctx = await gate();
    const parsed = duplicateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const matches = await withTenant(
      ctx.tenantId,
      (tx) =>
        findPartiesByContact(tx, ctx.tenantId, parsed.data.kind, parsed.data.value, {
          excludePartyId: parsed.data.excludePartyId,
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    return {
      ok: true,
      data: matches.map((m) => ({
        partyId: m.party.id,
        displayName: m.party.displayName,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

/* -- Lookup --------------------------------------------------------------- */

const searchSchema = z.object({
  query: z.string().max(200),
  kind: z.enum(["person", "organization"]).optional(),
});

/**
 * Candidates for the connection picker.
 *
 * Returns ids and names ONLY — never the CRM half. It runs under the caller's
 * own `withTenant`, so RLS decides what it can find, but the narrow projection
 * is a second reason this cannot become a way to read a restricted record's
 * stage or notes through a search box.
 *
 * An empty query returns nothing rather than everyone: this fires while
 * somebody types, and listing every party on focus is a query per keystroke for
 * suggestions nobody asked for. Same rule as the mail contact source.
 */
export async function searchRecordsAction(
  input: z.infer<typeof searchSchema>,
): Promise<ActionResult<{ id: string; displayName: string }[]>> {
  try {
    const ctx = await gate();
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    if (parsed.data.query.trim().length === 0) return { ok: true, data: [] };

    const rows = await withTenant(
      ctx.tenantId,
      (tx) =>
        listRecords(tx, ctx.tenantId, {
          query: parsed.data.query,
          kind: parsed.data.kind,
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    return {
      ok: true,
      data: rows
        .slice(0, 10)
        .map((r) => ({ id: r.party.id, displayName: r.party.displayName })),
    };
  } catch (err) {
    return fail(err);
  }
}

/* -- Affiliations --------------------------------------------------------- */

const addAffiliationSchema = z.object({
  personPartyId: z.string().uuid(),
  organizationPartyId: z.string().uuid(),
  title: z.string().max(TITLE_MAX).optional(),
  isPrimary: z.boolean().optional(),
  startedOn: z.string().date().nullable().optional(),
});

export async function addAffiliationAction(
  input: z.infer<typeof addAffiliationSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = addAffiliationSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await addAffiliation(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.affiliation_added",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_affiliation",
          targetId: row.id,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(parsed.data.personPartyId);
    revalidate(parsed.data.organizationPartyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const endAffiliationSchema = z.object({
  affiliationId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  endedOn: z.string().date(),
  /** Only so the right page can be revalidated; never trusted for access. */
  partyId: z.string().uuid(),
});

export async function endAffiliationAction(
  input: z.infer<typeof endAffiliationSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = endAffiliationSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await endAffiliation(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.affiliation_ended",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_affiliation",
          targetId: parsed.data.affiliationId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
