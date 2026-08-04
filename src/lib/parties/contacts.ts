import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Party, PartyContactKind, PartyContactPoint } from "@/db/schema";
import { PartyError } from "./errors";
import { normalizeContactValue, preferredContact } from "./contact-values";

/**
 * Contact points — part of the party subsystem, and subject to all three of its
 * rules (see `index.ts`): every function takes the CALLER'S `tx`, `tenantId` is
 * explicit in every WHERE clause, and nothing here checks module entitlement
 * because an accounting-only tenant has contact points too.
 *
 * `normalized_value` is written ONLY here, by `normalizeContactValue`. Nothing
 * else in the codebase may compute it — that is what keeps the value a matcher
 * can trust, and the backfill migration (0074) mirrors the same rules with the
 * correspondence written out line by line.
 */

export async function listContactPoints(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<PartyContactPoint[]> {
  return tx.query.partyContactPoints.findMany({
    where: and(
      eq(schema.partyContactPoints.tenantId, tenantId),
      eq(schema.partyContactPoints.partyId, partyId),
    ),
    // Primary first within a kind, then oldest first, so the list does not
    // reshuffle when somebody edits a label.
    orderBy: [
      asc(schema.partyContactPoints.kind),
      sql`${schema.partyContactPoints.isPrimary} desc`,
      asc(schema.partyContactPoints.createdAt),
    ],
  });
}

/** For several parties at once — the list view, and the composer's picker. */
export async function listContactPointsFor(
  tx: Tx,
  tenantId: string,
  partyIds: readonly string[],
): Promise<Map<string, PartyContactPoint[]>> {
  if (partyIds.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.partyContactPoints)
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        inArray(schema.partyContactPoints.partyId, [...partyIds]),
      ),
    );

  const byParty = new Map<string, PartyContactPoint[]>();
  for (const row of rows) {
    const list = byParty.get(row.partyId);
    if (list) list.push(row);
    else byParty.set(row.partyId, [row]);
  }
  return byParty;
}

export interface ContactPointInput {
  kind: PartyContactKind;
  value: string;
  label?: string;
  isPrimary?: boolean;
}

/**
 * Add a way of reaching a party.
 *
 * THE FIRST OF A KIND IS AUTOMATICALLY PRIMARY. Nobody thinks to mark a primary
 * when there is only one, and a record whose single email is unflagged would
 * otherwise rely on `preferredContact`'s fallback to be reachable at all.
 * Making it explicit means the stored data says what is true.
 *
 * Adding a value the party already has is a NO-OP rather than an error — the
 * unique index catches it, and somebody re-entering an address they already
 * recorded has not done anything wrong.
 */
export async function addContactPoint(
  tx: Tx,
  tenantId: string,
  partyId: string,
  input: ContactPointInput,
): Promise<PartyContactPoint | null> {
  const normalized = normalizeContactValue(input.kind, input.value);
  if (!normalized) {
    throw new PartyError("CONTACT_VALUE_INVALID", `not a usable ${input.kind}`);
  }

  const existing = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.partyContactPoints)
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.partyId, partyId),
        eq(schema.partyContactPoints.kind, input.kind),
      ),
    );
  const isFirst = (existing[0]?.n ?? 0) === 0;
  const wantPrimary = input.isPrimary ?? isFirst;

  // Demote the incumbent BEFORE inserting: the partial unique allows exactly
  // one primary per (party, kind), so inserting first would trip it.
  if (wantPrimary && !isFirst) {
    await clearPrimary(tx, tenantId, partyId, input.kind);
  }

  const rows = await tx
    .insert(schema.partyContactPoints)
    .values({
      tenantId,
      partyId,
      kind: input.kind,
      label: (input.label ?? "").trim(),
      value: normalized.value,
      normalizedValue: normalized.normalizedValue,
      isPrimary: wantPrimary,
    })
    .onConflictDoNothing()
    .returning();

  return rows[0] ?? null;
}

async function clearPrimary(
  tx: Tx,
  tenantId: string,
  partyId: string,
  kind: PartyContactKind,
  exceptId?: string,
): Promise<void> {
  await tx
    .update(schema.partyContactPoints)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.partyId, partyId),
        eq(schema.partyContactPoints.kind, kind),
        eq(schema.partyContactPoints.isPrimary, true),
        ...(exceptId ? [ne(schema.partyContactPoints.id, exceptId)] : []),
      ),
    );
}

