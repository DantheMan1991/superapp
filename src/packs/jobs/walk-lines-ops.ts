import "server-only";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimateProposedLine } from "@/db/schema";
import { explodeAssembly, resolveCostCode } from "./assembly-math";
import {
  applyPin,
  asLineShape,
  describeWithRooms,
  shapeLines,
  type RoomArea,
} from "./line-shaping";
import { getAssembly, listAssemblies } from "./assembly-ops";
import { priceBookFrom } from "./price-memory";
import {
  priceProposed,
  type PricedLine,
  type ProposedShape,
} from "./walk-lines-math";
import { getEstimate, priceBookRows, updateEstimate } from "./estimating-ops";
import { awardedForCode } from "./bids-ops";
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
    /**
     * The rooms in the building, so a line that covers several can be named
     * in the building's own words — or split into one line each, when the
     * assembly it is says so (X11).
     */
    rooms?: readonly RoomArea[];
    today: string;
    /** The job, so an awarded bid on this phase can supply the number (X3). */
    projectId?: string;
  },
): Promise<JobEstimateProposedLine[]> {
  requireWrite(ctx, "member");
  await clearProposal(tx, ctx, input.interviewId, input.step.id);
  if (input.shapes.length === 0) return [];

  const book = priceBookFrom(await priceBookRows(tx, ctx.tenantId));
  const library = await listAssemblies(tx, ctx.tenantId);

  /**
   * **THE PHASE'S OWN ITEM, AND HOW MANY LINES IT IS** (X11).
   *
   * Both were a model's judgement until now — whether to reach for an
   * assembly at all, and whether four rooms are one line or four. The step
   * carries the first and the assembly carries the second, so what happens
   * here is arithmetic over rows rather than a rule in a prompt that has to
   * be re-decided on every bid. The prompt still SAYS both, because an
   * answer written to fit the item comes out better than one corrected
   * afterwards; this is what makes it true either way.
   */
  const pinned = input.step.assemblyId
    ? (library.find((a) => a.assembly.id === input.step.assemblyId) ?? null)
    : null;
  const shapes = shapeLines(
    applyPin(input.shapes, pinned?.assembly.name ?? null),
    library.map((a) => ({
      name: a.assembly.name,
      lineShape: asLineShape(a.assembly.lineShape),
      drivingUnit: a.assembly.drivingUnit,
    })),
    input.rooms ?? [],
  );

  /**
   * **A BID THEY AWARDED BEATS EVERYTHING** (X3). It is this job, this scope
   * and a number a subcontractor put their name to — better than what the
   * business charged last time and better than anything the conversation
   * implied. Matched on the phase's cost code; no award means no number,
   * never the lowest bid, because which one they are going with is their
   * decision and not an arithmetic.
   */
  const awarded =
    input.projectId && input.step.costCode
      ? await awardedForCode(tx, ctx.tenantId, input.projectId, input.step.costCode)
      : null;

  const priced: PricedLine[] = [];
  /**
   * ONE LINE FOR AN AWARDED SUBCONTRACT, and the shapes are set aside.
   * A phase somebody else is doing for a fixed number is one lump — a
   * breakdown of their work would be this business guessing at it.
   */
  if (awarded) {
    await tx.insert(schema.jobEstimateProposedLines).values({
      tenantId: ctx.tenantId,
      interviewId: input.interviewId,
      stepId: input.step.id,
      stepTitle: input.step.title,
      stepSection: input.step.section,
      description: `${input.step.title} — ${awarded.partyName}`,
      unit: "ls",
      quantityThousandths: 1_000,
      unitCostCents: awarded.amountCents,
      costCode: input.step.costCode,
      basis: "sub",
      basisDetail: `${awarded.partyName}, on your bid request`,
      quantityBasis: "none",
      quantityNote: "",
      sortOrder: 10,
    });
    return listProposal(tx, ctx.tenantId, input.interviewId, input.step.id);
  }

  for (const shape of shapes) {
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
            /**
             * **THE ROOM GOES ON THE ASSEMBLY'S OWN WORDS** (X11), not just
             * on the shape that summoned it. An assembly supplies its
             * descriptions, so without this a phase split into three showers
             * would come out as three identical sets of lines — the split
             * done, and invisible on the sheet it was done for.
             */
            description: describeWithRooms(line.description, shape.rooms ?? []),
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
      stepSection: input.step.section,
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
 * **WHAT THIS STEP PUT ON THE ESTIMATE ALREADY**, through the link the row
 * kept and never through the name. A person may rename the item — the
 * founder's own sheet has `DRYWALL, INCL. LABOR` over a step called
 * `Drywall` — and matching on words would either miss it or, worse, hit a
 * different phase that happens to read the same.
 */
async function appliedBefore(
  tx: Tx,
  tenantId: string,
  interviewId: string,
  stepId: string | null,
): Promise<Set<string>> {
  const rows = await tx
    .select({ estimateLineId: schema.jobEstimateProposedLines.estimateLineId })
    .from(schema.jobEstimateProposedLines)
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        stepId === null
          ? isNull(schema.jobEstimateProposedLines.stepId)
          : eq(schema.jobEstimateProposedLines.stepId, stepId),
        isNotNull(schema.jobEstimateProposedLines.estimateLineId),
      ),
    );
  return new Set(rows.map((r) => r.estimateLineId).filter((id): id is string => id !== null));
}

