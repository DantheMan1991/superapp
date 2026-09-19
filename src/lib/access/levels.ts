import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { AccessLevel } from "@/db/schema";
import { normaliseDenied } from "./can";

/**
 * THE ACCESS LEVEL SUBSYSTEM — the single door onto `access_levels` (ADR 0093).
 *
 * The three properties `src/lib/parties/` and `src/lib/enterprises/` document
 * hold here too, and here they are load-bearing rather than tidy:
 *
 *  1. **Every function takes the CALLER'S `tx`.** Nothing here opens a
 *     transaction or reaches for `withSystem`. The write policies are
 *     owners-only in the database (`drizzle/0385`), so a caller who did not
 *     pass `{ role: "owner" }` from a `requireTenantOwner()` result is refused
 *     by Postgres rather than by this file remembering to ask.
 *  2. **`tenantId` is in every WHERE clause**, so the query is right even if
 *     the RLS context were somehow wrong.
 *  3. **One writer**, because two call sites issuing their own UPDATEs against
 *     a capability table is how a codebase acquires a privilege bug nobody can
 *     reproduce.
 */

export type { AccessLevel };

export class AccessError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NAME_TAKEN" | "INVALID_NAME" | "IN_USE",
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

/** A level with the number of people on it — what the screen needs per row. */
export interface AccessLevelWithCount extends AccessLevel {
  members: number;
}

export async function listAccessLevels(
  tx: Tx,
  tenantId: string,
): Promise<AccessLevelWithCount[]> {
  const rows = await tx
    .select({
      level: schema.accessLevels,
      // A correlated count rather than a GROUP BY, so a level nobody is on
      // still returns its row — that is the level somebody is about to use.
      members: sql<number>`(
        select count(*)::int from ${schema.memberships} m
         where m.tenant_id = ${schema.accessLevels.tenantId}
           and m.access_level_id = ${schema.accessLevels.id}
      )`,
    })
    .from(schema.accessLevels)
    .where(eq(schema.accessLevels.tenantId, tenantId))
    .orderBy(asc(schema.accessLevels.name));
  return rows.map((r) => ({ ...r.level, members: r.members }));
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > 60) {
    throw new AccessError("INVALID_NAME", "Give the level a name, up to 60 characters.");
  }
  return trimmed;
}

/**
 * **NAME UNIQUENESS IS ENFORCED HERE, NOT BY AN INDEX**, the same choice
 * `enterprises` makes and for the same reason: two rows an owner named the
 * same thing deserve a sentence, not a constraint violation. Case-insensitive,
 * because "Field crew" and "Field Crew" are one job.
 */
async function assertNameFree(
  tx: Tx,
  tenantId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const rows = await tx
    .select({ id: schema.accessLevels.id, name: schema.accessLevels.name })
    .from(schema.accessLevels)
    .where(eq(schema.accessLevels.tenantId, tenantId));
  const clash = rows.find(
    (r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) {
    throw new AccessError("NAME_TAKEN", `You already have a level called ${clash.name}.`);
  }
}

export async function createAccessLevel(
  tx: Tx,
  tenantId: string,
  input: { name: string; notes?: string; denied?: string[] },
): Promise<AccessLevel> {
  const name = cleanName(input.name);
  await assertNameFree(tx, tenantId, name);
  const [row] = await tx
    .insert(schema.accessLevels)
    .values({
      tenantId,
      name,
      notes: input.notes?.trim() ?? "",
      denied: normaliseDenied(input.denied ?? []),
    })
    .returning();
  return row;
}

export async function updateAccessLevel(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: { name?: string; notes?: string; denied?: string[] },
): Promise<AccessLevel> {
  const existing = await tx.query.accessLevels.findFirst({
    where: and(
      eq(schema.accessLevels.tenantId, tenantId),
      eq(schema.accessLevels.id, id),
    ),
  });
  if (!existing) throw new AccessError("NOT_FOUND", "That level no longer exists.");
  const name = patch.name === undefined ? existing.name : cleanName(patch.name);
  if (name.toLowerCase() !== existing.name.toLowerCase()) {
    await assertNameFree(tx, tenantId, name, id);
  }
  const [row] = await tx
    .update(schema.accessLevels)
    .set({
      name,
      notes: patch.notes?.trim() ?? existing.notes,
      // `??` and not a length check: an empty list is a real answer — it means
      // "this level takes nothing away" — and must be storable.
      denied: normaliseDenied(patch.denied ?? existing.denied),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.accessLevels.tenantId, tenantId), eq(schema.accessLevels.id, id)),
    )
    .returning();
  if (!row) throw new AccessError("NOT_FOUND", "That level no longer exists.");
  return row;
}

