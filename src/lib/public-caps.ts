import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";

/**
 * Caps for the platform's UNAUTHENTICATED surfaces — the public contact form
 * and every tenant website's enquiry form — counted in
 * `public_access_attempts`, the table the health check first needed for the
 * same job, rather than a table per form.
 *
 * A VALVE, NOT ACCOUNTING. The attempt is written and counted in one
 * transaction so concurrent submissions serialize rather than both slipping
 * through; races exactly at a boundary are accepted. Runs under `withSystem`
 * because an attempt belongs to no tenant, and the only identifier stored is
 * an already-hashed IP.
 */

/**
 * The platform's salt for anonymising IPs before they are stored.
 *
 * The env var is named for the health check because that is what first needed
 * it; it is the platform's only anonymous-IP salt and is shared by every public
 * surface. Missing salt does not disable a form — it drops the per-IP key and
 * leans on the daily cap instead, because "we can't rate limit you" is not a
 * good reason to refuse to hear from a customer.
 */
export function ipKey(ip: string): string {
  const salt = process.env.INTERVIEW_IP_SALT;
  if (!salt) return "unsalted";
  return createHash("sha256").update(`${salt}${ip}`).digest("hex");
}

export interface PublicCap {
  /** The `kind` column: one word per surface, e.g. `contact_form`. */
  kind: string;
  /** Attempts tolerated from one IP per hour. */
  hourlyIpCap: number;
  /** Attempts accepted platform-wide per UTC day. */
  dailyCap: number;
}

function hoursAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

export function startOfUtcDay(now: Date): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/** Record the attempt and report whether it is over either cap. */
export async function overPublicCap(cap: PublicCap, ipHash: string): Promise<boolean> {
  const now = new Date();
  return withSystem(async (tx) => {
    await tx.insert(schema.publicAccessAttempts).values({ kind: cap.kind, ipHash });

    const [perIp] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publicAccessAttempts)
      .where(
        and(
          eq(schema.publicAccessAttempts.kind, cap.kind),
          eq(schema.publicAccessAttempts.ipHash, ipHash),
          gte(schema.publicAccessAttempts.createdAt, hoursAgo(now, 1)),
        ),
      );
    if (ipHash !== "unsalted" && perIp.n > cap.hourlyIpCap) return true;

    const [perDay] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publicAccessAttempts)
      .where(
        and(
          eq(schema.publicAccessAttempts.kind, cap.kind),
          gte(schema.publicAccessAttempts.createdAt, startOfUtcDay(now)),
        ),
      );
    return perDay.n > cap.dailyCap;
  });
}
