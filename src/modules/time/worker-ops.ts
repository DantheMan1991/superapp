import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { createParty, PartyError } from "@/lib/parties";
import { TimeError } from "./core/errors";

/**
 * Who the business can log time for. ONE WRITER per table, the rule
 * `src/lib/enterprises/index.ts` states: two call sites issuing their own
 * UPDATEs is how a codebase acquires last-write-wins bugs nobody can reproduce.
 *
 * Every function takes the caller's `tx` and never opens its own.
 */

export interface NewWorkerInput {
  /** An existing person on the party spine, or null to create one. */
  partyId?: string | null;
  name?: string;
  /** The sign-in this person uses, when they have one. */
  clerkUserId?: string | null;
}

/**
 * Add somebody whose hours the business records.
 *
 * TWO DOORS INTO ONE ROW, and both are needed. `partyId` is the door for
 * somebody the business already knows — a subcontractor who is also a vendor
 * becomes a worker without a second record of the same human being, which is
 * the property the party spine exists to give. `name` is the door for the
 * seasonal hand nobody has ever invoiced, who should not require a trip to
 * another module before their first day can be recorded.
 */
export async function createWorker(
  tx: Tx,
  tenantId: string,
  input: NewWorkerInput,
): Promise<string> {
  let partyId = input.partyId ?? null;

  if (!partyId) {
    const name = (input.name ?? "").trim();
    if (!name) {
      throw new TimeError("WORKER_NAME_REQUIRED", "a worker needs a name");
    }
    try {
      const party = await createParty(tx, tenantId, {
        kind: "person",
        displayName: name,
      });
      partyId = party.id;
    } catch (err) {
      // The shared subsystem's vocabulary stops here. The client should never
      // see the word "party" — it is our word for a seam.
      if (err instanceof PartyError) {
        throw new TimeError("WORKER_NAME_REQUIRED", err.message);
      }
      throw err;
    }
  }

  const clerkUserId = (input.clerkUserId ?? "").trim() || null;

  /*
   * The two unique indexes are the arbiters, not a look-before-you-leap SELECT:
   * between the check and the insert another request can win, and the index is
   * the only thing that cannot be raced. Translated here so the screen gets a
   * sentence rather than a constraint name.
   */
  try {
    const [row] = await tx
      .insert(schema.timeWorkers)
      .values({ tenantId, partyId, clerkUserId })
      .returning({ id: schema.timeWorkers.id });
    return row.id;
  } catch (err) {
    const detail = String(err);
    if (detail.includes("time_workers_tenant_party_idx")) {
      throw new TimeError(
        "WORKER_EXISTS_FOR_PARTY",
        "this person already has a worker record",
      );
    }
    if (detail.includes("time_workers_tenant_user_idx")) {
      throw new TimeError(
        "WORKER_EXISTS_FOR_USER",
        "that sign-in is already linked to somebody",
      );
    }
    throw err;
  }
}

/**
 * Mark that somebody has left, or bring them back.
 *
 * NEVER A DELETE. Their hours are what the business paid, and a record that can
 * be erased is a record nobody can rely on. `is_active` is what the picker
 * reads; every past entry keeps pointing at the same row.
 */
export async function setWorkerActive(
  tx: Tx,
  tenantId: string,
  workerId: string,
  isActive: boolean,
  expectedVersion: number,
): Promise<void> {
  const result = await tx
    .update(schema.timeWorkers)
    .set({
      isActive,
      version: sql`${schema.timeWorkers.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, workerId),
        eq(schema.timeWorkers.version, expectedVersion),
      ),
    )
    .returning({ id: schema.timeWorkers.id });

  if (result.length === 0) {
    // Either it is gone or somebody else changed it first. One more read tells
    // the reader which, and the two need different sentences.
    const still = await tx.query.timeWorkers.findFirst({
      where: and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, workerId),
      ),
    });
    throw still
      ? new TimeError("STALE_VERSION", "worker changed underneath")
      : new TimeError("WORKER_NOT_FOUND", "no such worker");
  }
}

/**
 * Link a worker to the sign-in they use, or unlink them.
 *
 * What makes "log my own time" the default on the next visit. Unlinking is
 * ordinary rather than exceptional: somebody who used to hold a login and no
 * longer does still has hours.
 */
export async function setWorkerUser(
  tx: Tx,
  tenantId: string,
  workerId: string,
  clerkUserId: string | null,
  expectedVersion: number,
): Promise<void> {
  try {
    const result = await tx
      .update(schema.timeWorkers)
      .set({
        clerkUserId: clerkUserId?.trim() || null,
        version: sql`${schema.timeWorkers.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.timeWorkers.tenantId, tenantId),
          eq(schema.timeWorkers.id, workerId),
          eq(schema.timeWorkers.version, expectedVersion),
        ),
      )
      .returning({ id: schema.timeWorkers.id });

    if (result.length === 0) {
      const still = await tx.query.timeWorkers.findFirst({
        where: and(
          eq(schema.timeWorkers.tenantId, tenantId),
          eq(schema.timeWorkers.id, workerId),
        ),
      });
      throw still
        ? new TimeError("STALE_VERSION", "worker changed underneath")
        : new TimeError("WORKER_NOT_FOUND", "no such worker");
    }
  } catch (err) {
    if (String(err).includes("time_workers_tenant_user_idx")) {
      throw new TimeError(
        "WORKER_EXISTS_FOR_USER",
        "that sign-in is already linked to somebody",
      );
    }
    throw err;
  }
}
