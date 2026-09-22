"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { dateInTimezone } from "@/lib/timezone";
import { JobsError, type JobsCtx } from "./ops";
import { getSheet, listSheets } from "./drawings-ops";
import { listMarkups } from "./markups-ops";
import { measurementsBehind, scaleOf } from "./takeoff-ops";
import { parseFigures, type SheetScale } from "./takeoff-math";
import type { MarkupView } from "./components/sheet-viewer";
import { isMarkupColor, isMarkupKind, PACK } from "./vocabulary";
import {
  createOutlineMeasure,
  deleteOutlineMeasure,
  forgetMeasurement,
  passMeasurement,
  recordMeasurement,
  reorderOutlineMeasures,
  updateOutlineMeasure,
} from "./measure-ops";
import { measureSlug, readMeasureReply } from "./measure-math";

/**
 * THE DRAWINGS, OPENED FROM THE WALK (X7).
 *
 * The founder's ask, in the same breath as the pricing one: *"I don't see
 * where it allows you to open the takeoff inline. Everything should be
 * seamless and snappy and just part of the flow. There are numerous times
 * it asks for a square footage. I need the takeoff tool to get that a lot
 * of the time."*
 *
 * ── WHY THESE ARE SEPARATE FROM `walk-actions.ts` ───────────────────────────
 *
 * They are not turns. Opening a sheet reads nothing about the conversation
 * and writes nothing to it; taking a measurement writes to the PROJECT. The
 * one that does advance the walk says so by calling into it, rather than by
 * living there — `walk-actions.ts` is already the longest file in the pack.
 */

async function gate(): Promise<JobsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function sentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed === "") return "That did not work.";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
}

function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) return { error: sentence(err.message) };
  return { error: "That did not work. Try again." };
}

/* ------------------------------------------------------------ the drawings */

const sheetsSchema = z.object({
  projectId: z.string().uuid(),
  /** Set when a line is measuring: each sheet then says what already stands behind it there (ADR 0109). */
  estimateId: z.string().uuid().optional(),
  lineId: z.string().uuid().optional(),
});

export interface MeasurableSheet {
  id: string;
  label: string;
  setName: string;
  issuedOn: string;
  /** A sheet with no scale can still be opened; the viewer asks for one. */
  hasScale: boolean;
  /** What stands behind the measuring line on this sheet, when a line asked. */
  behind: { traces: number; shareThousandths: number; nowThousandths: number | null } | null;
}

/** The current sheets of this job, for picking one to measure on. */
export async function sheetsForMeasuringAction(input: unknown) {
  const parsed = sheetsSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const sheets = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const rows = await listSheets(tx, ctx.tenantId, parsed.data.projectId);
        const { estimateId, lineId } = parsed.data;
        const behind = estimateId && lineId ? ((await measurementsBehind(tx, ctx.tenantId, estimateId)).get(lineId) ?? null) : null;
        /** Only the current issue of each number: measuring a superseded
         *  sheet is measuring a building that is not being built. */
        return rows
          .filter((r) => r.isCurrent)
          .map<MeasurableSheet>((r) => {
            const share = behind?.sheets.find((s) => s.sheetId === r.sheet.id);
            return {
              id: r.sheet.id,
              label: `${r.sheet.sheetNumber}${r.sheet.title ? ` · ${r.sheet.title}` : ""}`,
              setName: r.setName,
              issuedOn: r.issuedOn,
              hasScale: scaleOf(r.sheet) !== null,
              behind: share ? { traces: share.traces, shareThousandths: share.shareThousandths, nowThousandths: share.nowThousandths } : null,
            };
          });
      },
      { role: ctx.role },
    );
    return { ok: true as const, sheets };
  } catch (err) {
    return toResult(err);
  }
}

const sheetSchema = z.object({
  projectId: z.string().uuid(),
  sheetId: z.string().uuid(),
});

export interface MeasurableSheetView {
  url: string;
  page: number;
  label: string;
  sheetId: string;
  projectId: string;
  markups: MarkupView[];
  scale: SheetScale | null;
}

/**
 * One sheet, as the viewer takes it.
 *
 * The same payload the drawings page builds, minus the estimate options and
 * the cost codes — from inside the walk there is nothing to push a quantity
 * ONTO, because the measurement is going to the building rather than to a
 * line. Pushing a takeoff at an estimate line is still the drawings page's.
 */
export async function sheetForMeasuringAction(input: unknown) {
  const parsed = sheetSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const tenant = await requireTenant();
    const data = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const sheet = await getSheet(tx, ctx.tenantId, parsed.data.sheetId);
        if (!sheet || sheet.projectId !== parsed.data.projectId) return null;
        const [markups, members] = await Promise.all([
          listMarkups(tx, ctx.tenantId, sheet.id),
          listAssignableMembers(tx, ctx.tenantId),
        ]);
        return { sheet, markups, members };
      },
      { role: ctx.role },
    );
    if (!data) return { error: "That sheet is not on this job." };

    const names = new Map(data.members.map((m) => [m.clerkUserId, memberLabel(m)]));
    const markups: MarkupView[] = data.markups.flatMap((r) => {
      if (!isMarkupKind(r.markup.kind) || !isMarkupColor(r.markup.color)) return [];
      return [
        {
          id: r.markup.id,
          kind: r.markup.kind,
          color: r.markup.color,
          geometry: r.markup.geometry as Record<string, unknown>,
          text: r.markup.text,
          version: r.markup.version,
          createdOn: dateInTimezone(r.markup.createdAt, tenant.tenant.timezone),
          createdBy: r.markup.createdByClerkUserId
            ? (names.get(r.markup.createdByClerkUserId) ?? "")
            : "",
          workItemId: r.markup.workItemId,
          punch: r.punch,
          takeoffs: r.takeoffs,
          figures: parseFigures(r.markup.figures),
        },
      ];
    });

    const view: MeasurableSheetView = {
      url: `/api/documents/${data.sheet.documentId}/file`,
      page: data.sheet.pageNumber,
      label: `${data.sheet.sheetNumber}${data.sheet.title ? ` · ${data.sheet.title}` : ""}`,
      sheetId: data.sheet.id,
      projectId: parsed.data.projectId,
      markups,
      scale: scaleOf(data.sheet),
    };
    return { ok: true as const, view };
  } catch (err) {
    return toResult(err);
  }
}

