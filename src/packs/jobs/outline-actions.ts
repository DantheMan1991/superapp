"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { listCostCodes, JobsError, type JobsCtx } from "./ops";
import { outlineFromCostCodes } from "./outline-math";
import { proposeMerges } from "./outline-merge";
import {
  copyQuestionsBetweenOutlines,
  createOutline,
  deleteOutline,
  duplicateOutline,
  loadOutline,
  setDefaultOutline,
  updateOutline,
} from "./outline-ops";
import { PACK } from "./vocabulary";

/**
 * The estimate outline editor's doors (X1, ADR 0098).
 *
 * Its own file rather than another page of `actions.ts`, which is 168KB and
 * is read in full by every agent that touches this pack. Same shape as every
 * action there: parse, gate, one transaction, audit inside it, a flat result
 * a form can render.
 *
 * WRITING IS OWNER-ONLY and `requireWrite` in the ops says so — not repeated
 * here, because a second place that decides it is a second place to get it
 * wrong.
 */

const BASE = "/dashboard/m/jobs";
const OUTLINES = `${BASE}/estimate-outlines`;

async function gate(): Promise<JobsCtx> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return { tenantId: tenant.tenant.id, userId: tenant.userId, role: tenant.role };
}

function sentence(message: string): string {
  const m = message.trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
}

function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change an outline." };
      case "NOT_FOUND":
        return { error: "That outline is no longer here. Reload the page." };
      case "NAME_TAKEN":
        return { error: sentence(err.message) };
      case "STALE_VERSION":
        return {
          error:
            "Somebody else saved this outline while you were editing. Reload and make your change again.",
        };
      case "INVALID_VALUE":
        return { error: sentence(err.message) };
      default:
        return { error: "That did not work. Try again." };
    }
  }
  return { error: "That did not work. Try again." };
}

/**
 * The editor posts the WHOLE outline, and a row keeps its id: given by id it
 * is updated, absent it is inserted, left out it is removed. The estimate's
 * own rule (ADR 0082), and the reason the ids ride the wire.
 */
const questionSchema = z.object({
  id: z.string().uuid().optional(),
  prompt: z.string().trim().min(1).max(500),
  kind: z.enum(["choice", "yes_no", "number", "money", "text"]).optional(),
  choices: z.array(z.string().max(120)).max(12).optional(),
  unit: z.string().trim().max(24).optional(),
  notes: z.string().trim().max(2000).optional(),
  alwaysAsk: z.boolean().optional(),
  /** The answer this business gives every time (X13); blank means ask. */
  standardAnswer: z.string().trim().max(500).optional(),
});

const stepSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  section: z.string().trim().max(120).optional(),
  costCode: z.string().trim().max(60).optional(),
  guidance: z.string().trim().max(4000).optional(),
  /**
   * The assembly this step always makes (X11). **Nullable on purpose**: the
   * editor posts the whole outline, so `null` is how a step is unpinned and
   * an omitted field leaves the pin alone. The id is not checked here — the
   * composite `(tenant_id, assembly_id)` foreign key refuses another
   * tenant's, which is a check no application code can forget to make.
   */
  assemblyId: z.string().uuid().nullable().optional(),
  questions: z.array(questionSchema).max(40).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  /** Blank makes an empty outline; a set id reads the starter off that chart. */
  fromCostCodeSetId: z.string().uuid().optional(),
});

export async function createOutlineAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const outline = await withTenant(
      ctx.tenantId,
      async (tx) => {
        /**
         * A STARTER READ OFF THE CHART OF COST, when one is named. A
         * business's cost code list is already its phases in the order it
         * builds them, so this is the shortest road to an outline worth
         * editing — far shorter than typing thirty step names.
         */
        let steps = undefined;
        if (parsed.data.fromCostCodeSetId) {
          const codes = await listCostCodes(tx, ctx.tenantId, parsed.data.fromCostCodeSetId);
          steps = outlineFromCostCodes(codes);
        }
        const created = await createOutline(tx, ctx, {
          name: parsed.data.name,
          notes: parsed.data.notes,
          steps,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_outline.created",
          targetType: "job_estimate_outline",
          targetId: created.id,
          meta: { fromCostCodes: Boolean(parsed.data.fromCostCodeSetId) },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(OUTLINES);
    return { ok: true as const, outlineId: outline.id };
  } catch (err) {
    return toResult(err);
  }
}

const saveSchema = z.object({
  outlineId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  /**
   * **HIGH ENOUGH THAT THE TOOL CANNOT GENERATE AN OUTLINE IT REFUSES TO
   * SAVE.** Reading an outline off a chart used to mean one step per code,
   * and a 291-code chart would have produced something that could be created
   * and then never edited — including to delete the steps that made it too
   * big. Grouping brings a chart like that to about seventy, but the cap is
   * the backstop for a chart whose names share nothing.
   */
  steps: z.array(stepSchema).max(500).optional(),
  version: z.number().int().positive().optional(),
});

export async function saveOutlineAction(input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { outlineId, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    const outline = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const saved = await updateOutline(tx, ctx, outlineId, patch);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_outline.saved",
          targetType: "job_estimate_outline",
          targetId: outlineId,
          meta: { steps: patch.steps?.length ?? null },
        });
        return saved;
      },
      { role: ctx.role },
    );
    revalidatePath(OUTLINES);
    revalidatePath(`${OUTLINES}/${outlineId}`);
    return { ok: true as const, version: outline.version };
  } catch (err) {
    return toResult(err);
  }
}

