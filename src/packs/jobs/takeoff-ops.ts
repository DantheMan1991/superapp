import "server-only";
import { and, eq, inArray, max, notInArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobSheet, JobSheetMarkup } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import { getSheet } from "./drawings-ops";
import { getMarkup } from "./markups-ops";
import { parsePoints } from "./markups-math";
import {
  formatMeasure,
  measure,
  scaleFromKnownLength,
  scaleFromStandard,
  sumMeasurements,
  takeoffUnitFor,
  toThousandths,
  unitAccepts,
  type Measurement,
  type SheetScale,
} from "./takeoff-math";
import { isMeasureKind, isScaleUnit, type MeasureKind, type ScaleUnit } from "./vocabulary";

/**
 * The takeoff (ADR 0074): the scale is the sheet's, a measurement is a
 * markup with points, and a push puts a quantity onto an estimate line.
 * Kept by whoever runs the job (`member`), as the drawings and the markups
 * are; the estimate's own rule — accepted is locked — is asked here too.
 */

// ------------------------------------------------------------------ the scale

export type ScaleInput =
  | { by: "known"; a: { x: number; y: number }; b: { x: number; y: number }; length: number; unit: string; pageWidthPt: number; pageHeightPt: number }
  | { by: "standard"; key: string; pageWidthPt: number; pageHeightPt: number };

/** The sheet's scale as a value, or null while nobody has set it. */
export function scaleOf(sheet: Pick<JobSheet, "scalePointsPerUnit" | "scaleUnit" | "pageWidthPt" | "pageHeightPt">): SheetScale | null {
  if (sheet.scalePointsPerUnit === null || !isScaleUnit(sheet.scaleUnit) || sheet.pageWidthPt === null || sheet.pageHeightPt === null) return null;
  return { pointsPerUnit: sheet.scalePointsPerUnit, unit: sheet.scaleUnit, pageWidthPt: sheet.pageWidthPt, pageHeightPt: sheet.pageHeightPt };
}

/**
 * Set the sheet's scale from a dimension the drawing states or from a
 * standard scale; the page's size in points comes from the browser, which
 * has the PDF open. Every length and area on the sheet reads through it
 * from then on, so re-setting it corrects them all at once.
 */
export async function setSheetScale(tx: Tx, ctx: JobsCtx, sheetId: string, input: ScaleInput): Promise<JobSheet> {
  requireWrite(ctx, "member");
  const sheet = await getSheet(tx, ctx.tenantId, sheetId);
  if (!sheet) throw new JobsError("NOT_FOUND", `sheet ${sheetId} not found`);
  let scale: SheetScale;
  try {
    if (input.by === "known") {
      if (!isScaleUnit(input.unit)) throw new Error("the unit is feet or metres");
      scale = scaleFromKnownLength(input.a, input.b, input.length, input.unit, input.pageWidthPt, input.pageHeightPt);
    } else {
      scale = scaleFromStandard(input.key, input.pageWidthPt, input.pageHeightPt);
    }
  } catch (err) {
    throw new JobsError("INVALID_VALUE", err instanceof Error ? err.message : "the scale could not be read");
  }
  if (!Number.isFinite(scale.pointsPerUnit) || scale.pointsPerUnit <= 0) throw new JobsError("INVALID_VALUE", "the scale must be more than nothing");
  const rows = await tx
    .update(schema.jobSheets)
    .set({
      scalePointsPerUnit: scale.pointsPerUnit,
      scaleUnit: scale.unit,
      pageWidthPt: scale.pageWidthPt,
      pageHeightPt: scale.pageHeightPt,
      scaleSetByClerkUserId: ctx.userId,
      scaleSetAt: new Date(),
      version: sheet.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.id, sheetId)))
    .returning();
  return rows[0];
}

