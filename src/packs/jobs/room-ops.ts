import "server-only";
import { and, asc, eq, isNotNull, max } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobRoom } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import { measureSlug } from "./measure-math";
import { recordMeasurement } from "./measure-ops";
import { FLOOR_AREA, type ParsedRoom, type RoomFacts } from "./room-math";

/**
 * THE ROOMS IN A BUILDING (X8). `room-math.ts` has the reasoning; this is
 * the half that touches the database.
 *
 * ── A ROOM AND ITS AREA ARE TWO ROWS, READ AS ONE ───────────────────────────
 *
 * The area lives in `job_measurements` scoped to the room (ADR 0100), so
 * every read here joins it back on. The join is worth it: a room's area is
 * then parsed, measured off a drawing and traced to a sheet by machinery
 * that already exists and is already tested, instead of a second column
 * with a second set of all of it.
 */

/** A room with its floor area, which is how anything upstream wants it. */
export interface RoomRow {
  room: JobRoom;
  areaThousandths: number | null;
  areaUnit: string;
  /** The sheet the area was traced on, when it was traced. */
  areaSheetId: string | null;
  areaSource: string;
}

/**
 * **ONE SHAPE FOR A ROOM ON A SCREEN**, here rather than in the actions
 * file, because the walk's view carries rooms too and two near-identical
 * shapes for one thing is how they drift apart.
 */
export interface RoomView {
  id: string;
  version: number;
  name: string;
  level: string;
  notes: string;
  areaThousandths: number | null;
  areaUnit: string;
  /** Traced on a drawing rather than typed. */
  measured: boolean;
}

export function asRoomViews(rows: readonly RoomRow[]): RoomView[] {
  return rows.map((r) => ({
    id: r.room.id,
    version: r.room.version,
    name: r.room.name,
    level: r.room.level,
    notes: r.room.notes,
    areaThousandths: r.areaThousandths,
    areaUnit: r.areaUnit,
    measured: r.areaSource === "measured",
  }));
}

/** The pure half's shape, off a joined read. */
export function asRoomFacts(rows: readonly RoomRow[]): RoomFacts[] {
  return rows.map((r) => ({
    id: r.room.id,
    name: r.room.name,
    slug: r.room.slug,
    level: r.room.level,
    areaThousandths: r.areaThousandths,
    areaUnit: r.areaUnit,
  }));
}

