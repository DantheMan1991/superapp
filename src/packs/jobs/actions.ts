"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { violatedUniqueIndex } from "@/lib/db-errors";
import { allowsWrite } from "@/lib/packs/authorize";
import { parseMoneyToCents } from "@/lib/money";
import {
  detachDocumentFromRecord,
  registerAttachedPhoto,
  setPrimaryAttachment,
} from "@/modules/documents/attachments";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { percentStringToPpm, quantityStringToThousandths } from "./billing-math";
import {
  addPunchItem,
  deleteDailyLog,
  getDailyLog,
  saveDailyLog,
  setPunchDone,
  type CrewInput,
} from "./field-ops";
import { postWip, saveWipEstimate, unpostWip } from "./wip-ops";
import {
  askForWaiver,
  createLienWaiver,
  getLienWaiver,
  updateLienWaiver,
} from "./compliance-ops";
import {
  createSelection,
  getSelection,
  raiseSelectionChangeOrder,
  remindSelection,
  updateSelection,
} from "./selections-ops";
import {
  acceptEstimate,
  applyEstimateToBudget,
  applyEstimateToSchedule,
  createEstimate,
  updateEstimate,
  type EstimateLineInput,
} from "./estimating-ops";
import { rateStringToPpm } from "./estimate-math";
import {
  approveSubApplication,
  createSubApplication,
  deleteSubApplication,
  updateSubApplication,
  voidSubApplication,
} from "./sub-billing-ops";
import { LedgerError, friendlyMessage } from "@/modules/accounting/core";
import {
  createChangeOrder,
  createCommitment,
  createCommitmentChangeOrder,
  createContract,
  createCostCode,
  createCostCodeSet,
  createPayApplication,
  createProject,
  deletePayApplication,
  issuePayApplication,
  JobsError,
  removeBudgetLine,
  saveSovLines,
  setBudgetLines,
  setDefaultCostCodeSet,
  updateChangeOrder,
  updateCommitment,
  updateCommitmentChangeOrder,
  updatePayApplication,
  voidPayApplication,
  updateContract,
  updateCostCode,
  updateCostCodeSet,
  updateProject,
  type ChangeOrderLineInput,
  type CommitmentChangeLineInput,
  type JobsCtx,
} from "./ops";
import type { SelectionChoiceInput } from "./selections-ops";
import {
  BILLING_METHODS,
  CHANGE_ORDER_STATUSES,
  COMMITMENT_KINDS,
  COMMITMENT_STATUSES,
  LIEN_WAIVER_ENTITY,
  LIEN_WAIVER_KINDS,
  LIEN_WAIVER_STATUSES,
  SELECTION_ENTITY,
  SELECTION_STATUSES,
  ESTIMATE_STATUSES,
  CONTRACT_ROLES,
  CONTRACT_STATUSES,
  DAILY_LOG_ENTITY,
  PACK,
  PROJECT_STATUSES,
  hoursToTenths,
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

/** "a fee must be between 0% and 100% of cost" → "A fee must be between 0% and 100% of cost." */
function sentence(message: string): string {
  const m = message.trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
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
        // The verb's own sentence: every INVALID_VALUE in this pack is written for a
        // person ("a deduction cannot be completed to more than nothing"), and one
        // sentence for all of them was wrong for all but the first.
        return { error: sentence(err.message) };
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
      case "SOV_LINE_BILLED":
        return {
          error: "That line has been billed on an application, so it cannot be removed.",
        };
      case "ONE_DRAFT":
        return { error: "This contract already has a draft application. Finish that one first." };
      case "NOTHING_DUE":
        return { error: "Nothing is due on this application, so there is nothing to invoice." };
      case "COUNTERPARTY_REQUIRED":
        return { error: "Say who the contract is with before billing it." };
      case "ACCOUNT_MISSING":
        return { error: `The chart of accounts is missing something: ${err.message}.` };
      case "NOT_LAST":
        return { error: "Only the latest issued application can be voided." };
      case "ESTIMATE_REQUIRED":
        return {
          error: `Give every job a budget or an estimate before posting: ${err.message}.`,
        };
      case "BILLED_NO_VALUE":
        return {
          error: `A job with billings needs a fixed contract value to measure against: ${err.message}.`,
        };
      case "NOT_FORWARD":
        return {
          error: `A period must come after the latest posted one, ${err.message}. Unpost that one first.`,
        };
      case "NOTHING_TO_POST":
        return {
          error: "Billings equal earned revenue on every job, so there is nothing to post for this period.",
        };
      case "NOT_LATEST_PERIOD":
        return {
          error: `Only the latest posted period can be unposted, and that is ${err.message}.`,
        };
      case "ONE_COST_PLUS":
        return {
          error:
            "Another contract on this job is already billing its cost, cost plus or time and materials. A job's cost is billed once.",
        };
      case "NO_BILL_RATE":
        return {
          error: `Hours with no bill rate: ${err.message}. Set a charged-out rate in Time, or one rate for everybody on the contract.`,
        };
      case "RATE_LOCKED":
        return {
          error:
            "The contract's labour rate is fixed once an application has issued. A rate that changes over time is set in Time, with its date.",
        };
      case "NOT_SUBCONTRACT":
        return {
          error: "A purchase order is billed with an ordinary bill in Accounting. Applications are for subcontracts.",
        };
      case "LINES_LOCKED":
        return {
          error:
            "That order has been issued or billed against, so its lines change with a change order on the order's page.",
        };
      case "CHANGE_BILLED":
        return {
          error:
            "The subcontractor has billed against that change, so it stays approved and its lines stay as they are. Raise another change.",
        };
      case "WRONG_PROJECT":
        return { error: `That is on another job: ${err.message}.` };
      case "RECEIVED_DATE_REQUIRED":
        return { error: "Give a received waiver the date it arrived." };
      case "SELECTION_RAISED":
        return {
          error: `The difference on that selection has been raised: ${err.message}. Void the change order to re-price it.`,
        };
      case "ESTIMATE_ACCEPTED":
        return { error: `That estimate is fixed: ${err.message}.` };
    }
  }
  /**
   * Billing posts through Accounting's own verbs, so Accounting's refusals
   * arrive here in its own words — a closed period, an invoice with payments
   * on it, an account nobody may pick — and are handed on as it would say them.
   */
  if (err instanceof LedgerError) {
    return { error: friendlyMessage(err) };
  }
  /**
   * Photos are Documents' rows and punch items are Work's, so their refusals
   * arrive here already written for a person — "Only a photo can be the
   * picture", "this workspace has no work list yet" — and are handed on as
   * they are. Matched by name rather than class, the way livestock's actions
   * do, so a `catch` does not become a dependency on two modules' error classes.
   */
  if (err instanceof Error && (err.name === "DocsError" || err.name === "WorkError")) {
    return { error: err.message };
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
    case "job_commitment_change_orders_commitment_number_idx":
      return { error: "That change order number is already used on this order." };
    case "job_estimates_project_number_idx":
      return { error: "That estimate number is already used on this job." };
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

/** "1,250.5" → 1,250,500 thousandths; blank → null; anything else refuses. May be negative on an application line. */
const quantityToThousandths = z
  .union([z.string(), z.number(), z.literal("")])
  .optional()
  .transform((v, ctx) => {
    if (v === "" || v === undefined || v === null) return null;
    const q = quantityStringToThousandths(String(v));
    if (q === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a quantity must be a number" });
      return z.NEVER;
    }
    return q;
  });

/** "15" → 150_000 ppm; blank → null (no percentage fee); anything else refuses. */
const feePercent = z
  .union([z.string(), z.literal("")])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v.trim() === "") return null;
    const ppm = percentStringToPpm(v);
    if (ppm === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a fee must be a percent" });
      return z.NEVER;
    }
    return ppm;
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
  /** Cost-plus terms: a fee percent, a fixed fee, a guaranteed maximum. Blank is none. */
  feePpm: feePercent,
  feeCents: moneyToCents,
  gmaxCents: moneyToCents,
  /** Time and materials: one rate for everybody, per hour. Blank means each person's rate from Time. */
  laborRateCents: moneyToCents,
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

