"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
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

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  // Fail closed for the expert (accountant) role, as Documents does: this
  // module has no read-only-safe writes, so there is nothing to opt into.
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(partyId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/records`);
  if (partyId) revalidatePath(`${BASE}/records/${partyId}`);
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
      { role: ctx.role },
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
      { role: ctx.role },
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
      { role: ctx.role },
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
      { role: ctx.role },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
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
      { role: ctx.role },
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
      { role: ctx.role },
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
      { role: ctx.role },
    );

    revalidate(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
