import "server-only";
import { asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * READING THE DIMENSION REGISTRY, for anything that is not accounting.
 *
 * `dimension_members` is declared in `schema/ledger.ts` but is owned by nobody:
 * `src/lib/enterprises/` writes lines of business into it, and five packs sync
 * their own rows — `land` its parcels and zones, `assets` its assets,
 * `inventory` and `livestock` their lots. The P&L builds its "Split by" from
 * whatever types are present, which is how a farm gets a paddock report that
 * nobody wrote.
 *
 * THIS FILE EXISTS BECAUSE OF THE MODULE ISOLATION RULE. Accounting has its own
 * `listDimensionMembers`, and a second core module reaching for it would be one
 * module importing another — the thing `eslint.config.mjs` generates a rule per
 * module to prevent. Putting the shared read in `src/lib/` is the arrangement
 * `src/lib/parties/`, `src/lib/enterprises/` and `src/lib/work/` already use
 * for exactly this: a table more than one module needs gets a door in Layer 0,
 * not a cross-module import.
 *
 * The three properties those files document hold here too, and the first is the
 * one that matters: **this takes the CALLER'S `tx`.** It opens no transaction,
 * calls neither `withTenant` nor `withSystem`, so what it can see is exactly
 * what the caller's RLS context allows.
 *
 * Accounting keeps its own copy for now. Unifying them means touching the
 * ledger's hot path, which is not this slice's business.
 */

export interface DimensionMemberRow {
  id: string;
  dimensionType: string;
  displayName: string;
  isActive: boolean;
}

/**
 * Every dimension member in the tenant, active and retired alike.
 *
 * DOES NOT FILTER BY `is_active`, deliberately and in step with accounting's
 * reader: a record that already carries a retired member has to be able to show
 * it, or the tag becomes invisible and unremovable. `dimensionTypesFrom` in
 * `src/lib/dimension-options.ts` is where the filtering belongs, because it
 * takes `keepIds` for exactly that case.
 */
export async function listTenantDimensionMembers(
  tx: Tx,
  tenantId: string,
): Promise<DimensionMemberRow[]> {
  return await tx
    .select({
      id: schema.dimensionMembers.id,
      dimensionType: schema.dimensionMembers.dimensionType,
      displayName: schema.dimensionMembers.displayName,
      isActive: schema.dimensionMembers.isActive,
    })
    .from(schema.dimensionMembers)
    .where(eq(schema.dimensionMembers.tenantId, tenantId))
    .orderBy(
      asc(schema.dimensionMembers.dimensionType),
      asc(schema.dimensionMembers.displayName),
    );
}