const commitmentChangeLineSchema = z.object({
  costCodeId: optionalUuid,
  description: z.string().trim().max(200).optional(),
  /** Money as typed, cents at the boundary. `-2,000` is scope taken back. */
  amountCents: moneyToCents,
});

const commitmentChangeSchema = z.object({
  /** For revalidation only — the change hangs off the commitment. */
  projectId: z.string().uuid(),
  commitmentId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(CHANGE_ORDER_STATUSES).optional(),
  requestedOn: optionalDate,
  approvedOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
  /** The client's change order this one passes down; blank for a change of the business's own. */
  changeOrderId: optionalUuid,
  lines: z.array(commitmentChangeLineSchema).max(200).optional(),
});

/**
 * A blank row moves nothing and is dropped, as on the order itself. Unlike a
 * client-side change order's line, a code is NOT required: a subcontract's own
 * lines may be uncoded, and a change to one follows the order it changes.
 */
function commitmentChangeLines(
  lines:
    | Array<{ costCodeId: string | null; description?: string; amountCents: number | null }>
    | undefined,
): CommitmentChangeLineInput[] | undefined {
  if (lines === undefined) return undefined;
  return lines
    .filter((l) => l.amountCents !== null)
    .map((l) => ({
      costCodeId: l.costCodeId,
      description: l.description,
      amountCents: l.amountCents as number,
    }));
}

export async function createCommitmentChangeOrderAction(input: unknown) {
  const parsed = commitmentChangeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, lines: rawLines, ...fields } = parsed.data;
  const lines = commitmentChangeLines(rawLines);
  try {
    const ctx = await gate();
    const change = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createCommitmentChangeOrder(tx, ctx, { ...fields, lines });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "commitment_change_order.created",
          targetType: "commitment_change_order",
          targetId: created.id,
          /* Identifiers and shape only; the amount is not logged, for the
             reason an order's is not. */
          meta: {
            commitmentId: created.commitmentId,
            status: created.status,
            lineCount: lines?.length ?? 0,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/commitments/${fields.commitmentId}`);
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(BASE);
    return { ok: true as const, changeOrderId: change.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateCommitmentChangeOrderAction(input: unknown) {
  const schema = commitmentChangeSchema
    // The order a change is against does not change; see updateCommitmentChangeOrder.
    .omit({ commitmentId: true })
    .partial()
    .extend({
      id: z.string().uuid(),
      version: z.number().int().positive().optional(),
    });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, lines: rawLines, ...patch } = parsed.data;
  const lines = commitmentChangeLines(rawLines);
  try {
    const ctx = await gate();
    const updated = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await updateCommitmentChangeOrder(tx, ctx, id, {
          ...patch,
          ...(lines === undefined ? {} : { lines }),
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "commitment_change_order.updated",
          targetType: "commitment_change_order",
          targetId: row.id,
          meta: { commitmentId: row.commitmentId, status: row.status },
        });
        return row;
      },
      { role: ctx.role },
    );
    if (projectId) {
      revalidatePath(`${BASE}/${projectId}/commitments/${updated.commitmentId}`);
      revalidatePath(`${BASE}/${projectId}`);
    }
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

// ------------------------------------------------------------------- billing

/**
 * A signed money box: `moneyToCents` with the sign kept, for a pay
 * application's `this period`, which may correct an earlier over-billing.
 * `moneyToCents` already keeps it — `Number("-1,500")` is a negative — so this
 * is the same transform under a name that says so.
 */
const signedMoneyToCents = moneyToCents;

const sovLineSchema = z.object({
  id: optionalUuid,
  description: z.string().trim().max(300),
  scheduledCents: moneyToCents,
  costCodeId: optionalUuid,
  changeOrderId: optionalUuid,
  /** Unit price: the unit, the estimated quantity and the price per unit; blank on a lump-sum line. */
  unit: z.string().trim().max(20).optional(),
  quantity: quantityToThousandths,
  unitPriceCents: moneyToCents,
});

const sovSchema = z.object({
  projectId: z.string().uuid(),
  contractId: z.string().uuid(),
  lines: z.array(sovLineSchema).max(500),
});

export async function saveSovAction(input: unknown) {
  const parsed = sovSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  // A row with no description is the empty last row; a described row with a
  // blank amount is scheduled at nothing, which is a real thing for a
  // milestone not yet priced.
  const lines = parsed.data.lines
    .filter((l) => l.description !== "")
    .map((l) => ({
      id: l.id ?? undefined,
      description: l.description,
      scheduledCents: l.scheduledCents ?? 0,
      costCodeId: l.costCodeId,
      changeOrderId: l.changeOrderId,
      unit: l.unit ?? "",
      quantityThousandths: l.quantity,
      unitPriceCents: l.unitPriceCents,
    }));
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const saved = await saveSovLines(tx, ctx, parsed.data.contractId, lines);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "sov.saved",
          targetType: "contract",
          targetId: parsed.data.contractId,
          /* Counts, never amounts: a schedule of values is the price of the
             job broken down, and the console is read by people who are not
             this business. */
          meta: { lineCount: saved.length },
        });
        return saved;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/contracts/${parsed.data.contractId}`);
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/** "10" or "7.5" → parts per million; a blank box is no retainage. */
const retainagePercent = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const ppm = percentStringToPpm(v);
    if (ppm === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "retainage must be a percent" });
      return z.NEVER;
    }
    return ppm;
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const payApplicationSchema = z.object({
  projectId: z.string().uuid(),
  contractId: z.string().uuid(),
  periodTo: isoDate,
  retainagePercent,
  notes: z.string().trim().max(2000).optional(),
});

