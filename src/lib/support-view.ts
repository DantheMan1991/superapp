import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withSystem, schema, type Tx } from "@/db";
import type { SupportSession } from "@/db/schema";
import { supportExpiry } from "./support-view-decide";

/**
 * Support sessions (back-office slice 4): a superadmin's time-boxed,
 * read-only, audited look at a client's workspace as its staff see it.
 *
 * The rows are platform-level and superadmin-only. The console opens and
 * ends one; `src/lib/auth.ts` reads it on every tenant request and decides,
 * through `decideSupportView`, whether this request may be a view. Everything
 * here runs under `withSystem`, which is legal: the caller is either the
 * console after `requireSuperAdmin()` or the auth resolver itself.
 */

export interface SupportView {
  sessionId: string;
  tenantId: string;
  tenantName: string;
  reason: string;
  openedAt: Date;
  expiresAt: Date;
}

/** The person's live session — unended and unexpired — inside a caller's tx. */
export async function liveSupportSessionInTx(
  tx: Tx,
  clerkUserId: string,
): Promise<SupportSession | null> {
  const row = await tx.query.supportSessions.findFirst({
    where: and(
      eq(schema.supportSessions.clerkUserId, clerkUserId),
      isNull(schema.supportSessions.endedAt),
      sql`${schema.supportSessions.expiresAt} > now()`,
    ),
  });
  return row ?? null;
}

export async function liveSupportSession(clerkUserId: string): Promise<SupportSession | null> {
  return withSystem((tx) => liveSupportSessionInTx(tx, clerkUserId));
}

/**
 * Open a session, ending whatever the person had open before — one live
 * session per person, which the partial unique index also enforces.
 */
export async function openSupportSession(input: {
  tenantId: string;
  clerkUserId: string;
  reason: string;
}): Promise<SupportSession> {
  return withSystem(async (tx) => {
    await tx
      .update(schema.supportSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(schema.supportSessions.clerkUserId, input.clerkUserId),
          isNull(schema.supportSessions.endedAt),
        ),
      );
    const now = new Date();
    const [row] = await tx
      .insert(schema.supportSessions)
      .values({
        tenantId: input.tenantId,
        clerkUserId: input.clerkUserId,
        reason: input.reason,
        openedAt: now,
        expiresAt: supportExpiry(now),
      })
      .returning();
    return row;
  });
}

/** End the person's live session, if any. Answers the session that was ended. */
export async function endSupportSession(clerkUserId: string): Promise<SupportSession | null> {
  const [row] = await withSystem((tx) =>
    tx
      .update(schema.supportSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(schema.supportSessions.clerkUserId, clerkUserId),
          isNull(schema.supportSessions.endedAt),
        ),
      )
      .returning(),
  );
  return row ?? null;
}

/**
 * One render under a support view: the session's count and last-viewed
 * time, and the audit row with the path — identifiers only.
 */
export async function recordSupportView(input: {
  sessionId: string;
  tenantId: string;
  clerkUserId: string;
  path: string;
}): Promise<void> {
  await withSystem(async (tx) => {
    await tx
      .update(schema.supportSessions)
      .set({ lastViewedAt: new Date(), viewCount: sql`${schema.supportSessions.viewCount} + 1` })
      .where(eq(schema.supportSessions.id, input.sessionId));
    await tx.insert(schema.auditLog).values({
      action: "support.viewed",
      tenantId: input.tenantId,
      actorClerkUserId: input.clerkUserId,
      actorLabel: "support-view",
      targetType: "support_session",
      targetId: input.sessionId,
      meta: { path: input.path },
    });
  });
}