export async function listRooms(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<RoomRow[]> {
  const rows = await tx
    .select({
      room: schema.jobRooms,
      areaThousandths: schema.jobMeasurements.valueThousandths,
      areaUnit: schema.jobMeasurements.unit,
      areaSheetId: schema.jobMeasurements.sheetId,
      areaSource: schema.jobMeasurements.source,
    })
    .from(schema.jobRooms)
    /**
     * The floor area only. A room may one day carry a wall area beside it
     * (the whole point of putting these in `job_measurements`), and this
     * read must not start returning two rows for one room the day it does.
     */
    .leftJoin(
      schema.jobMeasurements,
      and(
        eq(schema.jobMeasurements.tenantId, schema.jobRooms.tenantId),
        eq(schema.jobMeasurements.roomId, schema.jobRooms.id),
        eq(schema.jobMeasurements.slug, measureSlug(FLOOR_AREA)),
      ),
    )
    .where(
      and(eq(schema.jobRooms.tenantId, tenantId), eq(schema.jobRooms.projectId, projectId)),
    )
    .orderBy(asc(schema.jobRooms.sortOrder), asc(schema.jobRooms.name));
  return rows.map((r) => ({
    room: r.room,
    areaThousandths: r.areaThousandths,
    areaUnit: r.areaUnit ?? "",
    areaSheetId: r.areaSheetId,
    areaSource: r.areaSource ?? "",
  }));
}

export async function getRoom(
  tx: Tx,
  tenantId: string,
  roomId: string,
): Promise<JobRoom | null> {
  const rows = await tx
    .select()
    .from(schema.jobRooms)
    .where(and(eq(schema.jobRooms.tenantId, tenantId), eq(schema.jobRooms.id, roomId)))
    .limit(1);
  return rows[0] ?? null;
}

async function nextSortOrder(tx: Tx, tenantId: string, projectId: string): Promise<number> {
  const rows = await tx
    .select({ top: max(schema.jobRooms.sortOrder) })
    .from(schema.jobRooms)
    .where(
      and(eq(schema.jobRooms.tenantId, tenantId), eq(schema.jobRooms.projectId, projectId)),
    );
  return (rows[0]?.top ?? -1) + 1;
}

export interface RoomInput {
  name: string;
  level: string;
  notes?: string;
}

export async function createRoom(
  tx: Tx,
  ctx: JobsCtx,
  projectId: string,
  input: RoomInput,
): Promise<JobRoom> {
  requireWrite(ctx, "member");
  const name = input.name.trim();
  const slug = measureSlug(name);
  if (slug === "") throw new JobsError("INVALID_VALUE", "a room needs a name");
  const rows = await tx
    .insert(schema.jobRooms)
    .values({
      tenantId: ctx.tenantId,
      projectId,
      name,
      slug,
      level: input.level.trim(),
      sortOrder: await nextSortOrder(tx, ctx.tenantId, projectId),
      notes: (input.notes ?? "").trim(),
    })
    /**
     * The same room pasted twice, or added twice by two people, is one
     * room — not an error somebody has to read and dismiss. The floor is
     * part of the identity, so `Bathroom` upstairs is not this one.
     */
    .onConflictDoNothing({
      target: [
        schema.jobRooms.tenantId,
        schema.jobRooms.projectId,
        schema.jobRooms.level,
        schema.jobRooms.slug,
      ],
    })
    .returning();
  if (rows[0]) return rows[0];
  const existing = await tx
    .select()
    .from(schema.jobRooms)
    .where(
      and(
        eq(schema.jobRooms.tenantId, ctx.tenantId),
        eq(schema.jobRooms.projectId, projectId),
        eq(schema.jobRooms.level, input.level.trim()),
        eq(schema.jobRooms.slug, slug),
      ),
    )
    .limit(1);
  if (!existing[0]) throw new JobsError("NOT_FOUND", "that room could not be written");
  return existing[0];
}

/**
 * **A WHOLE LIST AT ONCE**, which is the only way anybody puts fifteen rooms
 * in. Returns what was added and what was already there, because "nothing
 * happened" and "they were all already here" look identical otherwise.
 */
export async function addRoomList(
  tx: Tx,
  ctx: JobsCtx,
  projectId: string,
  parsed: readonly ParsedRoom[],
): Promise<{ added: number; alreadyThere: number; withArea: number }> {
  requireWrite(ctx, "member");
  const before = new Set(
    (await listRooms(tx, ctx.tenantId, projectId)).map(
      (r) => `${measureSlug(r.room.level)}/${r.room.slug}`,
    ),
  );
  let added = 0;
  let alreadyThere = 0;
  let withArea = 0;
  for (const p of parsed) {
    const key = `${measureSlug(p.level)}/${measureSlug(p.name)}`;
    const isNew = !before.has(key);
    const room = await createRoom(tx, ctx, projectId, { name: p.name, level: p.level });
    if (isNew) {
      added += 1;
      before.add(key);
    } else {
      alreadyThere += 1;
    }
    /**
     * An area that came with the line is written even for a room that was
     * already there — pasting a finish schedule over a list somebody typed
     * is exactly how the numbers arrive, and refusing them would waste the
     * paste.
     */
    if (p.areaThousandths !== null) {
      await setRoomArea(tx, ctx, {
        projectId,
        roomId: room.id,
        valueThousandths: p.areaThousandths,
      });
      withArea += 1;
    }
  }
  return { added, alreadyThere, withArea };
}

export async function updateRoom(
  tx: Tx,
  ctx: JobsCtx,
  roomId: string,
  input: RoomInput & { version: number },
): Promise<JobRoom> {
  requireWrite(ctx, "member");
  const name = input.name.trim();
  const slug = measureSlug(name);
  if (slug === "") throw new JobsError("INVALID_VALUE", "a room needs a name");
  const rows = await tx
    .update(schema.jobRooms)
    .set({
      name,
      slug,
      level: input.level.trim(),
      notes: (input.notes ?? "").trim(),
      version: input.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.jobRooms.tenantId, ctx.tenantId),
        eq(schema.jobRooms.id, roomId),
        eq(schema.jobRooms.version, input.version),
      ),
    )
    .returning();
  if (rows.length === 0) throw new JobsError("STALE_VERSION", "room changed since loaded");
  return rows[0];
}

/** The room goes, and its area goes with it — by the FK, not by this code. */
export async function deleteRoom(tx: Tx, ctx: JobsCtx, roomId: string): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .delete(schema.jobRooms)
    .where(and(eq(schema.jobRooms.tenantId, ctx.tenantId), eq(schema.jobRooms.id, roomId)));
}

/**
 * A room's floor area — an ordinary measurement, scoped to the room.
 *
 * The unit defaults to the takeoff's word for an area rather than being
 * asked for: nobody wants a unit box on fifteen rows, and a room measured
 * off a metric sheet arrives with its own through `unit`.
 */
export async function setRoomArea(
  tx: Tx,
  ctx: JobsCtx,
  input: {
    projectId: string;
    roomId: string;
    valueThousandths: number;
    unit?: string;
    source?: "measured" | "said" | "derived";
    note?: string;
    sheetId?: string | null;
    markupId?: string | null;
  },
): Promise<void> {
  await recordMeasurement(tx, ctx, {
    projectId: input.projectId,
    roomId: input.roomId,
    name: FLOOR_AREA,
    unit: input.unit ?? "sf",
    valueThousandths: input.valueThousandths,
    source: input.source ?? "said",
    note: input.note,
    sheetId: input.sheetId ?? null,
    markupId: input.markupId ?? null,
  });
}

/** Every room measurement on a job, for a read that wants them all at once. */
export async function listRoomMeasurements(tx: Tx, tenantId: string, projectId: string) {
  return tx
    .select()
    .from(schema.jobMeasurements)
    .where(
      and(
        eq(schema.jobMeasurements.tenantId, tenantId),
        eq(schema.jobMeasurements.projectId, projectId),
        isNotNull(schema.jobMeasurements.roomId),
      ),
    )
    .orderBy(asc(schema.jobMeasurements.takenAt));
}