const idSchema = z.object({ outlineId: z.string().uuid() });

export async function setDefaultOutlineAction(input: unknown) {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await setDefaultOutline(tx, ctx, parsed.data.outlineId);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_outline.default_set",
          targetType: "job_estimate_outline",
          targetId: parsed.data.outlineId,
        });
      },
      { role: ctx.role },
    );
    revalidatePath(OUTLINES);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const duplicateSchema = idSchema.extend({
  name: z.string().trim().min(1).max(120),
});

export async function duplicateOutlineAction(input: unknown) {
  const parsed = duplicateSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const copy = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const made = await duplicateOutline(
          tx,
          ctx,
          parsed.data.outlineId,
          parsed.data.name,
        );
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_outline.duplicated",
          targetType: "job_estimate_outline",
          targetId: made.id,
          meta: { from: parsed.data.outlineId },
        });
        return made;
      },
      { role: ctx.role },
    );
    revalidatePath(OUTLINES);
    return { ok: true as const, outlineId: copy.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteOutlineAction(input: unknown) {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await deleteOutline(tx, ctx, parsed.data.outlineId);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_outline.deleted",
          targetType: "job_estimate_outline",
          targetId: parsed.data.outlineId,
        });
      },
      { role: ctx.role },
    );
    revalidatePath(OUTLINES);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}


/* ------------------------------------------------------------------------
 * BRINGING ONE OUTLINE'S QUESTIONS ONTO ANOTHER'S STEPS.
 * ---------------------------------------------------------------------- */

const proposeSchema = z.object({
  fromOutlineId: z.string().uuid(),
  intoOutlineId: z.string().uuid(),
});

/**
 * What the review screen shows: one row per source step that has questions,
 * with the target this matched to and the reason. **Read only — nothing is
 * written until somebody has looked at every row.**
 */
export async function proposeQuestionMergeAction(input: unknown) {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const out = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const from = await loadOutline(tx, ctx.tenantId, parsed.data.fromOutlineId);
        const into = await loadOutline(tx, ctx.tenantId, parsed.data.intoOutlineId);
        if (!from || !into) throw new JobsError("NOT_FOUND", "that outline is no longer here");
        const shape = (o: NonNullable<typeof from>) =>
          o.steps.map((x) => ({ id: x.id, title: x.title, questions: x.questions.length }));
        return {
          proposals: proposeMerges(shape(from), shape(into)),
          /** Every step of the target, so a row can be pointed anywhere. */
          targets: into.steps.map((x) => ({
            id: x.id,
            title: x.title,
            section: x.section,
            questions: x.questions.length,
          })),
          fromName: from.outline.name,
          intoName: into.outline.name,
        };
      },
      { role: ctx.role },
    );
    return { ok: true as const, ...out };
  } catch (err) {
    return toResult(err);
  }
}

const copySchema = z.object({
  fromOutlineId: z.string().uuid(),
  intoOutlineId: z.string().uuid(),
  pairs: z
    .array(z.object({ fromStepId: z.string().uuid(), intoStepId: z.string().uuid() }))
    .max(500),
});

export async function copyQuestionsAction(input: unknown) {
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  if (parsed.data.pairs.length === 0) {
    return { error: "Nothing was ticked, so nothing was copied." };
  }
  try {
    const ctx = await gate();
    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const out = await copyQuestionsBetweenOutlines(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_outline.questions_copied",
          targetType: "job_estimate_outline",
          targetId: parsed.data.intoOutlineId,
          meta: { from: parsed.data.fromOutlineId, copied: out.copied, steps: out.steps },
        });
        return out;
      },
      { role: ctx.role },
    );
    revalidatePath(OUTLINES);
    revalidatePath(`${OUTLINES}/${parsed.data.intoOutlineId}`);
    return { ok: true as const, ...result };
  } catch (err) {
    return toResult(err);
  }
}