export async function updateContactPoint(
  tx: Tx,
  tenantId: string,
  args: {
    contactPointId: string;
    expectedVersion: number;
    patch: { value?: string; label?: string };
  },
): Promise<PartyContactPoint> {
  const current = await tx.query.partyContactPoints.findFirst({
    where: and(
      eq(schema.partyContactPoints.tenantId, tenantId),
      eq(schema.partyContactPoints.id, args.contactPointId),
    ),
  });
  if (!current) {
    throw new PartyError("CONTACT_POINT_NOT_FOUND", "contact point missing");
  }

  let value: string | undefined;
  let normalizedValue: string | undefined;
  if (args.patch.value !== undefined) {
    // Re-normalized on every edit, never carried over. A value and a stale
    // normalization of a different value is the one state that would make
    // matching lie.
    const normalized = normalizeContactValue(current.kind, args.patch.value);
    if (!normalized) {
      throw new PartyError("CONTACT_VALUE_INVALID", `not a usable ${current.kind}`);
    }
    value = normalized.value;
    normalizedValue = normalized.normalizedValue;
  }

  const rows = await tx
    .update(schema.partyContactPoints)
    .set({
      ...(value !== undefined ? { value, normalizedValue } : {}),
      ...(args.patch.label !== undefined ? { label: args.patch.label.trim() } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.id, args.contactPointId),
        eq(schema.partyContactPoints.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new PartyError("STALE_VERSION", "contact point changed since loaded");
  }
  return rows[0];
}

export async function setPrimaryContactPoint(
  tx: Tx,
  tenantId: string,
  contactPointId: string,
): Promise<void> {
  const target = await tx.query.partyContactPoints.findFirst({
    where: and(
      eq(schema.partyContactPoints.tenantId, tenantId),
      eq(schema.partyContactPoints.id, contactPointId),
    ),
  });
  if (!target) {
    throw new PartyError("CONTACT_POINT_NOT_FOUND", "contact point missing");
  }

  await clearPrimary(tx, tenantId, target.partyId, target.kind, contactPointId);
  await tx
    .update(schema.partyContactPoints)
    .set({ isPrimary: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.id, contactPointId),
      ),
    );
}

/**
 * Remove one.
 *
 * If it was the primary, the oldest survivor of that kind is promoted —
 * otherwise deleting the flagged address would leave a party with three emails
 * and no main one, which reads as a bug to everybody who sees it afterwards.
 */
export async function deleteContactPoint(
  tx: Tx,
  tenantId: string,
  contactPointId: string,
): Promise<void> {
  const rows = await tx
    .delete(schema.partyContactPoints)
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.id, contactPointId),
      ),
    )
    .returning();
  const removed = rows[0];
  if (!removed) {
    throw new PartyError("CONTACT_POINT_NOT_FOUND", "contact point missing");
  }
  if (!removed.isPrimary) return;

  const [next] = await tx
    .select({ id: schema.partyContactPoints.id })
    .from(schema.partyContactPoints)
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.partyId, removed.partyId),
        eq(schema.partyContactPoints.kind, removed.kind),
      ),
    )
    .orderBy(asc(schema.partyContactPoints.createdAt))
    .limit(1);
  if (next) {
    await tx
      .update(schema.partyContactPoints)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.partyContactPoints.tenantId, tenantId),
          eq(schema.partyContactPoints.id, next.id),
        ),
      );
  }
}

/**
 * Set the ONE address of a kind that a single-field form shows — the primary,
 * or the only one there is.
 *
 * THIS IS DIRECT MANIPULATION, NOT A SYNC, and the difference is the whole
 * reason the accounting columns could be retired. While `customers.email` and
 * `party_contact_points` both existed, the accounting field was a MIRROR of a
 * different store, and a mirror cannot tell "the invoice should go elsewhere"
 * from "we no longer have this address" — so that sync was additive, and
 * clearing the field deliberately removed nothing. The field now IS a contact
 * point: it renders `preferredContact(points, kind)` and writes back to the
 * same row. Every edit therefore means what it appears to mean, including the
 * empty one. A box that silently discards what somebody typed is the bug the
 * additive rule would now cause rather than prevent.
 *
 * The four cases, and why each is what it is:
 *
 *  - `undefined` — the caller did not mention this kind. Left alone. Not the
 *    same as an empty string, and `updateCustomer` takes a partial patch where
 *    exactly that distinction is how "name only" edits work.
 *  - empty — cleared. Deletes the point the form was showing, and nothing else:
 *    a second email a colleague added is a different row and survives, then
 *    inherits primary through `deleteContactPoint`.
 *  - a value that normalizes to what is already stored — the typed form is
 *    re-recorded if it changed and skipped entirely if it did not, so an edit
 *    that only touched the name burns no version.
 *  - anything else — the stored point is edited IN PLACE rather than added
 *    alongside. Correcting a typo in an address is one address, not two.
 *
 * AN UNUSABLE VALUE CONTRIBUTES NOTHING AND RAISES NOTHING, which is inherited
 * from the sync this replaced: half an email address is not a reason to fail
 * the invoice-side save it arrived with. It does not clear either — refusing to
 * store "bob@" must not be a way to lose the address that was there.
 */