/* -------------------------------------------------- the measurements panel */

const saveSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(20),
  /** What somebody typed, read by the same parser the walk uses. */
  said: z.string().trim().max(200),
  note: z.string().trim().max(500).optional(),
  /** Set when the figure came off a drawing rather than a keyboard. */
  sheetId: z.string().uuid().optional(),
  markupId: z.string().uuid().optional(),
});

/**
 * A measurement written or corrected outside the walk.
 *
 * **IT GOES THROUGH THE SAME PARSER.** `38'-6"` typed into the panel has to
 * mean what `38'-6"` typed into the walk means, and the only way to be sure
 * of that is one reader.
 */
export async function saveMeasurementAction(input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const reply = readMeasureReply(parsed.data.said);
  if (reply.kind === "unclear") {
    return { error: "That did not read as one figure. Try 248, 24 x 40 or 38'-6\"." };
  }
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        if (reply.kind === "pass") {
          await passMeasurement(tx, ctx, {
            projectId: parsed.data.projectId,
            name: parsed.data.name,
            unit: parsed.data.unit,
            note: parsed.data.note,
          });
          return;
        }
        await recordMeasurement(tx, ctx, {
          projectId: parsed.data.projectId,
          name: parsed.data.name,
          unit: parsed.data.unit,
          valueThousandths: reply.valueThousandths,
          source: parsed.data.sheetId ? "measured" : "said",
          note: parsed.data.note,
          sheetId: parsed.data.sheetId ?? null,
          markupId: parsed.data.markupId ?? null,
        });
      },
      { role: ctx.role },
    );
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const forgetSchema = z.object({
  projectId: z.string().uuid(),
  slug: z.string().trim().min(1).max(160),
});

export async function forgetMeasurementAction(input: unknown) {
  const parsed = forgetSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) => forgetMeasurement(tx, ctx, parsed.data.projectId, measureSlug(parsed.data.slug)),
      { role: ctx.role },
    );
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/* --------------------------------------------- the outline's own list (X7) */

/**
 * WHAT THIS BUSINESS MEASURES BEFORE IT PRICES A JOB.
 *
 * Owner work, like every other decision about how an outline walks — and
 * checked in `measure-ops.ts` as well as here, because a rule that lives
 * only at the door is a rule the next door forgets.
 */

const measureShape = {
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(20),
  kind: z.enum(["length", "area", "count"]),
  guidance: z.string().trim().max(500),
  required: z.boolean(),
};

const addMeasureSchema = z.object({
  outlineId: z.string().uuid(),
  ...measureShape,
});

export async function addOutlineMeasureAction(input: unknown) {
  const parsed = addMeasureSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const { outlineId, ...rest } = parsed.data;
    await withTenant(ctx.tenantId, (tx) => createOutlineMeasure(tx, ctx, outlineId, rest), {
      role: ctx.role,
    });
    revalidatePath(`/dashboard/m/jobs/estimate-outlines/${outlineId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const editMeasureSchema = z.object({
  id: z.string().uuid(),
  outlineId: z.string().uuid(),
  version: z.number().int().min(1),
  ...measureShape,
});

export async function updateOutlineMeasureAction(input: unknown) {
  const parsed = editMeasureSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const { id, outlineId, ...rest } = parsed.data;
    await withTenant(ctx.tenantId, (tx) => updateOutlineMeasure(tx, ctx, id, rest), {
      role: ctx.role,
    });
    revalidatePath(`/dashboard/m/jobs/estimate-outlines/${outlineId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const dropMeasureSchema = z.object({
  id: z.string().uuid(),
  outlineId: z.string().uuid(),
});

/**
 * **DELETING IT FROM THE LIST DOES NOT UNMEASURE A BUILDING.** The numbers
 * live on the project; this only stops the walk asking for them. A job
 * measured last week keeps what it knows.
 */
export async function deleteOutlineMeasureAction(input: unknown) {
  const parsed = dropMeasureSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(ctx.tenantId, (tx) => deleteOutlineMeasure(tx, ctx, parsed.data.id), {
      role: ctx.role,
    });
    revalidatePath(`/dashboard/m/jobs/estimate-outlines/${parsed.data.outlineId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const orderMeasuresSchema = z.object({
  outlineId: z.string().uuid(),
  ids: z.array(z.string().uuid()).max(100),
});

export async function reorderOutlineMeasuresAction(input: unknown) {
  const parsed = orderMeasuresSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) => reorderOutlineMeasures(tx, ctx, parsed.data.outlineId, parsed.data.ids),
      { role: ctx.role },
    );
    revalidatePath(`/dashboard/m/jobs/estimate-outlines/${parsed.data.outlineId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
