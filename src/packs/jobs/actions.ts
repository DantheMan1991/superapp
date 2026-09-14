"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { violatedUniqueIndex } from "@/lib/db-errors";
import {
  createChangeOrder,
  createCommitment,
  createContract,
  createCostCode,
  createCostCodeSet,
  createProject,
  JobsError,
  removeBudgetLine,
  setBudgetLines,
  setDefaultCostCodeSet,
  updateChangeOrder,
  updateCommitment,
  updateContract,
  updateCostCode,
  updateCostCodeSet,
  updateProject,
  type ChangeOrderLineInput,
  type JobsCtx,
} from "./ops";
import {
  BILLING_METHODS,
  CHANGE_ORDER_STATUSES,
  COMMITMENT_KINDS,
  COMMITMENT_STATUSES,
  CONTRACT_ROLES,
  CONTRACT_STATUSES,
  PACK,
  PROJECT_STATUSES,
} from "./vocabulary";

/**
 * The jobs write surface.
 *
 * Every action does the three things AGENTS.md requires of a pack: it
 * re-verifies the tenant server-side, checks the pack is switched ON, and works
 * inside `withTenant` with the caller's OWN role, so RLS and the pack's
 * decision-or-chore rule both apply. The role is never taken from the client and
 * never widened — `{ role: ctx.role }` is passed through so a policy that can
 * tell an owner from staff sees the truth.
 */

const BASE = "/dashboard/m/jobs";

async function gate(): Promise<JobsCtx> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return {
    tenantId: tenant.tenant.id,
    userId: tenant.userId,
    role: tenant.role,
  };
}

/** A JobsError as the flat shape every form here returns. */
function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change a project." };
      case "NOT_FOUND":
        return { error: "That project no longer exists." };
      case "INVALID_STATUS":
        return { error: "That is not something this can do next." };
      case "INVALID_KIND":
        return {
          error: "A kind of contract must be lowercase letters, numbers and underscores.",
        };
      case "INVALID_ROLE":
        return { error: "Say whether you hold the contract or are a subcontractor." };
      case "INVALID_BILLING_METHOD":
        return { error: "Pick how this contract is billed." };
      case "INVALID_VALUE":
        return { error: "A contract value cannot be negative." };
      case "INVALID_DELIVERY_METHOD":
        return {
          error:
            "A kind of work must be lowercase letters, numbers and underscores.",
        };
      case "NUMBER_TAKEN":
        return { error: "That job number is already in use. Pick another." };
      case "NAME_TAKEN":
        return { error: "A list with that name already exists." };
      case "NO_LINES":
        return { error: "Give at least one line an amount." };
      case "SET_IN_USE":
        return { error: "Projects are budgeted against that list, so it cannot go." };
      case "STALE_VERSION":
        return {
          error: "Somebody changed this while you had it open. Reload and try again.",
        };
      case "VALUE_LOCKED":
        return {
          error: "That contract is signed, so its value changes with a change order.",
        };
      case "APPROVAL_DATE_REQUIRED":
        return { error: "Give an approved change order the date it was approved." };
    }
  }
  /**
   * The unique indexes are the backstop for a duplicate number or list name,
   * and they are what speaks when two people save at once — the pre-check above
   * cannot see an uncommitted row. Translated here rather than left as a
   * Postgres string, because "duplicate key value violates unique constraint" is
   * not a sentence for a person.
   *
   * **READ FROM THE CAUSE, NOT THE MESSAGE.** Until slice 4 this matched on
   * `err.message`, which under drizzle's wrapper is the SQL and never the
   * constraint — so all four sentences below were dead and a duplicate job
   * number said "Something went wrong". Found by a test asserting on the message
   * and failing; `violatedUniqueIndex` says why.
   */
  switch (violatedUniqueIndex(err)) {
    case "job_projects_tenant_number_idx":
      return { error: "That job number is already in use. Pick another." };
    case "job_cost_code_sets_tenant_name_idx":
      return { error: "A list with that name already exists." };
    case "job_cost_codes_set_code_idx":
      return { error: "That code is already in this list." };
    case "job_commitments_tenant_number_idx":
      return { error: "That order number is already in use. Pick another." };
    case "job_change_orders_contract_number_idx":
      return { error: "That change order number is already used on this contract." };
  }
  console.error("jobs action failed", err);
  return { error: "Something went wrong. Try again." };
}