export async function setPreferredContactValue(
  tx: Tx,
  tenantId: string,
  partyId: string,
  kind: PartyContactKind,
  raw: string | null | undefined,
  opts: { label?: string } = {},
): Promise<void> {
  if (raw === undefined) return;

  const points = await listContactPoints(tx, tenantId, partyId);
  // The same helper the form's initial value comes from, so the row this writes
  // is provably the row the person was looking at.
  const current = preferredContact(points, kind);
  const wanted = (raw ?? "").trim();

  if (wanted.length === 0) {
    if (current) await deleteContactPoint(tx, tenantId, current.id);
    return;
  }

  const normalized = normalizeContactValue(kind, wanted);
  if (!normalized) return;

  if (!current) {
    await addContactPoint(tx, tenantId, partyId, {
      kind,
      value: wanted,
      label: opts.label,
    });
    return;
  }

  if (current.normalizedValue === normalized.normalizedValue) {
    if (current.value === normalized.value) return;
  } else {
    // The address they typed may already be on this party as a NON-primary
    // point — a work address being promoted to the billing one. Editing the
    // primary to match it would trip the (tenant, party, kind, normalized)
    // unique, and the honest outcome is not an error: the address they asked
    // for becomes the main one, and the party keeps both.
    const existing = points.find(
      (p) =>
        p.kind === kind &&
        p.id !== current.id &&
        p.normalizedValue === normalized.normalizedValue,
    );
    if (existing) {
      await setPrimaryContactPoint(tx, tenantId, existing.id);
      return;
    }
  }

  await updateContactPoint(tx, tenantId, {
    contactPointId: current.id,
    expectedVersion: current.version,
    patch: { value: normalized.value },
  });
}

/* -- Matching ------------------------------------------------------------- */

export interface ContactMatch {
  party: Party;
  contactPoint: PartyContactPoint;
}

/**
 * Which parties already have this way of being reached?
 *
 * THE DUPLICATE CHECK, and the reason `normalized_value` exists. Takes the
 * caller's `tx`, so it can only ever find parties the person asking may already
 * see — a lookup that reached into another tenant would be a way to discover
 * whether a competitor is a client of ours by typing their email, which is
 * exactly the shape of leak S12 exists to prevent.
 *
 * Returns nothing for an unusable value rather than throwing: this runs while
 * somebody is still typing, and a half-finished address is not an error.
 */
export async function findPartiesByContact(
  tx: Tx,
  tenantId: string,
  kind: PartyContactKind,
  rawValue: string,
  opts: { excludePartyId?: string } = {},
): Promise<ContactMatch[]> {
  const normalized = normalizeContactValue(kind, rawValue);
  if (!normalized) return [];

  const rows = await tx
    .select({ party: schema.parties, contactPoint: schema.partyContactPoints })
    .from(schema.partyContactPoints)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.partyContactPoints.tenantId),
        eq(schema.parties.id, schema.partyContactPoints.partyId),
      ),
    )
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.kind, kind),
        eq(schema.partyContactPoints.normalizedValue, normalized.normalizedValue),
        ...(opts.excludePartyId
          ? [ne(schema.partyContactPoints.partyId, opts.excludePartyId)]
          : []),
      ),
    )
    .limit(10);

  return rows;
}

/**
 * Reachable parties matching a name or address — what the mail composer offers.
 *
 * Only parties that HAVE an address of the wanted kind: a suggestion nobody can
 * be reached at cannot be picked, so offering it would be worse than absent.
 */
export async function searchReachableParties(
  tx: Tx,
  tenantId: string,
  kind: PartyContactKind,
  query: string,
  limit: number,
): Promise<ContactMatch[]> {
  const term = query.trim();
  if (term.length === 0) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  return tx
    .select({ party: schema.parties, contactPoint: schema.partyContactPoints })
    .from(schema.partyContactPoints)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.partyContactPoints.tenantId),
        eq(schema.parties.id, schema.partyContactPoints.partyId),
      ),
    )
    .where(
      and(
        eq(schema.partyContactPoints.tenantId, tenantId),
        eq(schema.partyContactPoints.kind, kind),
        sql`(${schema.parties.displayName} ilike ${like} or ${schema.partyContactPoints.value} ilike ${like})`,
      ),
    )
    // Primary first, so a party with three addresses leads with the right one.
    .orderBy(sql`${schema.partyContactPoints.isPrimary} desc`)
    .limit(limit);
}
