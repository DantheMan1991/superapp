import "server-only";
import type { Tx } from "@/db";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import { formatQuantity } from "./billing-math";
import { measureSlug, type DeclaredMeasure } from "./measure-math";
import {
  asDeclared,
  asTaken,
  listMeasurements,
  listOutlineMeasures,
  recordMeasurement,
} from "./measure-ops";
import { addRoomList, listRooms } from "./room-ops";
import {
  MAX_SCHEDULE_CHARS,
  canAnswer,
  convertThousandths,
  figureFor,
  measureDimension,
  parseSchedule,
  readColumns,
  readRooms,
  suggestMeasures,
  suggestedUse,
  type Dimension,
  type ScheduleColumn,
  type UseOf,
} from "./bim-schedule";

/**
 * A SCHEDULE OFF THE MODEL, INTO THE BUILDING'S NUMBERS (X14, ADR 0106).
 *
 * The pure half (`bim-schedule.ts`) reads the file into columns, rooms
 * and suggestions. This half puts what a person confirmed onto the job:
 * rooms through `addRoomList` and figures through `recordMeasurement`, both
 * marked `schedule` so the screen and the reckoning can say where a number
 * came from. Nothing here parses text and nothing here invents a figure.
 *
 * **THE PREVIEW AND THE WRITE EACH READ THE TEXT AGAIN.** The screen shows
 * what the server read and sends back only choices — which column answers
 * which measurement, whether to add the rooms — so a browser cannot describe
 * a row the file does not hold.
 */

export interface SchedulePreview {
  title: string;
  fileName: string;
  rowCount: number;
  /** Total and footer rows the export carried, left out of every figure. */
  footers: number;
  columns: {
    index: number;
    header: string;
    unit: string;
    dimension: Dimension | null;
    count: number;
    /** "2,232 sf" — everything added up. */
    total: string;
    /** "9 lf" — when every row carries the same figure and there is more than one. */
    each: string | null;
    /** The outline measurements this column could answer. */
    canTake: string[];
    samples: string[];
  }[];
  /** The word columns, so the preview can say what it saw. */
  textColumns: string[];
  rooms: {
    count: number;
    withArea: number;
    alreadyThere: number;
    levels: string[];
    areaUnit: string;
    nameHeader: string;
    levelHeader: string;
    areaHeader: string;
    list: { name: string; level: string; area: string | null; alreadyThere: boolean }[];
    skipped: { line: number; text: string; reason: string }[];
  } | null;
  /** The outline's list, with what the building already has for each. */
  measures: { id: string; name: string; unit: string; kind: string; has: string | null }[];
  /**
   * The measurement a column's words point at, and which of its figures to
   * start from — null when every row carries the same figure and only the
   * person can say whether the total or that figure is wanted.
   */
  suggested: { column: number; measureId: string; use: UseOf | null }[];
  /** The measurements a row count could answer. */
  countMeasures: string[];
}

function figure(valueThousandths: number, unit: string): string {
  const n = formatQuantity(valueThousandths);
  return unit.trim() === "" ? n : `${n} ${unit.trim()}`;
}

function roomKey(level: string, name: string): string {
  return `${measureSlug(level)}/${measureSlug(name)}`;
}

function checkSize(text: string): void {
  if (text.length > MAX_SCHEDULE_CHARS) {
    throw new JobsError("INVALID_VALUE", "that file is too big to read here");
  }
}

/** Everything the preview needs, read once. */
async function readAll(tx: Tx, tenantId: string, projectId: string, outlineId: string, text: string) {
  checkSize(text);
  const schedule = parseSchedule(text);
  const { columns, rows, footers } = readColumns(schedule);
  const [declared, taken, existing] = await Promise.all([
    listOutlineMeasures(tx, tenantId, outlineId).then(asDeclared),
    listMeasurements(tx, tenantId, projectId).then(asTaken),
    listRooms(tx, tenantId, projectId),
  ]);
  return { schedule, columns, rows, footers, declared, taken, existing };
}

export async function previewSchedule(
  tx: Tx,
  tenantId: string,
  projectId: string,
  outlineId: string,
  text: string,
  fileName: string,
): Promise<SchedulePreview> {
  const { schedule, columns, rows, footers, declared, taken, existing } = await readAll(
    tx,
    tenantId,
    projectId,
    outlineId,
    text,
  );
  const rooms = readRooms(schedule, columns, rows);
  const suggested = suggestMeasures(schedule, columns, declared);
  const there = new Set(existing.map((r) => roomKey(r.room.level, r.room.name)));
  const takenBySlug = new Map(taken.map((t) => [t.slug, t]));

  return {
    title: schedule.title,
    fileName,
    rowCount: rows.length,
    footers,
    columns: columns
      .filter((c) => c.kind === "quantity")
      .map((c) => ({
        index: c.index,
        header: c.header,
        unit: c.unit,
        dimension: c.dimension,
        count: c.count,
        total: figure(c.totalThousandths, c.unit),
        each: c.sameOnEveryRow !== null && c.count > 1 ? figure(c.sameOnEveryRow, c.unit) : null,
        canTake: declared.filter((m) => canAnswer(c, m)).map((m) => m.id),
        samples: c.samples,
      })),
    textColumns: columns.filter((c) => c.kind === "text").map((c) => c.header),
    rooms: rooms
      ? {
          count: rooms.rooms.length,
          withArea: rooms.rooms.filter((r) => r.areaThousandths !== null).length,
          alreadyThere: rooms.rooms.filter((r) => there.has(roomKey(r.level, r.name))).length,
          levels: [...new Set(rooms.rooms.map((r) => r.level))],
          areaUnit: rooms.areaUnit || "sf",
          nameHeader: rooms.nameHeader,
          levelHeader: rooms.levelHeader,
          areaHeader: rooms.areaHeader,
          list: rooms.rooms.map((r) => ({
            name: r.name,
            level: r.level,
            area: r.areaThousandths === null ? null : figure(r.areaThousandths, rooms.areaUnit || "sf"),
            alreadyThere: there.has(roomKey(r.level, r.name)),
          })),
          skipped: rooms.skipped,
        }
      : null,
    measures: declared.map((m) => {
      const has = takenBySlug.get(measureSlug(m.name));
      return {
        id: m.id,
        name: m.name,
        unit: m.unit,
        kind: m.kind,
        has: has && has.valueThousandths !== null ? figure(has.valueThousandths, has.unit) : null,
      };
    }),
    suggested: [...suggested].map(([column, measureId]) => ({
      column,
      measureId,
      use: suggestedUse(columns[column]),
    })),
    countMeasures: declared.filter((m) => measureDimension(m) === "count").map((m) => m.id),
  };
}

