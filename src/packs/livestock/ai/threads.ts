import "server-only";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  LivestockAdvisorMessage,
  LivestockAdvisorThread,
} from "@/db/schema";
import { DAY_MS, threadTitle } from "../core/threads";

/**
 * The advisor's threads — what was asked and what it said, kept per person.
 *
 * Beside `advisor.ts` rather than in `ops.ts`, because this is the advisor's
 * own furniture and nothing else in the pack reads it. Server-only for the
 * same reason the prompt is: none of this belongs in a browser bundle.
 *
 * **EVERY READ IS SCOPED TO THE ASKER.** A thread is a conversation, not a
 * farm record; the farm's facts in it came from the digest, which every
 * member can already see, but what one person wondered about their cows is
 * theirs. RLS keeps the rows inside the tenant; `clerkUserId` keeps them
 * inside the person.
 */

/** How many of a person's threads the page lists. Older ones are still theirs; nothing lists them. */
export const ADVISOR_THREADS_SHOWN = 20;

export type AdvisorTurnRow = Pick<LivestockAdvisorMessage, "id" | "role" | "content" | "position">;

export async function listAdvisorThreads(
  tx: Tx,
  tenantId: string,
  userId: string,
): Promise<LivestockAdvisorThread[]> {
  return tx.query.livestockAdvisorThreads.findMany({
    where: and(
      eq(schema.livestockAdvisorThreads.tenantId, tenantId),
      eq(schema.livestockAdvisorThreads.clerkUserId, userId),
    ),
    orderBy: (t) => [desc(t.updatedAt)],
    limit: ADVISOR_THREADS_SHOWN,
  });
}

/** One of the asker's threads with its turns in order, or null when it is not theirs. */
export async function getAdvisorThread(
  tx: Tx,
  tenantId: string,
  userId: string,
  id: string,
): Promise<{ thread: LivestockAdvisorThread; turns: AdvisorTurnRow[] } | null> {
  const thread = await tx.query.livestockAdvisorThreads.findFirst({
    where: and(
      eq(schema.livestockAdvisorThreads.tenantId, tenantId),
      eq(schema.livestockAdvisorThreads.clerkUserId, userId),
      eq(schema.livestockAdvisorThreads.id, id),
    ),
  });
  if (!thread) return null;
  const turns = await tx.query.livestockAdvisorMessages.findMany({
    where: and(
      eq(schema.livestockAdvisorMessages.tenantId, tenantId),
      eq(schema.livestockAdvisorMessages.threadId, id),
    ),
    orderBy: (m, { asc }) => [asc(m.position)],
    columns: { id: true, role: true, content: true, position: true },
  });
  return { thread, turns };
}

/** The asker's newest thread, or null when they have none. */
export async function latestAdvisorThread(
  tx: Tx,
  tenantId: string,
  userId: string,
): Promise<{ thread: LivestockAdvisorThread; turns: AdvisorTurnRow[] } | null> {
  const [newest] = await tx.query.livestockAdvisorThreads.findMany({
    where: and(
      eq(schema.livestockAdvisorThreads.tenantId, tenantId),
      eq(schema.livestockAdvisorThreads.clerkUserId, userId),
    ),
    orderBy: (t) => [desc(t.updatedAt)],
    limit: 1,
  });
  return newest ? getAdvisorThread(tx, tenantId, userId, newest.id) : null;
}

/** A thread, titled from its first question. No turns yet: those come with the answer. */
export async function startAdvisorThread(
  tx: Tx,
  tenantId: string,
  userId: string,
  firstQuestion: string,
): Promise<LivestockAdvisorThread> {
  const [row] = await tx
    .insert(schema.livestockAdvisorThreads)
    .values({ tenantId, clerkUserId: userId, title: threadTitle(firstQuestion) })
    .returning();
  return row;
}

/**
 * Append turns in order — a question and its answer, as one act — and mark
 * the thread touched so it leads the list. Positions are dense from what is
 * already there.
 */
export async function appendAdvisorTurns(
  tx: Tx,
  tenantId: string,
  threadId: string,
  turns: { role: "user" | "assistant"; content: string }[],
): Promise<void> {
  if (turns.length === 0) return;
  const [{ n }] = await tx
    .select({ n: count() })
    .from(schema.livestockAdvisorMessages)
    .where(
      and(
        eq(schema.livestockAdvisorMessages.tenantId, tenantId),
        eq(schema.livestockAdvisorMessages.threadId, threadId),
      ),
    );
  await tx.insert(schema.livestockAdvisorMessages).values(
    turns.map((turn, i) => ({
      tenantId,
      threadId,
      position: Number(n) + i,
      role: turn.role,
      content: turn.content,
    })),
  );
  await tx
    .update(schema.livestockAdvisorThreads)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(schema.livestockAdvisorThreads.tenantId, tenantId),
        eq(schema.livestockAdvisorThreads.id, threadId),
      ),
    );
}

/** Remove one of the asker's threads and everything in it. False when it was not theirs. */
export async function deleteAdvisorThread(
  tx: Tx,
  tenantId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const gone = await tx
    .delete(schema.livestockAdvisorThreads)
    .where(
      and(
        eq(schema.livestockAdvisorThreads.tenantId, tenantId),
        eq(schema.livestockAdvisorThreads.clerkUserId, userId),
        eq(schema.livestockAdvisorThreads.id, id),
      ),
    )
    .returning({ id: schema.livestockAdvisorThreads.id });
  return gone.length > 0;
}

/**
 * How many questions this farm has asked since `since` — the cap's count,
 * over every person's threads, because the cost is the farm's.
 */
export async function questionsAskedSince(
  tx: Tx,
  tenantId: string,
  since: Date,
): Promise<number> {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(schema.livestockAdvisorMessages)
    .where(
      and(
        eq(schema.livestockAdvisorMessages.tenantId, tenantId),
        eq(schema.livestockAdvisorMessages.role, "user"),
        gt(schema.livestockAdvisorMessages.createdAt, since),
      ),
    );
  return Number(n);
}

/**
 * The cap's count: questions in the rolling day behind now. The clock is read
 * here, in a server module, rather than in a page's render — a component must
 * stay pure, and this is not.
 */
export async function questionsAskedInLastDay(tx: Tx, tenantId: string): Promise<number> {
  return questionsAskedSince(tx, tenantId, new Date(Date.now() - DAY_MS));
}
