import "server-only";
import type { Tx } from "@/db";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import { formatQuantity } from "./billing-math";
import {
  linesForDrop,
  listAssemblies,
  listAssemblyKeys,
  rememberKey,
  type DroppedLine,
} from "./assembly-ops";
import { MAX_SCHEDULE_CHARS, parseSchedule, readColumns, type Dimension } from "./bim-schedule";
import {
  driverFor,
  keyColumnOf,
  keySlug,
  lineFromRow,
  matchAssembly,
  offTheModel,
  takeoffRows,
  whyNoDriver,
  type AssemblyToMatch,
  type MatchHow,
  type TakeoffRow,
} from "./bim-takeoff";

/**
 * THE TAKEOFF OFF THE MODEL, AS ITEMS FOR THE ESTIMATE (X15, ADR 0107).
 *
 * The pure half (`bim-takeoff.ts`) groups a schedule into things with
 * quantities and joins each to an assembly. This half reads the library,
 * explodes each confirmed assembly at the quantity the model states through
 * the same `linesForDrop` the *Add an assembly* button uses, and remembers
 * every confirmed match against the assembly so the next takeoff off the
 * same model maps itself.
 *
 * **NOTHING HERE WRITES AN ESTIMATE LINE.** The editor holds the estimate in
 * its own state and saves itself (ADR 0082); this returns the items and the
 * editor appends them, exactly as a dropped assembly arrives. The one thing
 * written is the memory of what a name means.
 */

export interface TakeoffPreview {
  title: string;
  fileName: string;
  rowCount: number;
  footers: number;
  /** The column the things were named by. */
  keyHeader: string;
  /** Rows with nothing in that column, left out. */
  unnamed: number;
  rows: {
    key: string;
    count: number;
    quantities: { header: string; figure: string; dimension: Dimension | null; unit: string }[];
    /** The assembly this name means, and how that is known. */
    match: { assemblyId: string; how: MatchHow } | null;
    /** Every assembly this row could drive, and the size it would be dropped at. */
    canDrive: { assemblyId: string; at: string }[];
  }[];
  assemblies: { id: string; name: string; per: string; drivingUnit: string; costCents: number }[];
}

function figure(valueThousandths: number, unit: string): string {
  const n = formatQuantity(valueThousandths);
  return unit.trim() === "" ? n : `${n} ${unit.trim()}`;
}

function checkSize(text: string): void {
  if (text.length > MAX_SCHEDULE_CHARS) {
    throw new JobsError("INVALID_VALUE", "that file is too big to read here");
  }
}

/** The schedule as things, and the library as things to match them to. */
async function readAll(tx: Tx, tenantId: string, text: string) {
  checkSize(text);
  const schedule = parseSchedule(text);
  const { columns, rows, footers } = readColumns(schedule);
  const keyColumn = keyColumnOf(columns);
  const taken = keyColumn ? takeoffRows(columns, rows, keyColumn.index) : { rows: [], unnamed: 0 };
  const [library, keys] = await Promise.all([listAssemblies(tx, tenantId), listAssemblyKeys(tx, tenantId)]);
  const keysBy = new Map<string, string[]>();
  for (const k of keys) keysBy.set(k.assemblyId, [...(keysBy.get(k.assemblyId) ?? []), k.key]);
  const assemblies: (AssemblyToMatch & { per: string; costCents: number })[] = library.map((a) => ({
    id: a.assembly.id,
    name: a.assembly.name,
    drivingUnit: a.assembly.drivingUnit,
    keys: keysBy.get(a.assembly.id) ?? [],
    per: figure(a.assembly.drivingQuantityThousandths, a.assembly.drivingUnit),
    costCents: a.costCents,
  }));
  return { schedule, rows, footers, keyColumn, taken, assemblies };
}

export async function previewTakeoff(
  tx: Tx,
  tenantId: string,
  text: string,
  fileName: string,
): Promise<TakeoffPreview> {
  const { schedule, rows, footers, keyColumn, taken, assemblies } = await readAll(tx, tenantId, text);
  return {
    title: schedule.title,
    fileName,
    rowCount: rows.length,
    footers,
    keyHeader: keyColumn?.header ?? "",
    unnamed: taken.unnamed,
    rows: taken.rows.map((row) => ({
      key: row.key,
      count: row.count,
      quantities: row.quantities
        .filter((q) => q.totalThousandths > 0)
        .map((q) => ({
          header: q.header,
          figure: figure(q.totalThousandths, q.unit),
          dimension: q.dimension,
          unit: q.unit,
        })),
      match: matchAssembly(row, assemblies),
      canDrive: assemblies.flatMap((a) => {
        const driver = driverFor(row, a);
        return driver ? [{ assemblyId: a.id, at: figure(driver.valueThousandths, a.drivingUnit) }] : [];
      }),
    })),
    assemblies: assemblies.map((a) => ({
      id: a.id,
      name: a.name,
      per: a.per,
      drivingUnit: a.drivingUnit,
      costCents: a.costCents,
    })),
  };
}

