import "server-only";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobSheet, JobSheetMarkup } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import { getSheet, listSheets } from "./drawings-ops";
import { getMarkup } from "./markups-ops";
import { parsePoints } from "./markups-math";
import {
  driftedSince,
  familyOf,
  formatMeasure,
  measure,
  parseFigures,
  scaleFromKnownLength,
  scaleFromStandard,
  sumMeasurements,
  takeoffUnitFor,
  toThousandths,
  unitAccepts,
  whyNoYield,
  yieldFor,
  yieldsOf,
  type LineMeasurements,
  type Measurement,
  type SheetScale,
  type SheetShare,
  type Yield,
} from "./takeoff-math";
import {
  MARKUP_KIND_LABELS,
  TRACE_FIGURE_LABELS,
  isMeasureKind,
  isScaleUnit,
  isTraceFigure,
  type FigureFamily,
  type MeasureKind,
  type ScaleUnit,
  type TraceFigure,
} from "./vocabulary";

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

/** Everything one trace yields under the sheet's scale (ADR 0110) — its own figure and the ones typed onto it. */
export function yieldsOfMarkup(markup: Pick<JobSheetMarkup, "kind" | "geometry" | "figures">, scale: SheetScale | null): Yield[] {
  if (!isMeasureKind(markup.kind)) return [];
  return yieldsOf(markup.kind, parsePoints(markup.kind, markup.geometry), parseFigures(markup.figures), scale);
}

// ----------------------------------------------------- a set of measurements

/** One figure of one trace, with what it comes to under its own sheet's scale. */
interface MeasuredRow {
  id: string;
  sheetId: string;
  kind: MeasureKind;
  figure: TraceFigure;
  measurement: Measurement | null;
}

interface MeasuredSet {
  rows: MeasuredRow[];
  summed: ReturnType<typeof sumMeasurements>;
  /** The unit the trade prices by: lf, sf, ea, cy; m, m2, m3. */
  unit: string;
  quantityThousandths: number;
}

/** A trace named for a push or a claim: by its own kind unless a figure it yields is named (ADR 0110). */
export interface TracePickInput {
  markupId: string;
  figure?: TraceFigure;
}

/** The old shape (ids alone) and the new (id and figure), as one list. */
function picksOf(input: { markupIds?: readonly string[]; picks?: readonly TracePickInput[] }): TracePickInput[] {
  return input.picks ? [...input.picks] : (input.markupIds ?? []).map((markupId) => ({ markupId }));
}

/**
 * The figures named, checked as ONE SET: every one a figure a trace on this
 * job's sheets actually yields, one family of thing between them (two floors
 * add up, a floor and a wall do not; the run around a room is a length like
 * any other), each under a scale when it needs one. What a push onto a line
 * and a line's claim both start from — across sheets (ADR 0109), and across
 * the figures one trace yields (ADR 0110).
 */