export async function createPayApplicationAction(input: unknown) {
  const parsed = payApplicationSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, retainagePercent: retainagePpm, ...fields } = parsed.data;
  try {
    const ctx = await gate();
    const app = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createPayApplication(tx, ctx, { ...fields, retainagePpm });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "pay_application.created",
          targetType: "pay_application",
          targetId: created.id,
          meta: { contractId: created.contractId, number: created.number },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/contracts/${fields.contractId}`);
    revalidatePath(`${BASE}/${projectId}`);
    return { ok: true as const, payApplicationId: app.id };
  } catch (err) {
    return toResult(err);
  }
}

const payApplicationLineSchema = z.object({
  sovLineId: z.string().uuid(),
  /** May be negative: a correction of an earlier over-billing. */
  thisPeriodCents: signedMoneyToCents,
  storedCents: moneyToCents,
  /** Unit price: the quantity completed this period; blank is none. May be negative. */
  quantityThisPeriod: quantityToThousandths,
});

export async function updatePayApplicationAction(input: unknown) {
  const schema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    contractId: z.string().uuid(),
    periodTo: isoDate.optional(),
    retainagePercent,
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(payApplicationLineSchema).max(500).optional(),
    costLines: z
      .array(
        z.object({
          costCodeId: z.union([z.string().uuid(), z.null()]),
          thisPeriodCents: moneyToCents,
        }),
      )
      .max(500)
      .optional(),
    feeToDateCents: moneyToCents,
    /** Time and materials: what each person's line bills this period, in whole minutes; may be negative. */
    laborLines: z
      .array(
        z.object({
          workerId: z.string().uuid(),
          rateCents: z.number().int().nonnegative(),
          thisPeriodMinutes: z.number().int(),
        }),
      )
      .max(500)
      .optional(),
    version: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const {
    id,
    projectId,
    contractId,
    retainagePercent: retainagePpm,
    lines,
    costLines,
    feeToDateCents,
    laborLines,
    ...patch
  } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) =>
        updatePayApplication(tx, ctx, id, {
          ...patch,
          retainagePpm,
          // A blank box is nothing this period and nothing stored.
          lines: lines?.map((l) => ({
            sovLineId: l.sovLineId,
            thisPeriodCents: l.thisPeriodCents ?? 0,
            storedCents: l.storedCents ?? 0,
            quantityThisPeriodThousandths: l.quantityThisPeriod ?? undefined,
          })),
          // A blank box on a cost line bills nothing this period.
          costLines: costLines?.map((l) => ({
            costCodeId: l.costCodeId,
            thisPeriodCents: l.thisPeriodCents ?? 0,
          })),
          feeToDateCents: feeToDateCents ?? undefined,
          laborLines,
        }),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/contracts/${contractId}`);
    revalidatePath(`${BASE}/${projectId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function issuePayApplicationAction(input: unknown) {
  const parsed = z
    .object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      contractId: z.string().uuid(),
      issueDate: isoDate,
      version: z.number().int().positive().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, contractId, ...rest } = parsed.data;
  try {
    const ctx = await gate();
    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const issued = await issuePayApplication(tx, ctx, id, rest);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "pay_application.issued",
          targetType: "pay_application",
          targetId: issued.app.id,
          /* Identifiers only. The amount is on the invoice, where Accounting's
             own audit of it lives. */
          meta: {
            contractId: issued.app.contractId,
            number: issued.app.number,
            invoiceId: issued.invoiceId,
          },
        });
        return issued;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/contracts/${contractId}`);
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath("/dashboard/m/accounting");
    return { ok: true as const, invoiceId: result.invoiceId };
  } catch (err) {
    return toResult(err);
  }
}

