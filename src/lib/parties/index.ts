import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Party, PartyKind } from "@/db/schema";
import { PartyError } from "./errors";
import { normalizeName, normalizeOptional, personDisplayName } from "./names";

/**
 * THE PARTY SUBSYSTEM — the single door onto `parties`.
 *
 * `parties` is written by Accounting today and by CRM tomorrow, which is the
 * whole reason this file is at `src/lib/` and not inside either module.
 * eslint.config.mjs states the general rule ("genuinely shared code moves to
 * src/lib/"), and the house pattern is older than that: `setDocumentTags` is
 * "the single door" onto `documents.tags`, the posting engine is the only
 * writer of ledger rows, `blob-stream.ts` is the only way a blob reaches a
 * browser. Two modules issuing their own UPDATEs against one table is how a
 * codebase acquires last-write-wins bugs nobody can reproduce.
 *
 * THREE PROPERTIES THAT ARE SECURITY OR CORRECTNESS, NOT STYLE:
 *
 *  1. **Every function takes the CALLER'S `tx`.** None of them opens a
 *     transaction, calls `withTenant`, or — above all — calls `withSystem`. The
 *     caller has already established the RLS context from a `requireTenant()`
 *     result, so what this subsystem can read and write is exactly what the
 *     person asking is allowed to. That is invariant S12 expressed as a
 *     function signature, and it is the same rule the mail extension contract
 *     turns on.
 *
 *  2. **`tenantId` is passed explicitly and appears in every WHERE clause**,
 *     belt-and-braces on top of RLS rather than instead of it. RLS has already
 *     removed other tenants' rows; these predicates stay because every other
 *     query in this codebase has them, and one that looked different would
 *     invite the next reader to wonder which style was load-bearing.
 *
 *  3. **THERE IS NO `requireModuleEnabled` CALL HERE AND THERE MUST NEVER BE
 *     ONE.** A tenant who bought Accounting and not CRM still has customers,
 *     and therefore still has parties. Gating this on the CRM module would
 *     break invoicing for every tenant who never bought CRM — which is the
 *     precise failure the shared-spine design exists to prevent. Entitlement is
 *     checked by the MODULE whose action is running, not by the shared record
 *     underneath it.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: contact details. There is no email,
 * phone or address on `parties` and adding one here as a convenience is the
 * mistake docs/modules/crm.md is written to prevent. Multi-value
 * `party_contact_points` / `party_addresses` are a later shared slice.
 */

export interface PartyInput {
  kind: PartyKind;
  /** Optional for a person when structured names are supplied; see below. */
  displayName?: string;
  givenName?: string | null;
  familyName?: string | null;
  legalName?: string | null;
}

export type PartyPatch = Partial<PartyInput>;

/**
 * Resolve the name to store, or throw.
 *
 * `displayName` wins whenever it is given. Composing it from the structured
 * names is a CREATE-TIME DEFAULT and nothing more — `updateParty` never
 * recomputes it, so a display name and the parts it was once built from drift
 * apart on purpose.
 */
function resolveDisplayName(input: PartyInput): string {
  const explicit = normalizeOptional(input.displayName);
  if (explicit) return explicit;

  if (input.kind === "person") {
    const composed = personDisplayName(input.givenName, input.familyName);
    if (composed) return composed;
  }

  throw new PartyError("PARTY_NAME_REQUIRED", "party needs a display name");
}

export async function createParty(
  tx: Tx,
  tenantId: string,
  input: PartyInput,
): Promise<Party> {
  const [row] = await tx
    .insert(schema.parties)
    .values({
      tenantId,
      kind: input.kind,
      displayName: resolveDisplayName(input),
      givenName: normalizeOptional(input.givenName),
      familyName: normalizeOptional(input.familyName),
      legalName: normalizeOptional(input.legalName),
    })
    .returning();
  return row;
}

export async function loadParty(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<Party> {
  const row = await tx.query.parties.findFirst({
    where: and(
      eq(schema.parties.tenantId, tenantId),
      eq(schema.parties.id, partyId),
    ),
  });
  if (!row) {
    throw new PartyError("PARTY_NOT_FOUND", `party ${partyId} missing`);
  }
  return row;
}

/**
 * Optimistic concurrency, the same shape `updateCustomer` uses: the version the
 * caller loaded is part of the WHERE clause, so a concurrent write makes this
 * match zero rows rather than silently overwrite. Two modules edit this table,
 * which makes the race real rather than theoretical.
 */
export async function updateParty(
  tx: Tx,
  tenantId: string,
  args: { partyId: string; expectedVersion: number; patch: PartyPatch },
): Promise<{ before: Party; after: Party }> {
  const before = await loadParty(tx, tenantId, args.partyId);
  const { patch } = args;

  // Validated BEFORE the write, not after. Throwing post-UPDATE would rely on
  // the caller's transaction rolling back to undo a row this function had
  // already agreed to store — correct today, and one refactor away from not.
  let nextDisplayName: string | undefined;
  if (patch.displayName !== undefined) {
    const normalized = normalizeName(patch.displayName);
    if (normalized.length === 0) {
      throw new PartyError("PARTY_NAME_REQUIRED", "party needs a display name");
    }
    nextDisplayName = normalized;
  }

  const rows = await tx
    .update(schema.parties)
    .set({
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(nextDisplayName !== undefined
        ? { displayName: nextDisplayName }
        : {}),
      ...(patch.givenName !== undefined
        ? { givenName: normalizeOptional(patch.givenName) }
        : {}),
      ...(patch.familyName !== undefined
        ? { familyName: normalizeOptional(patch.familyName) }
        : {}),
      ...(patch.legalName !== undefined
        ? { legalName: normalizeOptional(patch.legalName) }
        : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.parties.tenantId, tenantId),
        eq(schema.parties.id, args.partyId),
        eq(schema.parties.version, args.expectedVersion),
      ),
    )
    .returning();

  if (rows.length === 0) {
    throw new PartyError("STALE_VERSION", "party changed since loaded");
  }
  return { before, after: rows[0] };
}

export { PartyError, friendlyPartyMessage } from "./errors";
export type { PartyErrorCode } from "./errors";
export { normalizeName, normalizeOptional, personDisplayName } from "./names";