async function measuredSet(tx: Tx, tenantId: string, projectId: string, picks: readonly TracePickInput[]): Promise<MeasuredSet> {
  if (picks.length === 0) throw new JobsError("INVALID_VALUE", "pick at least one measurement");
  const ids = [...new Set(picks.map((p) => p.markupId))];
  const markups = await tx
    .select()
    .from(schema.jobSheetMarkups)
    .where(and(eq(schema.jobSheetMarkups.tenantId, tenantId), inArray(schema.jobSheetMarkups.id, ids)));
  if (markups.length !== ids.length) throw new JobsError("NOT_FOUND", "a measurement is missing");
  const sheetIds = [...new Set(markups.map((m) => m.sheetId))];
  const sheets = await tx
    .select()
    .from(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, tenantId), inArray(schema.jobSheets.id, sheetIds)));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const byId = new Map(markups.map((m) => [m.id, m]));
  const rows: MeasuredRow[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const m = byId.get(p.markupId);
    if (!m) throw new JobsError("NOT_FOUND", "a measurement is missing");
    if (!isMeasureKind(m.kind)) throw new JobsError("INVALID_KIND", "only a length, an area or a count carries a quantity");
    if (m.projectId !== projectId) throw new JobsError("WRONG_PROJECT", "that measurement is on another job's sheet");
    const figure: TraceFigure = p.figure ?? m.kind;
    const key = `${m.id}:${figure}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sheet = sheetById.get(m.sheetId);
    const scale = sheet ? scaleOf(sheet) : null;
    const figures = parseFigures(m.figures);
    const found = yieldFor(m.kind, parsePoints(m.kind, m.geometry), figures, scale, figure);
    // No scale on a length or an area is the sum's refusal below, in its own words; anything else is this trace's.
    if (!found && (m.kind === "count" || scale)) {
      throw new JobsError(
        "INVALID_VALUE",
        `${m.text.trim() || MARKUP_KIND_LABELS[m.kind]} cannot stand as ${TRACE_FIGURE_LABELS[figure].toLowerCase()}: ${whyNoYield(m.kind, figure, figures, scale)}`,
      );
    }
    rows.push({ id: m.id, sheetId: m.sheetId, kind: m.kind, figure, measurement: found?.measurement ?? null });
  }
  let summed: ReturnType<typeof sumMeasurements>;
  try {
    summed = sumMeasurements(rows.map((r) => ({ kind: familyOf(r.figure), measurement: r.measurement })));
  } catch (err) {
    throw new JobsError("INVALID_VALUE", err instanceof Error ? err.message : "these cannot be pushed together");
  }
  const scaleUnit: ScaleUnit | "" =
    summed.total.unit === "m" || summed.total.unit === "m²" || summed.total.unit === "m³" ? "m" : summed.total.unit === "each" ? "" : "ft";
  return { rows, summed, unit: takeoffUnitFor(summed.kind, scaleUnit), quantityThousandths: toThousandths(summed.total.quantity) };
}

/**
 * These figures stand behind the line from now on — one row per trace and
 * figure in `job_estimate_line_traces`, each remembering ITS OWN share, never
 * the line's total, or a second one on the same line would read as drifted
 * the moment after — and the line's others no longer do. An empty set lets
 * every one of them go.
 */
async function linkMeasurements(tx: Tx, tenantId: string, lineId: string, rows: readonly MeasuredRow[]): Promise<void> {
  const existing = await tx
    .select({ id: schema.jobEstimateLineTraces.id, markupId: schema.jobEstimateLineTraces.markupId, figure: schema.jobEstimateLineTraces.figure })
    .from(schema.jobEstimateLineTraces)
    .where(and(eq(schema.jobEstimateLineTraces.tenantId, tenantId), eq(schema.jobEstimateLineTraces.lineId, lineId)));
  const keep = new Set(rows.map((r) => `${r.id}:${r.figure}`));
  const gone = existing.filter((e) => !keep.has(`${e.markupId}:${e.figure}`)).map((e) => e.id);
  if (gone.length > 0) {
    await tx.delete(schema.jobEstimateLineTraces).where(and(eq(schema.jobEstimateLineTraces.tenantId, tenantId), inArray(schema.jobEstimateLineTraces.id, gone)));
  }
  for (const r of rows) {
    const shareThousandths = toThousandths(r.measurement!.quantity);
    await tx
      .insert(schema.jobEstimateLineTraces)
      .values({ tenantId, lineId, markupId: r.id, figure: r.figure, shareThousandths })
      .onConflictDoUpdate({
        target: [schema.jobEstimateLineTraces.tenantId, schema.jobEstimateLineTraces.lineId, schema.jobEstimateLineTraces.markupId, schema.jobEstimateLineTraces.figure],
        set: { shareThousandths },
      });
  }
}

// ------------------------------------------------------------- the takeoff

export interface TakeoffInput {
  estimateId: string;
  /** The traces, by their own kind… */
  markupIds?: string[];
  /** …or by a figure each yields (ADR 0110). Either list; `picks` wins when both are given. */
  picks?: TracePickInput[];
  /** An existing line of the estimate to set the quantity on… */
  lineId?: string | null;
  /** …or a new line, described. Its unit is the measurement's unless given. */
  newLine?: { description: string; costCodeId?: string | null; unit?: string } | null;
}

export interface TakeoffResult {
  lineId: string;
  quantityThousandths: number;
  unit: string;
  kind: FigureFamily;
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
  const { rows, summed, unit, quantityThousandths } = await measuredSet(tx, ctx.tenantId, est.projectId, picksOf(input));

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
  // Each measurement remembers the line and its own share; the line's others no longer stand behind it.
  await linkMeasurements(tx, ctx.tenantId, lineId, rows);
  await tx
    .update(schema.jobEstimates)
    .set({ version: est.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, est.id)));
  return { lineId, quantityThousandths, unit, kind: summed.kind, measurement: summed.total };
}

/**
 * A measurement no longer standing behind a line: the line keeps its quantity,
 * the drawing stops claiming it. A trace alone lets go of every line it stands
 * behind; a line and a figure with it let go of that one link (ADR 0110).
 */
export async function unpushTakeoff(tx: Tx, ctx: JobsCtx, target: string | { markupId: string; lineId?: string; figure?: TraceFigure }): Promise<void> {
  requireWrite(ctx, "member");
  const t = typeof target === "string" ? { markupId: target } : target;
  const markup = await getMarkup(tx, ctx.tenantId, t.markupId);
  if (!markup) throw new JobsError("NOT_FOUND", `markup ${t.markupId} not found`);
  await tx
    .delete(schema.jobEstimateLineTraces)
    .where(
      and(
        eq(schema.jobEstimateLineTraces.tenantId, ctx.tenantId),
        eq(schema.jobEstimateLineTraces.markupId, t.markupId),
        ...(t.lineId ? [eq(schema.jobEstimateLineTraces.lineId, t.lineId)] : []),
        ...(t.figure ? [eq(schema.jobEstimateLineTraces.figure, t.figure)] : []),
      ),
    );
}

// ------------------------------------------------- what stands behind a line

/**
 * THE REVERSE LINK (ADR 0109): every measurement standing behind each line of
 * an estimate, by sheet — what the estimate shows as *measured on A-101,
 * A-102* and what the Measure dialog opens with. Derived from the markups'
 * own link every time it is read, so it cannot disagree with the drawings;
 * nothing is stored twice. A sheet's share is what its traces pushed; its
 * `now` is what they come to today, and `drifted` says when those differ.
 */
export async function measurementsBehind(tx: Tx, tenantId: string, estimateId: string): Promise<Map<string, LineMeasurements>> {
  const out = new Map<string, LineMeasurements>();
  const est = await tx
    .select({ projectId: schema.jobEstimates.projectId })
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.id, estimateId)))
    .limit(1);
  if (est.length === 0) return out;
  const rows = await tx
    .select({ trace: schema.jobEstimateLineTraces, markup: schema.jobSheetMarkups })
    .from(schema.jobEstimateLineTraces)
    .innerJoin(
      schema.jobSheetMarkups,
      and(eq(schema.jobSheetMarkups.tenantId, schema.jobEstimateLineTraces.tenantId), eq(schema.jobSheetMarkups.id, schema.jobEstimateLineTraces.markupId)),
    )
    .innerJoin(
      schema.jobEstimateLines,
      and(eq(schema.jobEstimateLines.tenantId, schema.jobEstimateLineTraces.tenantId), eq(schema.jobEstimateLines.id, schema.jobEstimateLineTraces.lineId)),
    )
    .where(and(eq(schema.jobEstimateLineTraces.tenantId, tenantId), eq(schema.jobEstimateLines.estimateId, estimateId)))
    .orderBy(asc(schema.jobSheetMarkups.createdAt), asc(schema.jobSheetMarkups.id), asc(schema.jobEstimateLineTraces.figure));
  if (rows.length === 0) return out;
  const sheets = await listSheets(tx, tenantId, est[0].projectId);
  const order = new Map(sheets.map((s, i) => [s.sheet.id, i]));
  const byId = new Map(sheets.map((s) => [s.sheet.id, s]));
  const add = (target: { nowThousandths: number | null }, nowT: number | null) => {
    target.nowThousandths = target.nowThousandths === null || nowT === null ? null : target.nowThousandths + nowT;
  };
  for (const { trace: t, markup: m } of rows) {
    if (!isMeasureKind(m.kind) || !isTraceFigure(t.figure)) continue;
    const sheet = byId.get(m.sheetId);
    if (!sheet) continue;
    const scale = scaleOf(sheet.sheet);
    const now = yieldFor(m.kind, parsePoints(m.kind, m.geometry), parseFigures(m.figures), scale, t.figure)?.measurement ?? null;
    const nowT = now ? toThousandths(now.quantity) : null;
    const share = t.shareThousandths;
    const drifted = driftedSince(share, now);
    const family = familyOf(t.figure);
    const line: LineMeasurements = out.get(t.lineId) ?? {
      lineId: t.lineId,
      kind: family,
      unit: takeoffUnitFor(family, scale?.unit ?? ""),
      traces: 0,
      shareThousandths: 0,
      nowThousandths: 0,
      drifted: false,
      sheets: [],
    };
    let s: SheetShare | undefined = line.sheets.find((x) => x.sheetId === m.sheetId);
    if (!s) {
      s = { sheetId: m.sheetId, sheetNumber: sheet.sheet.sheetNumber, setName: sheet.setName, isCurrent: sheet.isCurrent, traces: 0, shareThousandths: 0, nowThousandths: 0, drifted: false, picks: [] };
      line.sheets.push(s);
    }
    s.picks.push({ markupId: m.id, figure: t.figure });
    s.traces += 1;
    s.shareThousandths += share;
    add(s, nowT);
    s.drifted = s.drifted || drifted;
    line.traces += 1;
    line.shareThousandths += share;
    add(line, nowT);
    line.drifted = line.drifted || drifted;
    out.set(t.lineId, line);
  }
  for (const line of out.values()) line.sheets.sort((a, b) => (order.get(a.sheetId) ?? 0) - (order.get(b.sheetId) ?? 0));
  return out;
}

export interface StandBehindInput {
  lineId: string;
  /** Every trace that stands behind the line from now on, by its own kind, on any sheet of the job… */
  markupIds?: string[];
  /** …or by the figure each yields (ADR 0110). Either list; empty lets them all go. */
  picks?: TracePickInput[];
}

export interface StandBehindResult {
  lineId: string;
  /** What the line should now say, in thousandths of `unit` — 0 with nothing behind it. */
  quantityThousandths: number;
  unit: string;
  kind: FigureFamily | null;
  behind: LineMeasurements | null;
}

/**
 * MEASURED FROM WHERE IT IS PRICED (ADR 0109): the measurements that stand
 * behind an estimate line from now on, across every sheet of the job.
 *
 * **This writes the link and nothing else.** The editor holds the estimate
 * (ADR 0082) and sets the line's quantity itself from what comes back, exactly
 * as it appends what *Add an assembly* and *From the model* return — a second
 * writer of the line while the editor is open is the disagreement that ADR
 * warns about. The line's unit must be the measurement's or blank, as for a
 * push; the editor gives a blank line the unit that comes back.
 */
export async function standBehind(tx: Tx, ctx: JobsCtx, input: StandBehindInput): Promise<StandBehindResult> {
  requireWrite(ctx, "member");
  const found = await tx
    .select({ line: schema.jobEstimateLines, estimate: schema.jobEstimates })
    .from(schema.jobEstimateLines)
    .innerJoin(
      schema.jobEstimates,
      and(eq(schema.jobEstimates.tenantId, schema.jobEstimateLines.tenantId), eq(schema.jobEstimates.id, schema.jobEstimateLines.estimateId)),
    )
    .where(and(eq(schema.jobEstimateLines.tenantId, ctx.tenantId), eq(schema.jobEstimateLines.id, input.lineId)))
    .limit(1);
  if (found.length === 0) throw new JobsError("NOT_FOUND", `estimate line ${input.lineId} not found`);
  const { line, estimate } = found[0];
  if (estimate.status === "accepted") throw new JobsError("ESTIMATE_ACCEPTED", `estimate ${estimate.number} was accepted; its quantities are the agreement`);
  const picks = picksOf(input);
  if (picks.length === 0) {
    await linkMeasurements(tx, ctx.tenantId, line.id, []);
    return { lineId: line.id, quantityThousandths: 0, unit: line.unit, kind: null, behind: null };
  }
  const set = await measuredSet(tx, ctx.tenantId, estimate.projectId, picks);
  if (!unitAccepts(line.unit, set.unit)) {
    throw new JobsError(
      "UNIT_MISMATCH",
      `${line.description} is priced per ${line.unit.trim()} and this measures ${formatMeasure(set.summed.total)}; a drawing measures it in ${set.unit}`,
    );
  }
  await linkMeasurements(tx, ctx.tenantId, line.id, set.rows);
  const behind = (await measurementsBehind(tx, ctx.tenantId, estimate.id)).get(line.id) ?? null;
  return { lineId: line.id, quantityThousandths: set.quantityThousandths, unit: set.unit, kind: set.summed.kind, behind };
}
