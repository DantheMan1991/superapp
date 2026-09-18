import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";

/**
 * Cost controls for the document share surface. The IP counters this file
 * used to hold moved to `src/lib/public-limits.ts` when the estimate's client
 * link became the second anonymous surface (E5c, ADR 0085); they are
 * re-exported here so nothing that imported them from this path broke.
 *
 * What stayed is about FILES. The byte budget is a cost control as much as a
 * security one: a public link is an egress amplifier — one leaked token
 * pointed at a 100MB set of drawings is an unbounded Vercel Blob bill, and
 * nothing else in the system would stop it.
 */

export {
  PROBE_HOURLY_IP_CAP,
  UNLOCK_FAIL_HOURLY_IP_CAP,
  hourlyIpCap,
  recordAttempt,
  type AttemptKind,
} from "@/lib/public-limits";

/** Bytes one share may serve per day. */
export const SHARE_DAILY_BYTE_CAP = 5 * 1024 * 1024 * 1024;
/** Active links one tenant may hold open at once. */
export const ACTIVE_SHARES_PER_TENANT = 500;

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
