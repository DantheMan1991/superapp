import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";

/**
 * Abuse and cost controls for the anonymous surface.
 *
 * Same shape as the health-check interview's: count rows in a window inside
 * the gating transaction, soft ceilings, races at the boundary accepted. These
 * are valves, not accounting.
 *
 * The byte budget is a COST control as much as a security one. A public link
 * is an egress amplifier — one leaked token pointed at a 100MB set of drawings
 * is an unbounded Vercel Blob bill, and nothing else in the system would stop
 * it.
 */

/** Unknown-token guesses tolerated from one IP per hour. */
export const PROBE_HOURLY_IP_CAP = 60;
/** Wrong passcodes tolerated from one IP per hour. */
export const UNLOCK_FAIL_HOURLY_IP_CAP = 20;
/** Bytes one share may serve per day. */
export const SHARE_DAILY_BYTE_CAP = 5 * 1024 * 1024 * 1024;
/** Active links one tenant may hold open at once. */
export const ACTIVE_SHARES_PER_TENANT = 500;

export type AttemptKind = "share_probe" | "share_unlock_fail";

function hoursAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

/**
 * Record an anonymous miss and report whether this IP is over its cap.
 *
 * Runs under withSystem because public_access_attempts belongs to no tenant —
 * there is no tenant context to run it under. The caller holds no
 * user-controlled identifiers at this point, only a hashed IP.
 */
export async function recordAttempt(
  kind: AttemptKind,
  ipHash: string,
  now: Date = new Date(),
): Promise<{ overCap: boolean }> {
  const cap =
    kind === "share_probe" ? PROBE_HOURLY_IP_CAP : UNLOCK_FAIL_HOURLY_IP_CAP;
  return withSystem(async (tx) => {
    await tx.insert(schema.publicAccessAttempts).values({ kind, ipHash });
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publicAccessAttempts)
      .where(
        and(
          eq(schema.publicAccessAttempts.kind, kind),
          eq(schema.publicAccessAttempts.ipHash, ipHash),
          gte(schema.publicAccessAttempts.createdAt, hoursAgo(now, 1)),
        ),
      );
    return { overCap: n > cap };
  });
}

/** Bytes this share has already served today. */
export async function bytesServedToday(
  tenantId: string,
  shareId: string,
  now: Date = new Date(),
): Promise<number> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        total: sql<string>`coalesce(sum(${schema.documentShareEvents.bytesSent}), 0)`,
      })
      .from(schema.documentShareEvents)
      .where(
        and(
          eq(schema.documentShareEvents.tenantId, tenantId),
          eq(schema.documentShareEvents.shareId, shareId),
          gte(schema.documentShareEvents.createdAt, dayStart),
        ),
      );
    return Number(row?.total ?? 0);
  });
}

export function isOverByteBudget(served: number, nextFileBytes: number): boolean {
  return served + nextFileBytes > SHARE_DAILY_BYTE_CAP;
}
