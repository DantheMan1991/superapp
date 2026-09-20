import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimateProposedLine } from "@/db/schema";
import { explodeAssembly, resolveCostCode } from "./assembly-math";
import { getAssembly, listAssemblies } from "./assembly-ops";
import { priceBookFrom } from "./price-memory";
import {
  priceProposed,
  type PricedLine,
  type ProposedShape,
} from "./walk-lines-math";
import { getEstimate, priceBookRows, updateEstimate } from "./estimating-ops";
import { listCostCodes } from "./ops";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import type { WalkStep } from "./walk-math";

/**
 * A STEP'S LINES (X2b, ADR 0098): priced here, reviewed, then put on the
 * estimate.
 *
 * ── THE MONEY IS PUT ON IN THIS FILE AND NOWHERE ELSE ───────────────────────
 *
 * The model proposes a shape and names a source; `priceProposed` and
 * `explodeAssembly` are the only things that turn one into a number. That is
 * the safety argument of the slice reduced to a place: there is one function
 * to read if you want to know where a figure on a walked estimate came from.
 *
 * ── APPLYING GOES THROUGH `updateEstimate`, LIKE EVERYTHING ELSE ────────────
 *
 * Not a private insert. The walk writes exactly what the editor writes —
 * `EstimateGroupInput` and `EstimateLineInput`, one whole-form save (ADR
 * 0082) — so it cannot produce an estimate the editor cannot show or the
 * proposal cannot print, and turning the layer off leaves ordinary rows.
 */

/** A step becomes an ITEM the client buys (ADR 0079), named after the step. */
export interface AppliedProposal {
  groupName: string;
  lines: number;
}

export async function listProposal(
  tx: Tx,
  tenantId: string,
  interviewId: string,
  stepId: string | null,
): Promise<JobEstimateProposedLine[]> {
  return tx
    .select()
    .from(schema.jobEstimateProposedLines)
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        stepId === null
          ? isNull(schema.jobEstimateProposedLines.stepId)
          : eq(schema.jobEstimateProposedLines.stepId, stepId),
        /** Only what has not been put on the estimate yet. */
        isNull(schema.jobEstimateProposedLines.estimateLineId),
      ),
    )
    .orderBy(asc(schema.jobEstimateProposedLines.sortOrder));
}

/** Everything a step proposed before, cleared so a re-run does not double up. */
export async function clearProposal(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  stepId: string | null,
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .delete(schema.jobEstimateProposedLines)
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, ctx.tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        stepId === null
          ? isNull(schema.jobEstimateProposedLines.stepId)
          : eq(schema.jobEstimateProposedLines.stepId, stepId),
        isNull(schema.jobEstimateProposedLines.estimateLineId),
      ),
    );
}

/**
 * Turn the shapes into priced lines and write them down.
 *
 * **AN ASSEMBLY MAKES SEVERAL LINES AND THEY KEEP ITS PRICES.** That is the
 * best basis there is — the business priced those lines itself, at a size it
 * chose — so it is tried first, and `priceProposed` is what everything else
 * falls back to.
 */
export async function proposeLines(
  tx: Tx,
  ctx: JobsCtx,
  input: {
    interviewId: string;
    step: WalkStep;
    shapes: readonly ProposedShape[];
    /** Every answer on this step, for checking a figure it says was said. */
    answers: readonly string[];
    today: string;
  },
): Promise<JobEstimateProposedLine[]> {
  requireWrite(ctx, "member");
  await clearProposal(tx, ctx, input.interviewId, input.step.id);
  if (input.shapes.length === 0) return [];

  const book = priceBookFrom(await priceBookRows(tx, ctx.tenantId));
  const library = await listAssemblies(tx, ctx.tenantId);

  const priced: PricedLine[] = [];
  for (const shape of input.shapes) {
    const named = shape.assembly
      ? library.find(
          (a) => a.assembly.name.trim().toLowerCase() === shape.assembly!.trim().toLowerCase(),
        )
      : undefined;

    if (named) {
      const loaded = await getAssembly(tx, ctx.tenantId, named.assembly.id);
      if (loaded && loaded.lines.length > 0) {
        /**
         * The size to drop it at is the quantity the shape carries, when the
         * transcript backed it; `priceProposed` has already decided whether
         * it did, so this asks it rather than re-deciding.
         */
        const decided = priceProposed(shape, input.answers, book, input.today);
        const exploded = explodeAssembly(
          loaded.assembly,
          loaded.lines,
          decided.quantityThousandths,
        );
        for (const line of exploded) {
          priced.push({
            description: line.description,
            clientDescription: line.clientDescription,
            clientVisible: line.clientVisible,
            unit: line.unit,
            quantityThousandths: line.quantityThousandths,
            unitCostCents: line.unitCostCents,
            costCode: line.costCode || (shape.costCode ?? ""),
            basis: "assembly",
            basisDetail: `from your "${loaded.assembly.name}"`,
            quantityBasis: decided.quantityBasis,
            quantityNote: decided.quantityNote,
          });
        }
        continue;
      }
    }
    priced.push(priceProposed(shape, input.answers, book, input.today));
  }

  if (priced.length === 0) return [];
  await tx.insert(schema.jobEstimateProposedLines).values(
    priced.map((l, i) => ({
      tenantId: ctx.tenantId,
      interviewId: input.interviewId,
      stepId: input.step.id,
      stepTitle: input.step.title,
      description: l.description,
      clientDescription: l.clientDescription,
      clientVisible: l.clientVisible,
      unit: l.unit,
      quantityThousandths: l.quantityThousandths,
      unitCostCents: l.unitCostCents,
      costCode: l.costCode,
      basis: l.basis,
      basisDetail: l.basisDetail,
      quantityBasis: l.quantityBasis,
      quantityNote: l.quantityNote,
      sortOrder: (i + 1) * 10,
    })),
  );
  return listProposal(tx, ctx.tenantId, input.interviewId, input.step.id);
}