/**
 * One thing the person decided about: the assembly it means, or the column
 * to bring it in as a plain line by (`count` for the count), and whether to
 * remember the assembly against this name.
 */
export interface TakeoffChoice {
  key: string;
  assemblyId?: string;
  lineFrom?: string;
  remember?: boolean;
}

export interface TakeoffItem {
  name: string;
  clientNote: string;
  isAllowance: boolean;
  /** "Drywall, hang and finish at 3,708 sf · off the model: Wall Schedule · …" */
  basisDetail: string;
  lines: DroppedLine[];
  /** Lines whose written code this job's set has not got. */
  uncoded: number;
}

export interface TakeoffResult {
  items: TakeoffItem[];
  loose: { description: string; quantityThousandths: number; unit: string; basisDetail: string }[];
  refused: { key: string; reason: string }[];
  remembered: number;
}

/**
 * **THE ITEMS THE MODEL MAKES, FROM WHAT WAS CONFIRMED.**
 *
 * Each assembly choice is exploded at the figure the schedule states for
 * that thing, in the assembly's own dimension; each line choice is the thing
 * as a plain line by the column named. A choice that cannot be honoured is
 * refused by name and reason, never skipped: a wall somebody thought was
 * priced and was not is the omission that eats the margin.
 */
export async function takeoffItems(
  tx: Tx,
  ctx: JobsCtx,
  input: { projectId: string; text: string; fileName: string; choices: readonly TakeoffChoice[] },
): Promise<TakeoffResult> {
  requireWrite(ctx, "member");
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", "job not found");
  const { schedule, taken, assemblies } = await readAll(tx, ctx.tenantId, input.text);
  const bySlug = new Map<string, TakeoffRow>(taken.rows.map((r) => [r.slug, r]));

  const items: TakeoffItem[] = [];
  const loose: TakeoffResult["loose"] = [];
  const refused: TakeoffResult["refused"] = [];
  let remembered = 0;
  const seen = new Set<string>();

  for (const choice of input.choices) {
    const slug = keySlug(choice.key);
    if (slug === "" || seen.has(slug)) continue;
    seen.add(slug);
    const row = bySlug.get(slug);
    if (!row) {
      refused.push({ key: choice.key, reason: "it is not in the schedule" });
      continue;
    }

    if (choice.assemblyId) {
      const assembly = assemblies.find((a) => a.id === choice.assemblyId);
      if (!assembly) {
        refused.push({ key: row.key, reason: "that assembly is no longer in the library" });
        continue;
      }
      const driver = driverFor(row, assembly);
      if (!driver) {
        refused.push({ key: row.key, reason: whyNoDriver(row, assembly) });
        continue;
      }
      const made = await linesForDrop(
        tx,
        ctx.tenantId,
        assembly.id,
        driver.valueThousandths,
        project.costCodeSetId,
      );
      if (!made) {
        refused.push({ key: row.key, reason: "that assembly is no longer in the library" });
        continue;
      }
      const at = figure(driver.valueThousandths, made.assembly.drivingUnit);
      items.push({
        name: made.assembly.name,
        clientNote: made.assembly.clientNote,
        isAllowance: made.assembly.isAllowance,
        basisDetail: `${made.assembly.name} at ${at} · ${offTheModel(schedule, input.fileName, row, driver.from)}`.slice(0, 400),
        lines: made.lines,
        uncoded: made.lines.filter((l) => l.costCodeId === null && l.costCode !== "").length,
      });
      if (choice.remember) {
        await rememberKey(tx, ctx, assembly.id, row.key);
        remembered += 1;
      }
      continue;
    }

    if (choice.lineFrom) {
      const line = lineFromRow(row, choice.lineFrom);
      if (!line) {
        refused.push({ key: row.key, reason: `the schedule has no ${choice.lineFrom} figure for it` });
        continue;
      }
      const from =
        choice.lineFrom === "count"
          ? `${row.count} in the schedule`
          : `${choice.lineFrom} ${figure(line.quantityThousandths, line.unit)}`;
      loose.push({ ...line, basisDetail: offTheModel(schedule, input.fileName, row, from) });
      continue;
    }

    refused.push({ key: row.key, reason: "nothing was chosen for it" });
  }

  return { items, loose, refused, remembered };
}