export async function voidPayApplicationAction(input: unknown) {
  const parsed = z
    .object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      contractId: z.string().uuid(),
      version: z.number().int().positive().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, contractId, version } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const voided = await voidPayApplication(tx, ctx, id, { version });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "pay_application.voided",
          targetType: "pay_application",
          targetId: voided.id,
          meta: { contractId: voided.contractId, number: voided.number },
        });
        return voided;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/contracts/${contractId}`);
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath("/dashboard/m/accounting");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function deletePayApplicationAction(input: unknown) {
  const parsed = z
    .object({ id: z.string().uuid(), projectId: z.string().uuid(), contractId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, contractId } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(ctx.tenantId, (tx) => deletePayApplication(tx, ctx, id), { role: ctx.role });
    revalidatePath(`${BASE}/${projectId}/contracts/${contractId}`);
    revalidatePath(`${BASE}/${projectId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

// --------------------------------------------------------------------- field

/**
 * The field's write surface — chores, not decisions. `gate()` still
 * re-verifies the tenant and the module; the write level is the ops'
 * (`member`), because whoever is on the site writes the day.
 */
const crewLineSchema = z.object({
  partyId: optionalUuid,
  trade: z.string().trim().max(120).optional(),
  workers: z.number().int().min(0).max(10_000),
  /** "6.5" — hours EACH, as typed; tenths at the boundary. */
  hours: z.string().trim().max(10).optional(),
  notes: z.string().trim().max(300).optional(),
});

const dailyLogSchema = z.object({
  projectId: z.string().uuid(),
  logDate: isoDate,
  weather: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(4000).optional(),
  crews: z.array(crewLineSchema).max(100).optional(),
});

/**
 * A repeater's empty last row — no trade, no subcontractor — is dropped; a
 * named row with hours that are not a number is refused, because "6h" typed
 * into a box that wanted "6" must not become nothing on the report.
 */
function crewLines(
  crews: z.infer<typeof crewLineSchema>[] | undefined,
): { ok: true; crews: CrewInput[] | undefined } | { ok: false; error: string } {
  if (crews === undefined) return { ok: true, crews: undefined };
  const out: CrewInput[] = [];
  for (const c of crews) {
    if ((c.trade ?? "") === "" && !c.partyId) continue;
    const tenths = hoursToTenths(c.hours ?? "");
    if (tenths === null) return { ok: false, error: "Hours must be a number, like 8 or 6.5." };
    out.push({ partyId: c.partyId, trade: c.trade, workers: c.workers, hoursTenths: tenths, notes: c.notes });
  }
  return { ok: true, crews: out };
}

export async function saveDailyLogAction(input: unknown) {
  const parsed = dailyLogSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const crews = crewLines(parsed.data.crews);
  if (!crews.ok) return { error: crews.error };
  try {
    const ctx = await gate();
    const log = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const saved = await saveDailyLog(tx, ctx, { ...parsed.data, crews: crews.crews });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "daily_log.saved",
          targetType: "daily_log",
          targetId: saved.id,
          meta: { projectId: saved.projectId, logDate: saved.logDate },
        });
        return saved;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath(`${BASE}/${parsed.data.projectId}/log`);
    return { ok: true as const, logId: log.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteDailyLogAction(input: unknown) {
  const parsed = z.object({ id: z.string().uuid(), projectId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(ctx.tenantId, (tx) => deleteDailyLog(tx, ctx, parsed.data.id), { role: ctx.role });
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath(`${BASE}/${parsed.data.projectId}/log`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Photos of a day. The pattern the livestock pack set for a photo of an
 * animal: the pack owns the ACTIONS and core owns the TABLE, so the code that
 * names `job_daily_log` is here, where it is a fact rather than a string the
 * browser sent — and because `document_attachments` has no foreign key,
 * `assertLog` is the only thing that proves the day exists.
 *
 * Both gates: `jobs` because the day is this pack's, `documents` because the
 * FILE is the DMS's; and both write rules, because the accountant clears the
 * pack's `member` and not the DMS's `roleMayWrite`.
 */
const photoTarget = (logId: string) => ({
  extensionSlug: PACK,
  entityType: DAILY_LOG_ENTITY,
  entityId: logId,
});

const photoInput = z.object({ entityId: z.string().uuid(), pathname: z.string().min(1).max(500) });
const photoRef = z.object({ entityId: z.string().uuid(), documentId: z.string().uuid() });

async function photoGate() {
  const ctx = await gate();
  await requireModuleEnabled(ctx.tenantId, "documents");
  if (!allowsWrite(ctx.role, "member") || !roleMayWrite(ctx.role)) {
    throw new JobsError("FORBIDDEN", "cannot add photos here");
  }
  return ctx;
}

async function assertLog(ctx: JobsCtx, logId: string): Promise<string> {
  const log = await withTenant(ctx.tenantId, (tx) => getDailyLog(tx, ctx.tenantId, logId), {
    role: ctx.role,
  });
  if (!log) throw new JobsError("NOT_FOUND", `log ${logId} not found`);
  return log.projectId;
}

export async function attachLogPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoInput.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const projectId = await assertLog(ctx, parsed.data.entityId);
    const result = await registerAttachedPhoto(
      { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
      { pathname: parsed.data.pathname, target: photoTarget(parsed.data.entityId) },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/log`);
    return { ok: true as const, documentId: result.documentId };
  } catch (err) {
    return toResult(err);
  }
}

export async function setLogPhotoPrimaryAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const projectId = await assertLog(ctx, parsed.data.entityId);
    await withTenant(
      ctx.tenantId,
      (tx) =>
        setPrimaryAttachment(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          { documentId: parsed.data.documentId, target: photoTarget(parsed.data.entityId) },
        ),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/log`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function detachLogPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const projectId = await assertLog(ctx, parsed.data.entityId);
    await withTenant(
      ctx.tenantId,
      (tx) =>
        detachDocumentFromRecord(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          { documentId: parsed.data.documentId, target: photoTarget(parsed.data.entityId) },
        ),
      { role: ctx.role },
    );
    // The FILE stays in the cabinet: removing a photo from a day and deleting
    // a photo are different acts.
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/log`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function addPunchItemAction(input: unknown) {
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      title: z.string().trim().min(1).max(300),
      notes: z.string().trim().max(2000).optional(),
      dueOn: optionalDate,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Say what needs doing." };
  const { projectId, ...item } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(ctx.tenantId, (tx) => addPunchItem(tx, ctx, projectId, item), { role: ctx.role });
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath("/dashboard/m/work");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function setPunchDoneAction(input: unknown) {
  const parsed = z
    .object({ projectId: z.string().uuid(), itemId: z.string().uuid(), done: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) => setPunchDone(tx, ctx, parsed.data.itemId, parsed.data.done),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}`);
    revalidatePath("/dashboard/m/work");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

// ------------------------------------------------------------------------ wip

const wipPeriodSchema = z.object({
  entityId: z.string().uuid(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * The one thing a person types on a WIP schedule: what a job is now expected
 * to cost in total. Blank puts the revised budget back. Owner-only in the
 * op, because a re-estimate moves earned revenue.
 */
export async function saveWipEstimateAction(input: {
  entityId: string;
  periodEnd: string;
  projectId: string;
  estimate: string;
  notes?: string;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = wipPeriodSchema
    .extend({
      projectId: z.string().uuid(),
      estimate: z.string().trim().max(24),
      notes: z.string().trim().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  let estimateCents: number | null = null;
  if (parsed.data.estimate !== "") {
    estimateCents = parseMoneyToCents(parsed.data.estimate.replace(/,/g, ""));
    if (estimateCents === null || estimateCents < 0) {
      return { error: "An estimate must be an amount, like 1300000 or 1,300,000.00." };
    }
  }
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const line = await saveWipEstimate(tx, ctx, {
          entityId: parsed.data.entityId,
          periodEnd: parsed.data.periodEnd,
          projectId: parsed.data.projectId,
          estimateCents,
          notes: parsed.data.notes,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "wip.estimated",
          targetType: "wip_line",
          targetId: line.id,
          // Identifiers only: which job and which period, never the figure.
          meta: { projectId: line.projectId, periodEnd: parsed.data.periodEnd },
        });
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/wip`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/** Post the period: freeze the schedule and post the adjustment and its reversal. */
export async function postWipAction(input: {
  entityId: string;
  periodEnd: string;
  version?: number;
}): Promise<{ ok: true; entryId: string } | { error: string }> {
  const parsed = wipPeriodSchema
    .extend({ version: z.number().int().positive().optional() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const posted = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await postWip(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "wip.posted",
          targetType: "wip_period",
          targetId: result.period.id,
          meta: {
            entityId: parsed.data.entityId,
            periodEnd: parsed.data.periodEnd,
            entryId: result.entryId,
            reversalEntryId: result.reversalEntryId,
          },
        });
        return result;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/wip`);
    revalidatePath("/dashboard/m/accounting");
    return { ok: true as const, entryId: posted.entryId };
  } catch (err) {
    return toResult(err);
  }
}

/** Void both entries and put the period back to a draft. Latest period only. */
export async function unpostWipAction(input: {
  periodId: string;
  version: number;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = z
    .object({ periodId: z.string().uuid(), version: z.number().int().positive() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const period = await unpostWip(tx, ctx, parsed.data.periodId, {
          version: parsed.data.version,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "wip.unposted",
          targetType: "wip_period",
          targetId: period.id,
          meta: { entityId: period.entityId, periodEnd: period.periodEnd },
        });
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/wip`);
    revalidatePath("/dashboard/m/accounting");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}


// ------------------------------------------------- subcontractor applications

/**
 * The payable-side mirror of the pay-application actions (ADR 0061): the
 * same gate, the same shape, a bill at the end instead of an invoice.
 */
const subApplicationSchema = z.object({
  projectId: z.string().uuid(),
  commitmentId: z.string().uuid(),
  periodTo: isoDate,
  retainagePercent,
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createSubApplicationAction(input: unknown) {
  const parsed = subApplicationSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, retainagePercent: retainagePpm, ...fields } = parsed.data;
  try {
    const ctx = await gate();
    const app = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createSubApplication(tx, ctx, { ...fields, retainagePpm });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "sub_application.created",
          targetType: "sub_application",
          targetId: created.id,
          meta: { commitmentId: created.commitmentId, number: created.number },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/commitments/${fields.commitmentId}`);
    revalidatePath(`${BASE}/${projectId}`);
    return { ok: true as const, subApplicationId: app.id };
  } catch (err) {
    return toResult(err);
  }
}

const subApplicationLineSchema = z.object({
  commitmentLineId: z.string().uuid(),
  thisPeriodCents: moneyToCents,
  storedCents: moneyToCents,
});

export async function updateSubApplicationAction(input: unknown) {
  const schema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    commitmentId: z.string().uuid(),
    periodTo: isoDate.optional(),
    retainagePercent,
    reference: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(subApplicationLineSchema).max(500).optional(),
    version: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, commitmentId, retainagePercent: retainagePpm, lines, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) =>
        updateSubApplication(tx, ctx, id, {
          ...patch,
          retainagePpm,
          lines: lines?.map((l) => ({
            commitmentLineId: l.commitmentLineId,
            thisPeriodCents: l.thisPeriodCents ?? 0,
            storedCents: l.storedCents ?? 0,
          })),
        }),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/commitments/${commitmentId}`);
    revalidatePath(`${BASE}/${projectId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function approveSubApplicationAction(input: unknown) {
  const parsed = z
    .object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      commitmentId: z.string().uuid(),
      billDate: isoDate,
      version: z.number().int().positive().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, commitmentId, ...rest } = parsed.data;
  try {
    const ctx = await gate();
    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const approved = await approveSubApplication(tx, ctx, id, rest);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "sub_application.approved",
          targetType: "sub_application",
          targetId: approved.app.id,
          // Identifiers only: which subcontract, which bill. Never the amount.
          meta: { commitmentId, number: approved.app.number, billId: approved.billId },
        });
        return approved;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/commitments/${commitmentId}`);
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath("/dashboard/m/accounting/purchases/bills");
    return { ok: true as const, billId: result.billId };
  } catch (err) {
    return toResult(err);
  }
}

export async function voidSubApplicationAction(input: unknown) {
  const parsed = z
    .object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      commitmentId: z.string().uuid(),
      version: z.number().int().positive().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, commitmentId, version } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const voided = await voidSubApplication(tx, ctx, id, { version });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "sub_application.voided",
          targetType: "sub_application",
          targetId: voided.id,
          meta: { commitmentId, number: voided.number },
        });
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/commitments/${commitmentId}`);
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath("/dashboard/m/accounting/purchases/bills");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteSubApplicationAction(input: unknown) {
  const parsed = z
    .object({ id: z.string().uuid(), projectId: z.string().uuid(), commitmentId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, commitmentId } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(ctx.tenantId, (tx) => deleteSubApplication(tx, ctx, id), { role: ctx.role });
    revalidatePath(`${BASE}/${projectId}/commitments/${commitmentId}`);
    revalidatePath(`${BASE}/${projectId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

// ------------------------------------------------------------ lien waivers

const lienWaiverSchema = z.object({
  projectId: z.string().uuid(),
  partyId: z.string().uuid(),
  commitmentId: optionalUuid,
  subApplicationId: optionalUuid,
  kind: z.enum(LIEN_WAIVER_KINDS),
  throughDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The payment the form names; blank means it states none. */
  amountCents: moneyToCents,
  status: z.enum(LIEN_WAIVER_STATUSES).optional(),
  requestedOn: optionalDate,
  receivedOn: optionalDate,
  signedBy: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Recording a waiver is a `member` chore — the decision it protects is the
 * payment, which is Accounting's and an owner's — and its photos follow the
 * daily log's gate.
 */
async function waiverGate(): Promise<JobsCtx> {
  const ctx = await gate();
  if (!allowsWrite(ctx.role, "member")) {
    throw new JobsError("FORBIDDEN", "cannot record lien waivers");
  }
  return ctx;
}

export async function createLienWaiverAction(input: unknown) {
  const parsed = lienWaiverSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { amountCents, ...fields } = parsed.data;
  try {
    const ctx = await waiverGate();
    const waiver = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createLienWaiver(tx, ctx, { ...fields, amountCents: amountCents ?? 0 });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "lien_waiver.created",
          targetType: "lien_waiver",
          targetId: created.id,
          meta: { projectId: created.projectId, commitmentId: created.commitmentId, kind: created.kind, status: created.status },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${fields.projectId}`);
    if (fields.commitmentId) revalidatePath(`${BASE}/${fields.projectId}/commitments/${fields.commitmentId}`);
    return { ok: true as const, lienWaiverId: waiver.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateLienWaiverAction(input: unknown) {
  const schema = lienWaiverSchema
    .omit({ projectId: true })
    .partial()
    .extend({
      id: z.string().uuid(),
      /** For revalidation only. */
      projectId: z.string().uuid(),
      version: z.number().int().positive().optional(),
    });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, amountCents, ...patch } = parsed.data;
  try {
    const ctx = await waiverGate();
    const updated = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await updateLienWaiver(tx, ctx, id, {
          ...patch,
          ...(amountCents === undefined ? {} : { amountCents: amountCents ?? 0 }),
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "lien_waiver.updated",
          targetType: "lien_waiver",
          targetId: row.id,
          meta: { projectId: row.projectId, commitmentId: row.commitmentId, kind: row.kind, status: row.status },
        });
        return row;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    if (updated.commitmentId) revalidatePath(`${BASE}/${projectId}/commitments/${updated.commitmentId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const askForWaiverSchema = z.object({
  projectId: z.string().uuid(),
  commitmentId: z.string().uuid(),
  missing: z.enum(["unconditional", "conditional"]),
  throughDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueOn: optionalDate,
});

/** The chase, as a Work item linked to the order. */
export async function askForWaiverAction(input: unknown) {
  const parsed = askForWaiverSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { projectId, ...fields } = parsed.data;
  try {
    const ctx = await waiverGate();
    const itemId = await withTenant(ctx.tenantId, (tx) => askForWaiver(tx, ctx, fields), { role: ctx.role });
    revalidatePath(`${BASE}/${projectId}/commitments/${fields.commitmentId}`);
    return { ok: true as const, itemId };
  } catch (err) {
    return toResult(err);
  }
}

/** The signed copy: photos on the waiver, through Documents, the daily log's way. */
const waiverTarget = (entityId: string) => ({
  extensionSlug: PACK,
  entityType: LIEN_WAIVER_ENTITY,
  entityId,
});

async function assertWaiver(ctx: JobsCtx, waiverId: string): Promise<{ projectId: string; commitmentId: string | null }> {
  const waiver = await withTenant(ctx.tenantId, (tx) => getLienWaiver(tx, ctx.tenantId, waiverId), {
    role: ctx.role,
  });
  if (!waiver) throw new JobsError("NOT_FOUND", `lien waiver ${waiverId} not found`);
  return { projectId: waiver.projectId, commitmentId: waiver.commitmentId };
}

function revalidateWaiver(where: { projectId: string; commitmentId: string | null }): void {
  revalidatePath(`${BASE}/${where.projectId}`);
  if (where.commitmentId) revalidatePath(`${BASE}/${where.projectId}/commitments/${where.commitmentId}`);
}

export async function attachWaiverPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoInput.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const where = await assertWaiver(ctx, parsed.data.entityId);
    const result = await registerAttachedPhoto(
      { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
      { pathname: parsed.data.pathname, target: waiverTarget(parsed.data.entityId), title: "Lien waiver" },
    );
    revalidateWaiver(where);
    return { ok: true as const, documentId: result.documentId };
  } catch (err) {
    return toResult(err);
  }
}

export async function setWaiverPhotoPrimaryAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const where = await assertWaiver(ctx, parsed.data.entityId);
    await withTenant(
      ctx.tenantId,
      (tx) =>
        setPrimaryAttachment(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          { documentId: parsed.data.documentId, target: waiverTarget(parsed.data.entityId) },
        ),
      { role: ctx.role },
    );
    revalidateWaiver(where);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function detachWaiverPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const where = await assertWaiver(ctx, parsed.data.entityId);
    await withTenant(
      ctx.tenantId,
      (tx) =>
        detachDocumentFromRecord(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          { documentId: parsed.data.documentId, target: waiverTarget(parsed.data.entityId) },
        ),
      { role: ctx.role },
    );
    revalidateWaiver(where);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

// -------------------------------------------------------------- selections

const selectionChoiceSchema = z.object({
  id: optionalUuid,
  description: z.string().trim().min(1).max(300),
  partyId: optionalUuid,
  reference: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(20).optional(),
  /** "320" → 320,000 thousandths; blank → null. */
  quantity: quantityToThousandths,
  unitPriceCents: moneyToCents,
  priceCents: moneyToCents,
  isSelected: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const selectionSchema = z.object({
  projectId: z.string().uuid(),
  contractId: optionalUuid,
  costCodeId: optionalUuid,
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  allowanceCents: moneyToCents,
  neededBy: optionalDate,
  status: z.enum(SELECTION_STATUSES).optional(),
  decidedOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
  choices: z.array(selectionChoiceSchema).max(100).optional(),
});

/**
 * A choice with no description is a blank row and is dropped; the extended
 * price is what was typed, or the quantity at the unit price when both are
 * given — `saveChoices` computes that, so a blank price beside a unit pair is
 * not a zero.
 */
function selectionChoices(
  choices: z.infer<typeof selectionChoiceSchema>[] | undefined,
): SelectionChoiceInput[] | undefined {
  if (choices === undefined) return undefined;
  return choices
    .filter((c) => c.description.trim() !== "")
    .map((c) => ({
      id: c.id ?? undefined,
      description: c.description,
      partyId: c.partyId,
      reference: c.reference,
      unit: c.unit,
      quantityThousandths: c.quantity,
      unitPriceCents: c.unitPriceCents,
      priceCents: c.priceCents ?? 0,
      isSelected: c.isSelected ?? false,
      notes: c.notes,
    }));
}

/** Drawing up the list and recording the client's choice is a member's chore; raising money is not (see below). */
async function selectionGate(): Promise<JobsCtx> {
  const ctx = await gate();
  if (!allowsWrite(ctx.role, "member")) {
    throw new JobsError("FORBIDDEN", "cannot record selections");
  }
  return ctx;
}

export async function createSelectionAction(input: unknown) {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { allowanceCents, choices, ...fields } = parsed.data;
  try {
    const ctx = await selectionGate();
    const selection = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createSelection(tx, ctx, {
          ...fields,
          allowanceCents: allowanceCents ?? 0,
          choices: selectionChoices(choices),
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "selection.created",
          targetType: "selection",
          targetId: created.id,
          /* Identifiers and shape only: the allowance is the contract's price. */
          meta: { projectId: created.projectId, contractId: created.contractId, status: created.status },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${fields.projectId}`);
    revalidatePath(`${BASE}/${fields.projectId}/selections`);
    return { ok: true as const, selectionId: selection.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateSelectionAction(input: unknown) {
  const schema = selectionSchema
    .omit({ projectId: true })
    .partial()
    .extend({
      id: z.string().uuid(),
      /** For revalidation only. */
      projectId: z.string().uuid(),
      version: z.number().int().positive().optional(),
    });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, projectId, allowanceCents, choices, ...patch } = parsed.data;
  try {
    const ctx = await selectionGate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await updateSelection(tx, ctx, id, {
          ...patch,
          ...(allowanceCents === undefined ? {} : { allowanceCents: allowanceCents ?? 0 }),
          ...(choices === undefined ? {} : { choices: selectionChoices(choices) }),
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "selection.updated",
          targetType: "selection",
          targetId: row.id,
          meta: { projectId: row.projectId, contractId: row.contractId, status: row.status },
        });
        return row;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/selections`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const raiseSelectionSchema = z.object({
  projectId: z.string().uuid(),
  selectionId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  title: z.string().trim().max(200).optional(),
  status: z.enum(CHANGE_ORDER_STATUSES).optional(),
  approvedOn: optionalDate,
  requestedOn: optionalDate,
});

/** The difference as a change order — an owner's act, held by the change order's own verb. */
export async function raiseSelectionChangeOrderAction(input: unknown) {
  const parsed = raiseSelectionSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, selectionId, ...fields } = parsed.data;
  try {
    const ctx = await gate();
    const changeOrder = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await raiseSelectionChangeOrder(tx, ctx, selectionId, fields);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "change_order.created",
          targetType: "change_order",
          targetId: created.id,
          meta: { contractId: created.contractId, status: created.status, selectionId },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/selections`);
    revalidatePath(BASE);
    return { ok: true as const, changeOrderId: changeOrder.id };
  } catch (err) {
    return toResult(err);
  }
}

const remindSelectionSchema = z.object({
  projectId: z.string().uuid(),
  selectionId: z.string().uuid(),
  dueOn: optionalDate,
});

/** The reminder, as a Work item linked to the selection. */
export async function remindSelectionAction(input: unknown) {
  const parsed = remindSelectionSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { projectId, selectionId, dueOn } = parsed.data;
  try {
    const ctx = await selectionGate();
    const itemId = await withTenant(ctx.tenantId, (tx) => remindSelection(tx, ctx, selectionId, { dueOn }), {
      role: ctx.role,
    });
    revalidatePath(`${BASE}/${projectId}/selections`);
    return { ok: true as const, itemId };
  } catch (err) {
    return toResult(err);
  }
}

/** Samples and spec sheets: photos on the selection, through Documents, the daily log's way. */
const selectionTarget = (entityId: string) => ({
  extensionSlug: PACK,
  entityType: SELECTION_ENTITY,
  entityId,
});

async function assertSelection(ctx: JobsCtx, selectionId: string): Promise<string> {
  const selection = await withTenant(ctx.tenantId, (tx) => getSelection(tx, ctx.tenantId, selectionId), {
    role: ctx.role,
  });
  if (!selection) throw new JobsError("NOT_FOUND", `selection ${selectionId} not found`);
  return selection.projectId;
}

export async function attachSelectionPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoInput.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const projectId = await assertSelection(ctx, parsed.data.entityId);
    const result = await registerAttachedPhoto(
      { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
      { pathname: parsed.data.pathname, target: selectionTarget(parsed.data.entityId), title: "Selection" },
    );
    revalidatePath(`${BASE}/${projectId}/selections`);
    return { ok: true as const, documentId: result.documentId };
  } catch (err) {
    return toResult(err);
  }
}

export async function setSelectionPhotoPrimaryAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const projectId = await assertSelection(ctx, parsed.data.entityId);
    await withTenant(
      ctx.tenantId,
      (tx) =>
        setPrimaryAttachment(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          { documentId: parsed.data.documentId, target: selectionTarget(parsed.data.entityId) },
        ),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/selections`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function detachSelectionPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const projectId = await assertSelection(ctx, parsed.data.entityId);
    await withTenant(
      ctx.tenantId,
      (tx) =>
        detachDocumentFromRecord(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          { documentId: parsed.data.documentId, target: selectionTarget(parsed.data.entityId) },
        ),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}/selections`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

// -------------------------------------------------------------- estimates

/** "10" → 100,000 ppm; blank → null; anything else refuses. Up to 1,000%. */
const rateToPpm = z
  .union([z.string(), z.number(), z.literal("")])
  .optional()
  .transform((v, ctx) => {
    if (v === "" || v === undefined || v === null) return null;
    const ppm = rateStringToPpm(String(v));
    if (ppm === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a rate" });
      return z.NEVER;
    }
    return ppm;
  });

const estimateLineSchema = z.object({
  id: optionalUuid,
  costCodeId: optionalUuid,
  description: z.string().trim().min(1).max(300),
  unit: z.string().trim().max(20).optional(),
  /** "320" → 320,000 thousandths; blank → one. */
  quantity: quantityToThousandths,
  unitCostCents: moneyToCents,
  /** This line's markup; blank takes the estimate's default. */
  markupPercent: rateToPpm,
  /** An explicit price per unit; blank means priced by markup. */
  unitPriceCents: moneyToCents,
  notes: z.string().trim().max(1000).optional(),
});

const estimateSchema = z.object({
  projectId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  title: z.string().trim().max(200).optional(),
  status: z.enum(ESTIMATE_STATUSES).optional(),
  sentOn: optionalDate,
  decidedOn: optionalDate,
  validUntil: optionalDate,
  markupPercent: rateToPpm,
  overheadPercent: rateToPpm,
  profitPercent: rateToPpm,
  notes: z.string().trim().max(4000).optional(),
  lines: z.array(estimateLineSchema).max(500).optional(),
});

/** A blank description is a blank row and is dropped; a blank quantity is one. */
function estimateLines(
  lines: z.infer<typeof estimateLineSchema>[] | undefined,
): EstimateLineInput[] | undefined {
  if (lines === undefined) return undefined;
  return lines
    .filter((l) => l.description.trim() !== "")
    .map((l) => ({
      id: l.id ?? undefined,
      costCodeId: l.costCodeId,
      description: l.description,
      unit: l.unit,
      quantityThousandths: l.quantity ?? 1000,
      unitCostCents: l.unitCostCents ?? 0,
      markupPpm: l.markupPercent,
      unitPriceCents: l.unitPriceCents,
      notes: l.notes,
    }));
}

/** Writing an estimate is the estimator's chore; making it money is an owner's act, held by the verbs. */
async function estimateGate(): Promise<JobsCtx> {
  const ctx = await gate();
  if (!allowsWrite(ctx.role, "member")) {
    throw new JobsError("FORBIDDEN", "cannot write estimates");
  }
  return ctx;
}

function estimateFields(data: z.infer<typeof estimateSchema>) {
  const { projectId, markupPercent, overheadPercent, profitPercent, lines, ...rest } = data;
  return {
    projectId,
    fields: {
      ...rest,
      ...(markupPercent === undefined ? {} : { markupPpm: markupPercent ?? 0 }),
      ...(overheadPercent === undefined ? {} : { overheadPpm: overheadPercent ?? 0 }),
      ...(profitPercent === undefined ? {} : { profitPpm: profitPercent ?? 0 }),
      ...(lines === undefined ? {} : { lines: estimateLines(lines) }),
    },
  };
}

export async function createEstimateAction(input: unknown) {
  const parsed = estimateSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, fields } = estimateFields(parsed.data);
  try {
    const ctx = await estimateGate();
    const estimate = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createEstimate(tx, ctx, { projectId, ...fields });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "estimate.created",
          targetType: "estimate",
          targetId: created.id,
          /* Identifiers and shape only: the price is the bid. */
          meta: { projectId: created.projectId, status: created.status, lineCount: fields.lines?.length ?? 0 },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/estimates`);
    return { ok: true as const, estimateId: estimate.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateEstimateAction(input: unknown) {
  const schema = estimateSchema
    .partial()
    .extend({
      id: z.string().uuid(),
      /** For revalidation only. */
      projectId: z.string().uuid(),
      version: z.number().int().positive().optional(),
    });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, version, number, ...rest } = parsed.data;
  const { projectId, fields } = estimateFields({ ...rest, number: number ?? "" } as z.infer<typeof estimateSchema>);
  // A blank number is "not sent", never "make it blank": the op leaves undefined alone.
  const patch = number === undefined ? { ...fields, number: undefined } : fields;
  try {
    const ctx = await estimateGate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await updateEstimate(tx, ctx, id, { ...patch, version });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "estimate.updated",
          targetType: "estimate",
          targetId: row.id,
          meta: { projectId: row.projectId, status: row.status },
        });
        return row;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/estimates`);
    revalidatePath(`${BASE}/${projectId}/estimates/${id}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const acceptEstimateSchema = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid(),
  contractId: z.string().uuid(),
  decidedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  version: z.number().int().positive().optional(),
});

/** Accept onto a contract: an owner's act, and the contract's value follows. */
export async function acceptEstimateAction(input: unknown) {
  const parsed = acceptEstimateSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { projectId, id, ...fields } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await acceptEstimate(tx, ctx, id, fields);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "estimate.accepted",
          targetType: "estimate",
          targetId: row.id,
          meta: { projectId: row.projectId, contractId: row.contractId },
        });
        return row;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/estimates`);
    revalidatePath(`${BASE}/${projectId}/estimates/${id}`);
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const applyEstimateSchema = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid(),
  contractId: optionalUuid,
});

export async function applyEstimateToBudgetAction(input: unknown) {
  const parsed = applyEstimateSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { projectId, id } = parsed.data;
  try {
    const ctx = await gate();
    const result = await withTenant(ctx.tenantId, (tx) => applyEstimateToBudget(tx, ctx, id), { role: ctx.role });
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/estimates/${id}`);
    return { ok: true as const, ...result };
  } catch (err) {
    return toResult(err);
  }
}

export async function applyEstimateToScheduleAction(input: unknown) {
  const parsed = applyEstimateSchema.safeParse(input);
  if (!parsed.success || !parsed.data.contractId) return { error: "Pick the contract the schedule belongs to." };
  const { projectId, id, contractId } = parsed.data;
  try {
    const ctx = await gate();
    const result = await withTenant(ctx.tenantId, (tx) => applyEstimateToSchedule(tx, ctx, id, contractId), {
      role: ctx.role,
    });
    revalidatePath(`${BASE}/${projectId}`);
    revalidatePath(`${BASE}/${projectId}/contracts/${contractId}`);
    revalidatePath(`${BASE}/${projectId}/estimates/${id}`);
    return { ok: true as const, ...result };
  } catch (err) {
    return toResult(err);
  }
}