/**
 * Put a step's proposal on the estimate, as one item with its lines inside.
 *
 * **AN ITEM PER PHASE** (ADR 0079): the client buys "Foundation", and the
 * concrete, the forms and the rebar sit behind it. That is the shape the
 * proposal already prints in, and it is why a walk produces a readable
 * document rather than ninety loose lines.
 *
 * **AND A PHASE WALKED TWICE IS STILL ONE ITEM.** This appended, always, and
 * driving the way back into a finished walk is what found it: ask a phase
 * again, answer it, price it, and the estimate grew a SECOND `Landscaping`
 * beside the first — both in the total, which is the plausible wrong number
 * this whole layer exists to refuse, at the place it does the most damage.
 * A phase that lands again lands in the item it made before, replacing the
 * lines it put there and leaving anything a person added beside them.
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

  /**
   * The item this phase made last time, if it is still there. Its lines are
   * being replaced; anything else in it — a line somebody typed in beside
   * them — stays, because the walk did not put it there.
   */
  const madeBefore = await appliedBefore(tx, ctx.tenantId, input.interviewId, input.stepId);
  const priorLines = loaded.lines.filter((l) => madeBefore.has(l.id));
  const priorGroupId = priorLines.find((l) => l.groupId !== null)?.groupId ?? null;
  const priorGroup = priorGroupId
    ? (loaded.groups.find((g) => g.id === priorGroupId) ?? null)
    : null;

  /** **THE NAME THEY GAVE IT WINS**, for the same reason the link does. */
  const groupName = priorGroup
    ? priorGroup.name
    : proposed[0].stepTitle.trim() || "From the walk";
  /** The heading the step sat under, recorded when the line was proposed. */
  const groupSection = proposed[0].stepSection.trim();
  const key = `walk-${input.stepId ?? "loose"}`;
  /** Where the new lines go: back into the phase's own item, or a new one. */
  const landing = priorGroup ? priorGroup.id : key;

  /**
   * THE WHOLE FORM, as the editor posts it: every group and line that is
   * already there, then the new item and its lines appended. `updateEstimate`
   * writes by id, so nothing existing is touched.
   */
  await updateEstimate(tx, ctx, input.estimateId, {
    version: loaded.estimate.version,
    groups: [
      /**
       * **EVERY FIELD OF AN EXISTING ITEM, NOT MOST OF THEM.** This posts
       * the whole form, so a column left out of this map is a column reset
       * to its default on every apply. `section` and `show_lines` were
       * nearly lost that way the day they were added.
       */
      ...loaded.groups.map((g) => ({
        id: g.id,
        name: g.name,
        clientNote: g.clientNote,
        section: g.section,
        showLines: g.showLines,
        priceMode: g.priceMode,
        fixedPriceCents: g.fixedPriceCents,
      })),
      /** Only when the phase has no item yet; otherwise it keeps the one it has. */
      ...(priorGroup ? [] : [{ key, name: groupName, section: groupSection }]),
    ],
    lines: [
      /**
       * **THE LINES THIS PHASE PUT ON BEFORE ARE GONE**, because the answers
       * that produced them have been answered again and the new proposal is
       * what the phase is now. A line left out of a whole-form save is a line
       * deleted (ADR 0082), which is exactly what is wanted here.
       */
      ...loaded.lines
        .filter((l) => !madeBefore.has(l.id))
        .map((l) => ({
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
        groupRef: landing,
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
  /**
   * **BY ID WHERE THERE IS ONE.** Two items can share a name — the estimate
   * has never forbidden it — and a search by words would then link this
   * phase's lines to somebody else's item.
   */
  const group = priorGroup
    ? after?.groups.find((g) => g.id === priorGroup.id)
    : after?.groups.find((g) => g.name === groupName);
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