/**
 * Put a step's proposal on the estimate, as one item with its lines inside.
 *
 * **AN ITEM PER PHASE** (ADR 0079): the client buys "Foundation", and the
 * concrete, the forms and the rebar sit behind it. That is the shape the
 * proposal already prints in, and it is why a walk produces a readable
 * document rather than ninety loose lines.
 */
export async function applyProposal(
  tx: Tx,
  ctx: JobsCtx,
  input: { interviewId: string; estimateId: string; stepId: string | null },
): Promise<AppliedProposal> {
  requireWrite(ctx, "member");
  const proposed = await listProposal(tx, ctx.tenantId, input.interviewId, input.stepId);
  if (proposed.length === 0) throw new JobsError("NO_LINES", "there is nothing to put on");

  const loaded = await getEstimate(tx, ctx.tenantId, input.estimateId);
  if (!loaded) throw new JobsError("NOT_FOUND", "that estimate is no longer here");
  if (loaded.estimate.status === "accepted") {
    throw new JobsError(
      "ESTIMATE_ACCEPTED",
      `estimate ${loaded.estimate.number} was accepted; its money is the agreement`,
    );
  }

  /** The codes on THIS job's list, so a code written as digits lands (ADR 0086). */
  const project = await tx.query.jobProjects.findFirst({
    where: (p, { and: a, eq: q }) =>
      a(q(p.tenantId, ctx.tenantId), q(p.id, loaded.estimate.projectId)),
    columns: { costCodeSetId: true },
  });
  const codes = project?.costCodeSetId
    ? await listCostCodes(tx, ctx.tenantId, project.costCodeSetId)
    : [];

  const groupName = proposed[0].stepTitle.trim() || "From the walk";
  const key = `walk-${input.stepId ?? "loose"}`;

  /**
   * THE WHOLE FORM, as the editor posts it: every group and line that is
   * already there, then the new item and its lines appended. `updateEstimate`
   * writes by id, so nothing existing is touched.
   */
  await updateEstimate(tx, ctx, input.estimateId, {
    version: loaded.estimate.version,
    groups: [
      ...loaded.groups.map((g) => ({
        id: g.id,
        name: g.name,
        clientNote: g.clientNote,
        priceMode: g.priceMode,
        fixedPriceCents: g.fixedPriceCents,
      })),
      { key, name: groupName },
    ],
    lines: [
      ...loaded.lines.map((l) => ({
        id: l.id,
        groupRef: l.groupId,
        costCodeId: l.costCodeId,
        description: l.description,
        clientDescription: l.clientDescription,
        clientVisible: l.clientVisible,
        unit: l.unit,
        quantityThousandths: l.quantityThousandths,
        unitCostCents: l.unitCostCents,
        markupPpm: l.markupPpm,
        unitPriceCents: l.unitPriceCents,
        notes: l.notes,
      })),
      ...proposed.map((p) => ({
        groupRef: key,
        costCodeId: resolveCostCode(p.costCode, codes),
        description: p.description,
        clientDescription: p.clientDescription,
        clientVisible: p.clientVisible,
        unit: p.unit,
        quantityThousandths: p.quantityThousandths,
        unitCostCents: p.unitCostCents,
        basis: p.basis,
        /** The price's account, and the quantity's when it was worked out. */
        basisDetail:
          p.quantityBasis === "derived" && p.quantityNote
            ? `${p.basisDetail} · ${p.quantityNote}`
            : p.basisDetail,
      })),
    ],
  });

  /** Remember which line each proposal became — the takeoff's own shape. */
  const after = await getEstimate(tx, ctx.tenantId, input.estimateId);
  const group = after?.groups.find((g) => g.name === groupName);
  const made = (after?.lines ?? []).filter((l) => l.groupId === group?.id);
  const now = new Date();
  for (const p of proposed) {
    const line = made.find(
      (l) => l.description === p.description && l.unitCostCents === p.unitCostCents,
    );
    if (!line) continue;
    await tx
      .update(schema.jobEstimateProposedLines)
      .set({ estimateLineId: line.id, appliedAt: now })
      .where(
        and(
          eq(schema.jobEstimateProposedLines.tenantId, ctx.tenantId),
          eq(schema.jobEstimateProposedLines.id, p.id),
        ),
      );
  }

  return { groupName, lines: proposed.length };
}
