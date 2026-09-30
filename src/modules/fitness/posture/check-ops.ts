import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { FitnessPostureCapture } from "@/db/schema";
import { FitnessError } from "../core/errors";
import type { PostureCheckDoc } from "./core/check-doc";
import type { HistoryCheck } from "./core/history";
import type { ViewCapture } from "./core/measures";

/**
 * POSTURE CHECKS IN THE ACCOUNT (docs/modules/posture.md, slice 3; ADR 0120):
 * the server half. Every function runs inside `withTenant`, so RLS keeps each
 * personal space to its own rows whatever the arguments say.
 *
 * A check never changes once it is taken, so keeping one is an insert that a
 * resend repeats harmlessly: the phone sends it until it hears back, and the
 * id is the phone's own.
 */

/** A phone's clock may run a little fast; past this, the server's time wins. */
const FUTURE_SKEW_MS = 2 * 60 * 1000;

/** Today in UTC plus a day and a half: the furthest ahead any person's own "today" can be. */
function latestLocalDay(now: Date): string {
  return new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The table's shape and the module's are the same thing; this line stops them drifting.
const sameShape: (c: ViewCapture) => FitnessPostureCapture = (c) => c;
void sameShape;

/** The document's captures as the table keeps them: a sticker is there with its place, or not at all. */
function stored(captures: PostureCheckDoc["captures"]): FitnessPostureCapture[] {
  return captures.map((c) => ({
    ...c,
    stickers: Object.fromEntries(
      Object.entries(c.stickers).filter((e): e is [string, { x: number; y: number }] => e[1] !== undefined),
    ),
  }));
}

export async function savePostureCheck(
  tx: Tx,
  tenantId: string,
  doc: PostureCheckDoc,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  if (doc.localDay > latestLocalDay(now)) {
    throw new FitnessError("INVALID", "This phone's date is ahead of today. Check its clock, then open the posture check again.");
  }
  const taken = new Date(doc.takenAt);
  const takenAt = taken.getTime() > now.getTime() + FUTURE_SKEW_MS ? now : taken;
  // A repeat of a check this space no longer has (deleted meanwhile) is kept
  // as an ordinary check: the difference it was for can no longer be read.
  let repeatOf: string | null = null;
  if (doc.repeatOf && doc.repeatOf !== doc.id) {
    const [original] = await tx
      .select({ id: schema.fitnessPostureChecks.id })
      .from(schema.fitnessPostureChecks)
      .where(and(eq(schema.fitnessPostureChecks.tenantId, tenantId), eq(schema.fitnessPostureChecks.id, doc.repeatOf)));
    repeatOf = original ? original.id : null;
  }
  const inserted = await tx
    .insert(schema.fitnessPostureChecks)
    .values({
      id: doc.id,
      tenantId,
      takenAt,
      localDay: doc.localDay,
      captures: stored(doc.captures),
      notes: doc.notes,
      version: doc.version,
      repeatOf,
    })
    .onConflictDoNothing({ target: schema.fitnessPostureChecks.id })
    .returning({ id: schema.fitnessPostureChecks.id });
  if (inserted.length > 0) return { created: true };
  // Already here: the phone sent it again before it heard back. An id taken
  // by somebody else's row is invisible here, so it reads as missing.
  const [mine] = await tx
    .select({ id: schema.fitnessPostureChecks.id })
    .from(schema.fitnessPostureChecks)
    .where(and(eq(schema.fitnessPostureChecks.tenantId, tenantId), eq(schema.fitnessPostureChecks.id, doc.id)));
  if (!mine) throw new FitnessError("INVALID", "This check could not be kept. It is still on this phone.");
  return { created: false };
}

function toHistory(row: typeof schema.fitnessPostureChecks.$inferSelect): HistoryCheck {
  return {
    id: row.id,
    takenAt: row.takenAt.toISOString(),
    localDay: row.localDay,
    captures: row.captures as ViewCapture[],
    repeatOf: row.repeatOf,
  };
}

/** Every check in the space, newest first. */
export async function listPostureChecks(tx: Tx, tenantId: string): Promise<(HistoryCheck & { notes: string[] })[]> {
  const rows = await tx
    .select()
    .from(schema.fitnessPostureChecks)
    .where(eq(schema.fitnessPostureChecks.tenantId, tenantId))
    .orderBy(desc(schema.fitnessPostureChecks.takenAt));
  return rows.map((r) => ({ ...toHistory(r), notes: r.notes }));
}

export async function getPostureCheck(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<(HistoryCheck & { notes: string[] }) | null> {
  const [row] = await tx
    .select()
    .from(schema.fitnessPostureChecks)
    .where(and(eq(schema.fitnessPostureChecks.tenantId, tenantId), eq(schema.fitnessPostureChecks.id, id)));
  return row ? { ...toHistory(row), notes: row.notes } : null;
}

/** Gone from the account. Deleting one that is not there is not an error: it is gone either way. */
export async function deletePostureCheck(tx: Tx, tenantId: string, id: string): Promise<{ deleted: boolean }> {
  const gone = await tx
    .delete(schema.fitnessPostureChecks)
    .where(and(eq(schema.fitnessPostureChecks.tenantId, tenantId), eq(schema.fitnessPostureChecks.id, id)))
    .returning({ id: schema.fitnessPostureChecks.id });
  return { deleted: gone.length > 0 };
}
