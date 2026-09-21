"use server";

import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { JobsError, type JobsCtx } from "./ops";
import { PACK } from "./vocabulary";
import { parseRoomList } from "./room-math";
import {
  addRoomList,
  asRoomViews,
  createRoom,
  deleteRoom,
  listRooms,
  setRoomArea,
  updateRoom,
} from "./room-ops";
export type { RoomView } from "./room-ops";
import { readMeasureReply } from "./measure-math";

/**
 * THE ROOMS, AS THE SCREEN CHANGES THEM (X8).
 *
 * Plain CRUD over a project's rooms. The one action that also moves the WALK
 * on — answering the measure-up's rooms question — lives in
 * `walk-actions.ts` beside the rest of the turn machinery, the same split
 * X7 used for measuring off a drawing.
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

const listSchema = z.object({ projectId: z.string().uuid() });

export async function listRoomsAction(input: unknown) {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const rooms = await withTenant(
      ctx.tenantId,
      (tx) => listRooms(tx, ctx.tenantId, parsed.data.projectId),
      { role: ctx.role },
    );
    return { ok: true as const, rooms: asRoomViews(rooms) };
  } catch (err) {
    return toResult(err);
  }
}

const pasteSchema = z.object({
  projectId: z.string().uuid(),
  text: z.string().trim().min(1).max(20_000),
});

/**
 * **A WHOLE LIST AT ONCE.** Typing fifteen rooms into fifteen forms is why
 * a feature like this goes unused, so the list is pasted — off a finish
 * schedule, out of a spreadsheet, or typed with a floor heading or two.
 */
export async function addRoomsAction(input: unknown) {
  const parsed = pasteSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const read = parseRoomList(parsed.data.text);
  if (read.rooms.length === 0) {
    return { error: "No room names in that. One room a line." };
  }
  try {
    const ctx = await gate();
    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const counts = await addRoomList(tx, ctx, parsed.data.projectId, read.rooms);
        return { counts, rooms: await listRooms(tx, ctx.tenantId, parsed.data.projectId) };
      },
      { role: ctx.role },
    );
    return {
      ok: true as const,
      ...result.counts,
      /** The lines it could not read, so nothing disappears silently. */
      skipped: read.skipped,
      rooms: asRoomViews(result.rooms),
    };
  } catch (err) {
    return toResult(err);
  }
}

const oneSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  level: z.string().trim().max(80),
});

export async function addRoomAction(input: unknown) {
  const parsed = oneSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const rooms = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await createRoom(tx, ctx, parsed.data.projectId, {
          name: parsed.data.name,
          level: parsed.data.level,
        });
        return listRooms(tx, ctx.tenantId, parsed.data.projectId);
      },
      { role: ctx.role },
    );
    return { ok: true as const, rooms: asRoomViews(rooms) };
  } catch (err) {
    return toResult(err);
  }
}

const editSchema = z.object({
  projectId: z.string().uuid(),
  roomId: z.string().uuid(),
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(120),
  level: z.string().trim().max(80),
  notes: z.string().trim().max(500).optional(),
});

export async function updateRoomAction(input: unknown) {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const rooms = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await updateRoom(tx, ctx, parsed.data.roomId, {
          name: parsed.data.name,
          level: parsed.data.level,
          notes: parsed.data.notes,
          version: parsed.data.version,
        });
        return listRooms(tx, ctx.tenantId, parsed.data.projectId);
      },
      { role: ctx.role },
    );
    return { ok: true as const, rooms: asRoomViews(rooms) };
  } catch (err) {
    return toResult(err);
  }
}

const dropSchema = z.object({
  projectId: z.string().uuid(),
  roomId: z.string().uuid(),
});

export async function deleteRoomAction(input: unknown) {
  const parsed = dropSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const rooms = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await deleteRoom(tx, ctx, parsed.data.roomId);
        return listRooms(tx, ctx.tenantId, parsed.data.projectId);
      },
      { role: ctx.role },
    );
    return { ok: true as const, rooms: asRoomViews(rooms) };
  } catch (err) {
    return toResult(err);
  }
}

const areaSchema = z.object({
  projectId: z.string().uuid(),
  roomId: z.string().uuid(),
  /** What was typed, read by the parser the walk uses. */
  said: z.string().trim().max(200),
  /** Set when the figure came off a drawing rather than a keyboard. */
  sheetId: z.string().uuid().optional(),
  markupId: z.string().uuid().optional(),
  unit: z.string().trim().max(20).optional(),
});

/**
 * A room's floor area.
 *
 * **THE SAME PARSER AS THE WALK'S**, so `24 x 40` typed into a row of this
 * table means what it means everywhere else. A figure that came off a
 * drawing arrives with its sheet and its trace and is marked `measured`.
 */
export async function setRoomAreaAction(input: unknown) {
  const parsed = areaSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const read = readMeasureReply(parsed.data.said);
  if (read.kind !== "value") {
    return { error: "That did not read as one figure. Try 310, 24 x 40 or 18'-6\"." };
  }
  try {
    const ctx = await gate();
    const rooms = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await setRoomArea(tx, ctx, {
          projectId: parsed.data.projectId,
          roomId: parsed.data.roomId,
          valueThousandths: read.valueThousandths,
          unit: parsed.data.unit,
          source: parsed.data.sheetId ? "measured" : "said",
          sheetId: parsed.data.sheetId ?? null,
          markupId: parsed.data.markupId ?? null,
        });
        return listRooms(tx, ctx.tenantId, parsed.data.projectId);
      },
      { role: ctx.role },
    );
    return { ok: true as const, rooms: asRoomViews(rooms) };
  } catch (err) {
    return toResult(err);
  }
}