/** The scale taken off: every length and area on the sheet reads as unmeasured again. */
export async function clearSheetScale(tx: Tx, ctx: JobsCtx, sheetId: string): Promise<JobSheet> {
  requireWrite(ctx, "member");
  const sheet = await getSheet(tx, ctx.tenantId, sheetId);
  if (!sheet) throw new JobsError("NOT_FOUND", `sheet ${sheetId} not found`);
  const rows = await tx
    .update(schema.jobSheets)
    .set({
      scalePointsPerUnit: null,
      scaleUnit: "",
      pageWidthPt: null,
      pageHeightPt: null,
      scaleSetByClerkUserId: null,
      scaleSetAt: null,
      version: sheet.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.id, sheetId)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------- measuring

/** What one measuring markup comes to under the sheet's scale, or null when it needs a scale the sheet lacks. */
export function measurementOf(markup: Pick<JobSheetMarkup, "kind" | "geometry">, scale: SheetScale | null): Measurement | null {
  if (!isMeasureKind(markup.kind)) return null;
  return measure(markup.kind, parsePoints(markup.kind, markup.geometry), scale);
}

// ------------------------------------------------------------- the takeoff

export interface TakeoffInput {
  estimateId: string;
  markupIds: string[];
  /** An existing line of the estimate to set the quantity on… */
  lineId?: string | null;
  /** …or a new line, described. Its unit is the measurement's unless given. */
  newLine?: { description: string; costCodeId?: string | null; unit?: string } | null;
}

export interface TakeoffResult {
  lineId: string;
  quantityThousandths: number;
  unit: string;
  kind: MeasureKind;
  measurement: Measurement;
}

/**
 * Measurements onto an estimate line. They must be one kind of thing (two
 * floors add up; a floor and a wall do not), measured under a scale when
 * they need one, on a sheet of the estimate's job; the estimate must not be
 * accepted (its money is the agreement). The line's quantity BECOMES the
 * total — a push is a statement, not an increment — and each measurement
 * remembers the line and the quantity IT contributed to the total, so the
 * page can say when this measurement has moved on from what it pushed.
 *
 * The line's unit is the measurement's, or blank: an area cannot be set on a
 * line priced per linear foot or per square yard (`unitAccepts`), because the
 * quantity would be wrong in a way nothing downstream can see.
 */
export async function pushTakeoff(tx: Tx, ctx: JobsCtx, input: TakeoffInput): Promise<TakeoffResult> {
  requireWrite(ctx, "member");
  const estimate = await tx
    .select()
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, input.estimateId)))
    .limit(1);
  if (estimate.length === 0) throw new JobsError("NOT_FOUND", `estimate ${input.estimateId} not found`);
  const est = estimate[0];
  if (est.status === "accepted") throw new JobsError("ESTIMATE_ACCEPTED", `estimate ${est.number} was accepted; its quantities are the agreement`);
  if (input.markupIds.length === 0) throw new JobsError("INVALID_VALUE", "pick at least one measurement");
  const ids = [...new Set(input.markupIds)];
  const markups = await tx
    .select()
    .from(schema.jobSheetMarkups)
    .where(and(eq(schema.jobSheetMarkups.tenantId, ctx.tenantId), inArray(schema.jobSheetMarkups.id, ids)));
  if (markups.length !== ids.length) throw new JobsError("NOT_FOUND", "a measurement is missing");
  const sheetIds = [...new Set(markups.map((m) => m.sheetId))];
  const sheets = await tx
    .select()
    .from(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), inArray(schema.jobSheets.id, sheetIds)));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const rows: { id: string; kind: MeasureKind; measurement: Measurement | null }[] = [];
  for (const m of markups) {
    if (!isMeasureKind(m.kind)) throw new JobsError("INVALID_KIND", "only a length, an area or a count carries a quantity");
    if (m.projectId !== est.projectId) throw new JobsError("WRONG_PROJECT", "that measurement is on another job's sheet");
    const sheet = sheetById.get(m.sheetId);
    rows.push({ id: m.id, kind: m.kind, measurement: measurementOf(m, sheet ? scaleOf(sheet) : null) });
  }
  let summed: ReturnType<typeof sumMeasurements>;
  try {
    summed = sumMeasurements(rows);
  } catch (err) {
    throw new JobsError("INVALID_VALUE", err instanceof Error ? err.message : "these cannot be pushed together");
  }
  const scaleUnit: ScaleUnit | "" = summed.total.unit === "m" || summed.total.unit === "m²" ? "m" : summed.total.unit === "each" ? "" : "ft";
  const unit = takeoffUnitFor(summed.kind, scaleUnit);
  const quantityThousandths = toThousandths(summed.total.quantity);

  let lineId: string;
  if (input.lineId) {
    const line = await tx
      .select()
      .from(schema.jobEstimateLines)
      .where(and(eq(schema.jobEstimateLines.tenantId, ctx.tenantId), eq(schema.jobEstimateLines.id, input.lineId)))
      .limit(1);
    if (line.length === 0 || line[0].estimateId !== est.id) throw new JobsError("NOT_FOUND", "that line is not on this estimate");
    if (!unitAccepts(line[0].unit, unit)) {
      throw new JobsError(
        "UNIT_MISMATCH",
        `${line[0].description} is priced per ${line[0].unit.trim()} and this measures ${formatMeasure(summed.total)}; pick a line priced per ${unit}, or a new line`,
      );
    }
    await tx
      .update(schema.jobEstimateLines)
      .set({ quantityThousandths, unit: line[0].unit.trim() === "" ? unit : line[0].unit, updatedAt: new Date() })
      .where(and(eq(schema.jobEstimateLines.tenantId, ctx.tenantId), eq(schema.jobEstimateLines.id, line[0].id)));
    lineId = line[0].id;
  } else if (input.newLine) {
    const description = input.newLine.description.trim();
    if (description === "") throw new JobsError("INVALID_VALUE", "a new line needs saying what it is");
    if (description.length > 300) throw new JobsError("INVALID_VALUE", "a line's description is at most 300 characters");
    const given = input.newLine.unit?.trim() ?? "";
    if (!unitAccepts(given, unit)) throw new JobsError("UNIT_MISMATCH", `a line priced per ${given} cannot take ${formatMeasure(summed.total)}; its unit is ${unit}`);
    const last = await tx
      .select({ top: max(schema.jobEstimateLines.sortOrder) })
      .from(schema.jobEstimateLines)
      .where(and(eq(schema.jobEstimateLines.tenantId, ctx.tenantId), eq(schema.jobEstimateLines.estimateId, est.id)));
    const inserted = await tx
      .insert(schema.jobEstimateLines)
      .values({
        tenantId: ctx.tenantId,
        estimateId: est.id,
        costCodeId: input.newLine.costCodeId ?? null,
        description,
        unit: input.newLine.unit?.trim() || unit,
        quantityThousandths,
        notes: `From the takeoff.`,
        sortOrder: (last[0]?.top ?? 0) + 10,
      })
      .returning();
    lineId = inserted[0].id;
  } else {
    throw new JobsError("INVALID_VALUE", "say which line the quantity goes on, or describe a new one");
  }
  // Each measurement remembers the line and ITS OWN quantity — never the line's total, or a
  // second measurement pushed onto the same line would read as drifted the moment after.
  for (const r of rows) {
    await tx
      .update(schema.jobSheetMarkups)
      .set({ estimateLineId: lineId, pushedQuantityThousandths: toThousandths(r.measurement!.quantity), updatedAt: new Date() })
      .where(and(eq(schema.jobSheetMarkups.tenantId, ctx.tenantId), eq(schema.jobSheetMarkups.id, r.id)));
  }
  // Measurements that fed this line before and were not in this push no longer stand behind its quantity.
  await tx
    .update(schema.jobSheetMarkups)
    .set({ estimateLineId: null, pushedQuantityThousandths: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobSheetMarkups.tenantId, ctx.tenantId),
        eq(schema.jobSheetMarkups.estimateLineId, lineId),
        notInArray(schema.jobSheetMarkups.id, ids),
      ),
    );
  await tx
    .update(schema.jobEstimates)
    .set({ version: est.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, est.id)));
  return { lineId, quantityThousandths, unit, kind: summed.kind, measurement: summed.total };
}

/** A measurement no longer standing behind a line: the line keeps its quantity, the drawing stops claiming it. */
export async function unpushTakeoff(tx: Tx, ctx: JobsCtx, markupId: string): Promise<void> {
  requireWrite(ctx, "member");
  const markup = await getMarkup(tx, ctx.tenantId, markupId);
  if (!markup) throw new JobsError("NOT_FOUND", `markup ${markupId} not found`);
  await tx
    .update(schema.jobSheetMarkups)
    .set({ estimateLineId: null, pushedQuantityThousandths: null, updatedAt: new Date() })
    .where(and(eq(schema.jobSheetMarkups.tenantId, ctx.tenantId), eq(schema.jobSheetMarkups.id, markupId)));
}
