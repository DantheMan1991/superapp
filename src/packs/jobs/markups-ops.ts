import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobSheetMarkup } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import { getSheet } from "./drawings-ops";
import { addPunchItem } from "./field-ops";
import { parseGeometry, type MarkupGeometry } from "./markups-math";
import { parseFigures } from "./takeoff-math";
import { MARKUP_TEXT_MAX, isMarkupColor, isMarkupKind, isMeasureKind, isTraceFigure, type MarkupColor, type MarkupKind, type TraceFigure } from "./vocabulary";

/**
 * Markups on a sheet (ADR 0073): clouds, arrows, notes and pins over one
 * issue of a sheet, kept by whoever runs the job. A pin is a punch item
 * where it sits — raising one is the same `addPunchItem` the job's panel
 * calls, so the Work item is the ordinary kind with the ordinary link to the
 * job — and the pin remembers the item while it exists.
 */

export interface MarkupInput {
  sheetId: string;
  kind: string;
  geometry: unknown;
  text?: string;
  color?: string;
  /**
   * For a pin: raise its words as a punch item (the default), with a due date
   * when there is one. `raise: false` keeps a pin that is only a marker.
   */
  punch?: { raise: boolean; dueOn?: string | null };
}

function words(kind: MarkupKind, text: string | undefined): string {
  const t = (text ?? "").trim();
  if ((kind === "text" || kind === "pin") && t === "") {
    throw new JobsError("INVALID_VALUE", kind === "pin" ? "a pin needs saying what needs doing" : "a note needs some words");
  }
  if (t.length > MARKUP_TEXT_MAX) throw new JobsError("INVALID_VALUE", `a markup's words are at most ${MARKUP_TEXT_MAX.toLocaleString("en-US")} characters`);
  return t;
}

function shape(kind: MarkupKind, raw: unknown): MarkupGeometry {
  try {
    return parseGeometry(kind, raw);
  } catch (err) {
    throw new JobsError("INVALID_VALUE", err instanceof Error ? err.message : "the shape could not be read");
  }
}

