import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";

/**
 * ABUSE COUNTERS FOR THE PLATFORM'S ANONYMOUS SURFACES.
 *
 * Moved here from `modules/documents/shares/limits.ts` when the estimate's
 * client link became the second surface that needed it (E5c, ADR 0085) — the
 * same reason the PDF fonts moved to `src/lib/pdf` when Accounting started
 * drawing invoices. A pack may not reach into a module for a security
 * control, and duplicating one is worse than moving it: two copies of a cap
 * is two things to tune and one to forget. The byte budget and the
 * per-tenant ceiling stayed behind, because they are about files.
 *
 * `public_access_attempts` belongs to NO TENANT — a visitor has no tenant
 * context to count under — so this runs under `withSystem` holding nothing
 * user-controlled but a hashed IP. Raw addresses are never stored.
 *
 * Same shape as the health-check interview's: count rows in a window inside
 * the gating transaction, soft ceilings, races at the boundary accepted.
 * **These are valves, not accounting.**
 */

export type AttemptKind =
  /** A token at /s/… that resolved to nothing. */
  | "share_probe"
  /** A wrong passcode on a document share. */
  | "share_unlock_fail"
  /** A token at /p/… that resolved to nothing. */
  | "proposal_probe"
  /** An acceptance posted to a proposal link, good or bad. */
  | "proposal_sign";

/**
 * Guesses tolerated from one IP per hour, per kind.
 *
 * A probe cap is set where a human reloading or mistyping never reaches it
 * and a script walking the keyspace does immediately — which, against a
 * 256-bit token, is theatre either way; the real reason is cost, because
 * every guess is otherwise a free database round trip.
 */
const HOURLY_IP_CAP: Record<AttemptKind, number> = {
  share_probe: 60,
  share_unlock_fail: 20,
  proposal_probe: 60,
  proposal_sign: 10,
};

/** Unknown-token guesses tolerated from one IP per hour. */
export const PROBE_HOURLY_IP_CAP = HOURLY_IP_CAP.share_probe;
/** Wrong passcodes tolerated from one IP per hour. */
export const UNLOCK_FAIL_HOURLY_IP_CAP = HOURLY_IP_CAP.share_unlock_fail;

export function hourlyIpCap(kind: AttemptKind): number {
  return HOURLY_IP_CAP[kind];
}

function hoursAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

/**
 * Record an anonymous attempt and report whether this IP is over its cap.
 *
 * The caller holds no user-controlled identifiers at this point, only a
 * hashed IP — which is the whole reason this is safe to run as the system.
 */
export async function recordAttempt(
  kind: AttemptKind,
  ipHash: string,
  now: Date = new Date(),
): Promise<{ overCap: boolean }> {
  const cap = hourlyIpCap(kind);
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