/**
 * Delete a level.
 *
 * **REFUSED WHILE ANYBODY IS ON IT**, checked here and refused again by the
 * composite foreign key underneath (NO ACTION, `drizzle/0384`). The reason is
 * the one direction this feature must never fail in: null means unrestricted,
 * so a delete that cascaded to null would quietly hand everybody on the level
 * the run of the workspace. Better a sentence naming how many people to move
 * first.
 */
export async function deleteAccessLevel(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<void> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.accessLevelId, id),
      ),
    );
  if (n > 0) {
    throw new AccessError(
      "IN_USE",
      `${n} ${n === 1 ? "person is" : "people are"} on this level. Move them to another one first.`,
    );
  }
  const rows = await tx
    .delete(schema.accessLevels)
    .where(
      and(eq(schema.accessLevels.tenantId, tenantId), eq(schema.accessLevels.id, id)),
    )
    .returning({ id: schema.accessLevels.id });
  if (rows.length === 0) {
    throw new AccessError("NOT_FOUND", "That level no longer exists.");
  }
}

/**
 * Put somebody on a level and say which companies they may see — in ONE write,
 * because they are one decision about one person and two writers to a
 * capability row is how a codebase acquires a privilege bug nobody can
 * reproduce.
 *
 * `levelId: null` is no level; `entityIds: []` is every company. Both are the
 * unrestricted value, and both are what every membership reads as today.
 *
 * **AN OWNER CANNOT BE PUT ON ONE.** Refused here with a sentence, and refused
 * again by `memberships_member_update` (`drizzle/0085`, narrowed by `0385`),
 * which gives tenant context no UPDATE at all on a row whose role is `owner`.
 * The app-layer check exists so the person gets an explanation rather than a
 * failed transaction.
 */
export async function setMemberAccess(
  tx: Tx,
  tenantId: string,
  membershipId: string,
  input: { levelId: string | null; entityIds: string[] },
): Promise<void> {
  const { levelId, entityIds } = input;
  const member = await tx.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.tenantId, tenantId),
      eq(schema.memberships.id, membershipId),
    ),
  });
  if (!member) throw new AccessError("NOT_FOUND", "That member no longer exists.");
  if (member.role === "owner") {
    throw new AccessError(
      "NOT_FOUND",
      "Owners reach everything. Make them staff first if you want to limit them.",
    );
  }
  if (levelId !== null) {
    const level = await tx.query.accessLevels.findFirst({
      where: and(
        eq(schema.accessLevels.tenantId, tenantId),
        eq(schema.accessLevels.id, levelId),
      ),
    });
    if (!level) throw new AccessError("NOT_FOUND", "That level no longer exists.");
  }
  /**
   * WHICH COMPANIES, CHECKED AGAINST THIS TENANT'S OWN (ADR 0094).
   *
   * The composite FK that guards `access_level_id` has no equivalent for an
   * array, so the check is here — and it is not decoration: a uuid from
   * somewhere else would be a company nobody can name, sitting in a list an
   * owner thinks they understand. Read under the caller's tx, so it is the
   * companies THEY can see, and an owner can see all of them.
   */
  if (entityIds.length > 0) {
    const theirs = await tx
      .select({ id: schema.entities.id })
      .from(schema.entities)
      .where(eq(schema.entities.tenantId, tenantId));
    const known = new Set(theirs.map((e) => e.id));
    const stranger = entityIds.find((id) => !known.has(id));
    if (stranger) {
      throw new AccessError("NOT_FOUND", "One of those companies no longer exists.");
    }
  }
  await tx
    .update(schema.memberships)
    .set({ accessLevelId: levelId, entityIds: [...new Set(entityIds)].sort() })
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.id, membershipId),
      ),
    );
}