export async function addMarkup(tx: Tx, ctx: JobsCtx, input: MarkupInput): Promise<JobSheetMarkup> {
  requireWrite(ctx, "member");
  if (!isMarkupKind(input.kind)) throw new JobsError("INVALID_KIND", `a markup is a cloud, an arrow, a note or a pin, not ${input.kind}`);
  const color: MarkupColor = input.color === undefined ? "red" : isMarkupColor(input.color) ? input.color : (() => {
    throw new JobsError("INVALID_VALUE", "pick one of the five colours");
  })();
  const sheet = await getSheet(tx, ctx.tenantId, input.sheetId);
  if (!sheet) throw new JobsError("NOT_FOUND", `sheet ${input.sheetId} not found`);
  const kind = input.kind;
  const geometry = shape(kind, input.geometry);
  const text = words(kind, input.text);
  let workItemId: string | null = null;
  if (kind === "pin" && (input.punch?.raise ?? true)) {
    workItemId = await addPunchItem(tx, ctx, sheet.projectId, {
      title: text,
      notes: `On sheet ${sheet.sheetNumber}${sheet.title ? ` · ${sheet.title}` : ""}.`,
      dueOn: input.punch?.dueOn ?? null,
    });
  }
  const rows = await tx
    .insert(schema.jobSheetMarkups)
    .values({
      tenantId: ctx.tenantId,
      projectId: sheet.projectId,
      sheetId: sheet.id,
      kind,
      color,
      geometry,
      text,
      workItemId,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

export async function getMarkup(tx: Tx, tenantId: string, id: string): Promise<JobSheetMarkup | null> {
  const rows = await tx
    .select()
    .from(schema.jobSheetMarkups)
    .where(and(eq(schema.jobSheetMarkups.tenantId, tenantId), eq(schema.jobSheetMarkups.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * A markup's words, colour or place. The words of a pin that raised a punch
 * item are the pin's own from here on: the item lives its life in Work,
 * where it is assigned, dated and chased, and this does not reach into it.
 */
export async function updateMarkup(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  patch: { geometry?: unknown; text?: string; color?: string; version?: number; figures?: unknown },
): Promise<JobSheetMarkup> {
  requireWrite(ctx, "member");
  const current = await getMarkup(tx, ctx.tenantId, id);
  if (!current) throw new JobsError("NOT_FOUND", `markup ${id} not found`);
  if (patch.version !== undefined && patch.version !== current.version) {
    throw new JobsError("STALE_VERSION", "the markup changed while you were editing it");
  }
  const kind = current.kind as MarkupKind;
  if (patch.color !== undefined && !isMarkupColor(patch.color)) throw new JobsError("INVALID_VALUE", "pick one of the five colours");
  // The figures a trace carries (ADR 0110): read tolerantly, and only a length or an area has any.
  if (patch.figures !== undefined && !isMeasureKind(kind)) throw new JobsError("INVALID_KIND", "only a length or an area carries figures");
  const rows = await tx
    .update(schema.jobSheetMarkups)
    .set({
      geometry: patch.geometry !== undefined ? shape(kind, patch.geometry) : current.geometry,
      text: patch.text !== undefined ? words(kind, patch.text) : current.text,
      color: patch.color ?? current.color,
      figures: patch.figures !== undefined ? parseFigures(patch.figures) : current.figures,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobSheetMarkups.tenantId, ctx.tenantId), eq(schema.jobSheetMarkups.id, id)))
    .returning();
  return rows[0];
}

/** Rubbed out. A pin's punch item stays on the list: it was raised, and the site still owes it. */
export async function deleteMarkup(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "member");
  const current = await getMarkup(tx, ctx.tenantId, id);
  if (!current) throw new JobsError("NOT_FOUND", `markup ${id} not found`);
  await tx.delete(schema.jobSheetMarkups).where(and(eq(schema.jobSheetMarkups.tenantId, ctx.tenantId), eq(schema.jobSheetMarkups.id, id)));
}

/** One line a trace stands behind, by one of its figures, as the estimate has the line now (ADR 0110). */
export interface TakeoffLink {
  lineId: string;
  figure: TraceFigure;
  /** What this figure of this trace came to when it was pushed, in thousandths of the line's unit. */
  shareThousandths: number;
  estimateId: string;
  estimateNumber: string;
  estimateStatus: string;
  lineDescription: string;
  lineUnit: string;
  lineQuantityThousandths: number;
}

export interface MarkupRow {
  markup: JobSheetMarkup;
  /** The pin's punch item as Work has it now, while it exists. */
  punch: { title: string; done: boolean; dueOn: string | null } | null;
  /** Every estimate line a measurement stands behind, by which of its figures, as the estimate has them now (ADR 0074, 0110). */
  takeoffs: TakeoffLink[];
}

/** Everything drawn on one issue of a sheet, oldest first, with each pin's punch item and each trace's lines as they stand. */
export async function listMarkups(tx: Tx, tenantId: string, sheetId: string): Promise<MarkupRow[]> {
  const rows = await tx
    .select({
      markup: schema.jobSheetMarkups,
      punchTitle: schema.workItems.title,
      punchClosedAt: schema.workItems.closedAt,
      punchDueOn: schema.workItems.dueOn,
    })
    .from(schema.jobSheetMarkups)
    .leftJoin(schema.workItems, and(eq(schema.workItems.tenantId, schema.jobSheetMarkups.tenantId), eq(schema.workItems.id, schema.jobSheetMarkups.workItemId)))
    .where(and(eq(schema.jobSheetMarkups.tenantId, tenantId), eq(schema.jobSheetMarkups.sheetId, sheetId)))
    .orderBy(asc(schema.jobSheetMarkups.createdAt), asc(schema.jobSheetMarkups.id));
  const links = new Map<string, TakeoffLink[]>();
  if (rows.length > 0) {
    const traced = await tx
      .select({
        trace: schema.jobEstimateLineTraces,
        lineDescription: schema.jobEstimateLines.description,
        lineUnit: schema.jobEstimateLines.unit,
        lineQuantityThousandths: schema.jobEstimateLines.quantityThousandths,
        estimateId: schema.jobEstimates.id,
        estimateNumber: schema.jobEstimates.number,
        estimateStatus: schema.jobEstimates.status,
      })
      .from(schema.jobEstimateLineTraces)
      .innerJoin(
        schema.jobEstimateLines,
        and(eq(schema.jobEstimateLines.tenantId, schema.jobEstimateLineTraces.tenantId), eq(schema.jobEstimateLines.id, schema.jobEstimateLineTraces.lineId)),
      )
      .innerJoin(schema.jobEstimates, and(eq(schema.jobEstimates.tenantId, schema.jobEstimateLines.tenantId), eq(schema.jobEstimates.id, schema.jobEstimateLines.estimateId)))
      .where(
        and(
          eq(schema.jobEstimateLineTraces.tenantId, tenantId),
          inArray(
            schema.jobEstimateLineTraces.markupId,
            rows.map((r) => r.markup.id),
          ),
        ),
      )
      .orderBy(asc(schema.jobEstimateLineTraces.createdAt));
    for (const t of traced) {
      if (!isTraceFigure(t.trace.figure)) continue;
      const list = links.get(t.trace.markupId) ?? [];
      list.push({
        lineId: t.trace.lineId,
        figure: t.trace.figure,
        shareThousandths: t.trace.shareThousandths,
        estimateId: t.estimateId,
        estimateNumber: t.estimateNumber,
        estimateStatus: t.estimateStatus,
        lineDescription: t.lineDescription,
        lineUnit: t.lineUnit,
        lineQuantityThousandths: t.lineQuantityThousandths,
      });
      links.set(t.trace.markupId, list);
    }
  }
  return rows.map((r) => ({
    markup: r.markup,
    punch:
      r.markup.workItemId && r.punchTitle !== null
        ? { title: r.punchTitle, done: r.punchClosedAt !== null, dueOn: r.punchDueOn ?? null }
        : null,
    takeoffs: links.get(r.markup.id) ?? [],
  }));
}

/** How many markups each of several sheets carries — the issues list says what an earlier issue had drawn on it. */
export async function markupCounts(tx: Tx, tenantId: string, sheetIds: readonly string[]): Promise<Map<string, number>> {
  if (sheetIds.length === 0) return new Map();
  const rows = await tx
    .select({ sheetId: schema.jobSheetMarkups.sheetId })
    .from(schema.jobSheetMarkups)
    .where(and(eq(schema.jobSheetMarkups.tenantId, tenantId), inArray(schema.jobSheetMarkups.sheetId, [...sheetIds])));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.sheetId, (counts.get(r.sheetId) ?? 0) + 1);
  return counts;
}