export interface ScheduleChoice {
  measureId: string;
  /** Null when `use` is `rows`. */
  column: number | null;
  use: UseOf;
}

export interface ScheduleImportInput {
  projectId: string;
  outlineId: string;
  text: string;
  fileName: string;
  /** Add the rooms the schedule lists. */
  rooms: boolean;
  choices: ScheduleChoice[];
}

export interface ScheduleImportResult {
  rooms: { added: number; alreadyThere: number; withArea: number; skipped: number } | null;
  measured: { name: string; figure: string }[];
  /** A choice that could not be written, and why, in words. */
  refused: { name: string; reason: string }[];
}

/** Why a column cannot answer a measurement, for the person who asked it to. */
function whyNot(column: ScheduleColumn | null, measure: DeclaredMeasure, use: UseOf, rowCount: number): string | null {
  if (use === "rows") {
    if (measureDimension(measure) !== "count") return `${measure.name} is not a count`;
    if (rowCount <= 0) return "the schedule has no rows";
    return null;
  }
  if (!column || column.kind !== "quantity") return "that column holds words, not figures";
  if (!canAnswer(column, measure)) {
    return `${measure.name} wants ${withArticle(measureDimension(measure))} and ${column.header} holds ${withArticle(column.dimension ?? "count")}`;
  }
  if (use === "each" && column.sameOnEveryRow === null) return "the rows differ, so there is no single figure";
  const raw = use === "each" ? column.sameOnEveryRow : column.totalThousandths;
  if (raw === null || raw <= 0) return "it adds up to nothing";
  if (convertThousandths(raw, column.unit, measure.unit) === null) {
    return `${column.header} is in ${column.unit} and ${measure.name} is in ${measure.unit.trim() || "no unit"}, which this cannot convert`;
  }
  return null;
}

function withArticle(d: Dimension): string {
  return d === "area" ? "an area" : `a ${d}`;
}

/**
 * **WRITE WHAT WAS CONFIRMED, AND SAY WHAT WAS NOT.**
 *
 * A choice that cannot be honoured is refused by name rather than skipped,
 * because a measurement somebody thought they had imported and did not is
 * the walk asking for it again, ten minutes from now, with no idea why.
 */
export async function importSchedule(
  tx: Tx,
  ctx: JobsCtx,
  input: ScheduleImportInput,
): Promise<ScheduleImportResult> {
  requireWrite(ctx, "member");
  const { schedule, columns, rows, declared } = await readAll(
    tx,
    ctx.tenantId,
    input.projectId,
    input.outlineId,
    input.text,
  );
  const source = schedule.title.trim() !== "" ? schedule.title.trim() : input.fileName.trim();

  const measured: ScheduleImportResult["measured"] = [];
  const refused: ScheduleImportResult["refused"] = [];
  const seen = new Set<string>();
  for (const choice of input.choices) {
    if (seen.has(choice.measureId)) continue;
    seen.add(choice.measureId);
    const measure = declared.find((m) => m.id === choice.measureId);
    if (!measure) {
      refused.push({ name: "a measurement", reason: "it is no longer on the outline" });
      continue;
    }
    const column = choice.column === null ? null : (columns[choice.column] ?? null);
    const reason = whyNot(column, measure, choice.use, rows.length);
    if (reason) {
      refused.push({ name: measure.name, reason });
      continue;
    }
    const got = figureFor(schedule, column, rows.length, choice.use, measure, input.fileName);
    if (!got) {
      refused.push({ name: measure.name, reason: "it could not be read as one figure" });
      continue;
    }
    await recordMeasurement(tx, ctx, {
      projectId: input.projectId,
      name: measure.name,
      unit: measure.unit,
      valueThousandths: got.valueThousandths,
      source: "schedule",
      note: got.note,
    });
    measured.push({ name: measure.name, figure: figure(got.valueThousandths, measure.unit) });
  }

  let roomsResult: ScheduleImportResult["rooms"] = null;
  if (input.rooms) {
    const read = readRooms(schedule, columns, rows);
    if (read && read.rooms.length > 0) {
      const counts = await addRoomList(tx, ctx, input.projectId, read.rooms, {
        unit: read.areaUnit || "sf",
        source: "schedule",
        note: read.areaHeader === "" ? "" : `${source}: ${read.areaHeader}`,
      });
      roomsResult = { ...counts, skipped: read.skipped.length };
    } else {
      roomsResult = { added: 0, alreadyThere: 0, withArea: 0, skipped: read?.skipped.length ?? 0 };
    }
  }

  return { rooms: roomsResult, measured, refused };
}