const optionalUuid = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

const projectSchema = z.object({
  entityId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  status: z.enum(PROJECT_STATUSES).optional(),
  /**
   * Accepted as free text and checked for FORMAT only, never against a list —
   * ADR 0056. The suggestions a screen offers come from the installed profile.
   */
  deliveryMethod: z
    .union([z.string().trim().max(63), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  enterpriseId: optionalUuid,
  partyId: optionalUuid,
  costCodeSetId: optionalUuid,
  address: z.string().trim().max(300).optional(),
  startsOn: optionalDate,
  endsOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
});

export async function createProjectAction(input: unknown) {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const project = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createProject(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "project.created",
          targetType: "project",
          targetId: created.id,
          // Identifiers only, never the client's name or a value.
          meta: {
            number: created.number,
            deliveryMethod: created.deliveryMethod,
            entityId: created.entityId,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(BASE);
    return { ok: true as const, projectId: project.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateProjectAction(input: unknown) {
  const schema = projectSchema.partial().extend({
    id: z.string().uuid(),
    version: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await updateProject(tx, ctx, id, patch);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "project.updated",
          targetType: "project",
          targetId: updated.id,
          meta: { number: updated.number, status: updated.status },
        });
        return updated;
      },
      { role: ctx.role },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${id}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const costCodeSetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCostCodeSetAction(input: unknown) {
  const parsed = costCodeSetSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const set = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createCostCodeSet(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "cost_code_set.created",
          targetType: "cost_code_set",
          targetId: created.id,
          meta: { isDefault: created.isDefault },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const, setId: set.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function setDefaultCostCodeSetAction(input: unknown) {
  const parsed = z.object({ setId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const set = await setDefaultCostCodeSet(tx, ctx, parsed.data.setId);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "cost_code_set.default_set",
          targetType: "cost_code_set",
          targetId: set.id,
        });
        return set;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const costCodeSchema = z.object({
  setId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCostCodeAction(input: unknown) {
  const parsed = costCodeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => createCostCode(tx, ctx, parsed.data),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * A contract's write surface.
 *
 * **THE VALUE ARRIVES AS A STRING AND LEAVES AS CENTS**, converted here at the
 * edge rather than in `ops.ts`. Money typed into a form is `"182,500"` or
 * `"182500.00"`, and the ledger's rule is that cents are integers — so the one
 * place that turns one into the other is the boundary, and everything below it
 * only ever sees a whole number.
 */
const moneyToCents = z
  .union([z.string(), z.number(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === "" || v === undefined || v === null) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s$]/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  });

const contractSchema = z.object({
  projectId: z.string().uuid(),
  /** Format only, never a list: the kinds come from the installed profile. */
  kind: z.string().trim().min(1).max(63),
  name: z.string().trim().max(200).optional(),
  counterpartyPartyId: optionalUuid,
  role: z.enum(CONTRACT_ROLES).optional(),
  billingMethod: z.enum(BILLING_METHODS).optional(),
  valueCents: moneyToCents,
  status: z.enum(CONTRACT_STATUSES).optional(),
  signedOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
});

export async function createContractAction(input: unknown) {
  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const contract = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createContract(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "contract.created",
          targetType: "contract",
          targetId: created.id,
          /*
           * Identifiers and coarse shape only. **The VALUE is deliberately not
           * logged**: the audit log is read in the console by people who are not
           * this business, and what a job is worth is the one number on a
           * construction project that nobody volunteers.
           */
          meta: {
            projectId: created.projectId,
            kind: created.kind,
            role: created.role,
            billingMethod: created.billingMethod,
            status: created.status,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath(BASE);
    return { ok: true as const, contractId: contract.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateContractAction(input: unknown) {
  const schema = contractSchema.partial().extend({
    id: z.string().uuid(),
    version: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await updateContract(tx, ctx, id, patch);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "contract.updated",
          targetType: "contract",
          targetId: updated.id,
          meta: { projectId: updated.projectId, status: updated.status },
        });
        return updated;
      },
      { role: ctx.role },
    );
    if (projectId) revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const costCodeSetPatch = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  version: z.number().int().positive().optional(),
});

export async function updateCostCodeSetAction(input: unknown) {
  const parsed = costCodeSetPatch.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const set = await updateCostCodeSet(tx, ctx, id, patch);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "cost_code_set.updated",
          targetType: "cost_code_set",
          targetId: set.id,
        });
        return set;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const costCodePatch = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
  /** Retire or re-offer. There is no delete: see `updateCostCode`. */
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function updateCostCodeAction(input: unknown) {
  const parsed = costCodePatch.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => updateCostCode(tx, ctx, id, patch),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const commitmentLineSchema = z.object({
  costCodeId: optionalUuid,
  description: z.string().trim().max(200).optional(),
  /** Money as typed, cents at the boundary — see `moneyToCents`. */
  amountCents: moneyToCents,
});

const commitmentSchema = z.object({
  projectId: z.string().uuid(),
  partyId: z.string().uuid(),
  kind: z.enum(COMMITMENT_KINDS).optional(),
  number: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).optional(),
  status: z.enum(COMMITMENT_STATUSES).optional(),
  issuedOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(commitmentLineSchema).min(1),
});

/**
 * `moneyToCents` yields null for a blank box, and a commitment line with no
 * amount commits nothing. Dropped here rather than stored as zero, so a person
 * who leaves the last empty row alone gets what they expect instead of a line
 * that reads `0.00` on the order.
 */
function usableLines(lines: Array<{ costCodeId: string | null; description?: string; amountCents: number | null }>) {
  return lines
    .filter((l) => l.amountCents !== null)
    .map((l) => ({
      costCodeId: l.costCodeId,
      description: l.description,
      amountCents: l.amountCents as number,
    }));
}

export async function createCommitmentAction(input: unknown) {
  const parsed = commitmentSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const lines = usableLines(parsed.data.lines);
  if (lines.length === 0) {
    return { error: "Give at least one line an amount." };
  }
  try {
    const ctx = await gate();
    const commitment = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createCommitment(tx, ctx, { ...parsed.data, lines });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "commitment.created",
          targetType: "commitment",
          targetId: created.id,
          /* Identifiers and shape only. The amount is not logged, for the
             reason a contract's value is not: the console is read by people who
             are not this business. */
          meta: {
            projectId: created.projectId,
            kind: created.kind,
            status: created.status,
            lineCount: lines.length,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath(BASE);
    return { ok: true as const, commitmentId: commitment.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateCommitmentAction(input: unknown) {
  const schema = commitmentSchema.partial().extend({
    id: z.string().uuid(),
    version: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, lines, ...patch } = parsed.data;
  const usable = lines === undefined ? undefined : usableLines(lines);
  if (usable !== undefined && usable.length === 0) {
    return { error: "Give at least one line an amount." };
  }
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await updateCommitment(tx, ctx, id, {
          ...patch,
          ...(usable === undefined ? {} : { lines: usable }),
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "commitment.updated",
          targetType: "commitment",
          targetId: updated.id,
          meta: { projectId: updated.projectId, status: updated.status },
        });
        return updated;
      },
      { role: ctx.role },
    );
    if (projectId) revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const budgetSchema = z.object({
  projectId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        costCodeId: z.string().uuid(),
        /** Money as typed, cents at the boundary — see `moneyToCents`. */
        originalCents: moneyToCents,
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .max(500),
});

export async function setBudgetAction(input: unknown) {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  /**
   * A blank box is not a budget of zero, it is a code nobody has budgeted — so
   * it is dropped rather than written as `0`. The difference matters on the
   * report: zero means "carried at nil, anything spent is a variance", blank
   * means "no plan yet", and writing one as the other would turn every
   * untouched row into a fake overrun.
   */
  const lines = parsed.data.lines
    .filter((l) => l.originalCents !== null)
    .map((l) => ({
      costCodeId: l.costCodeId,
      originalCents: l.originalCents as number,
      notes: l.notes,
    }));

  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const rows = await setBudgetLines(tx, ctx, parsed.data.projectId, lines);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "budget.set",
          targetType: "project",
          targetId: parsed.data.projectId,
          /* Counts, never amounts. A budget by code is close to a margin, and
             the console is read by people who are not this business. */
          meta: { lineCount: rows.length },
        });
        return rows;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeBudgetLineAction(input: unknown) {
  const parsed = z
    .object({ id: z.string().uuid(), projectId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) => removeBudgetLine(tx, ctx, parsed.data.id),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const changeOrderLineSchema = z.object({
  costCodeId: optionalUuid,
  description: z.string().trim().max(200).optional(),
  /** Money as typed, cents at the boundary. `-4,500` is a deduction. */
  amountCents: moneyToCents,
});

const changeOrderSchema = z.object({
  /** For revalidation only — the change order itself hangs off the contract. */
  projectId: z.string().uuid(),
  contractId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(CHANGE_ORDER_STATUSES).optional(),
  /** The change to the contract's value. Negative is a deduction. */
  valueCents: moneyToCents,
  requestedOn: optionalDate,
  approvedOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(changeOrderLineSchema).max(200).optional(),
});

/**
 * A blank row costs nothing and is dropped, as on a commitment. A row with an
 * amount and NO code is refused rather than dropped: a change-order line's only
 * job is to move a code's budget, so one without a code would be money that
 * moved nothing, and dropping it silently would make the cost total disagree
 * with what the person typed.
 */
function changeOrderLines(
  lines:
    | Array<{ costCodeId: string | null; description?: string; amountCents: number | null }>
    | undefined,
): { ok: true; lines: ChangeOrderLineInput[] | undefined } | { ok: false; error: string } {
  if (lines === undefined) return { ok: true, lines: undefined };
  const kept = lines.filter((l) => l.amountCents !== null);
  if (kept.some((l) => !l.costCodeId)) {
    return { ok: false, error: "Every line on a change order needs a cost code." };
  }
  return {
    ok: true,
    lines: kept.map((l) => ({
      costCodeId: l.costCodeId as string,
      description: l.description,
      amountCents: l.amountCents as number,
    })),
  };
}

export async function createChangeOrderAction(input: unknown) {
  const parsed = changeOrderSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, valueCents, lines: rawLines, ...fields } = parsed.data;
  const lines = changeOrderLines(rawLines);
  if (!lines.ok) return { error: lines.error };
  try {
    const ctx = await gate();
    const changeOrder = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createChangeOrder(tx, ctx, {
          ...fields,
          // A blank price box is a change with no price, which is zero.
          valueCents: valueCents ?? 0,
          lines: lines.lines,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "change_order.created",
          targetType: "change_order",
          targetId: created.id,
          /* Identifiers and shape only. Neither the price nor the cost is
             logged, for the reason a contract's value is not: together they are
             the margin on the change, and the console is read by people who are
             not this business. */
          meta: {
            contractId: created.contractId,
            status: created.status,
            lineCount: lines.lines?.length ?? 0,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(BASE);
    return { ok: true as const, changeOrderId: changeOrder.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateChangeOrderAction(input: unknown) {
  const schema = changeOrderSchema
    // The contract a change order is against does not change; see updateChangeOrder.
    .omit({ contractId: true })
    .partial()
    .extend({
      id: z.string().uuid(),
      version: z.number().int().positive().optional(),
    });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, valueCents, lines: rawLines, ...patch } = parsed.data;
  const lines = changeOrderLines(rawLines);
  if (!lines.ok) return { error: lines.error };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await updateChangeOrder(tx, ctx, id, {
          ...patch,
          valueCents: valueCents ?? 0,
          ...(lines.lines === undefined ? {} : { lines: lines.lines }),
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "change_order.updated",
          targetType: "change_order",
          targetId: updated.id,
          meta: { contractId: updated.contractId, status: updated.status },
        });
        return updated;
      },
      { role: ctx.role },
    );
    if (projectId) revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
