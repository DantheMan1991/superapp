import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { createVendor, listVendors } from "../payables/vendors";
import {
  descriptionNamesPayee,
  payeeCandidates,
  type PayeeCandidate,
} from "./rules-learn";

/**
 * The payees on a register that the business has no vendor for, and turning
 * them into vendors (onboarding slice 2b).
 *
 * THE SHAPE IS THE PASTE DIALOG'S, WITHOUT THE PASTE (ADR 0036): something
 * proposes rows, a person reads every one and unticks what is wrong, and the
 * module's own verb writes them. What differs is where the rows come from —
 * `bank_transactions` the business has already imported, rather than a list
 * somebody pasted — so there is no model call and nothing to review for
 * accuracy: the phrases are computed from the descriptions by
 * `payeeCandidates`, which is pure and tested on its own.
 *
 * A candidate that matches a vendor already on file is offered as a LINK
 * rather than a create, and comes back ticked for neither: naming rows is
 * useful, but doing it silently to a vendor somebody else set up is not.
 */

export interface RegisterPayee extends PayeeCandidate {
  /** The vendor already on file this looks like, or null. */
  existingVendorId: string | null;
  existingVendorName: string | null;
}

/** Lower case, one space between words, no surrounding punctuation. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The rows a payee proposal is computed from: everything on this register
 * that nobody has named a payee for yet.
 *
 * EXCLUDED ROWS ARE LEFT OUT. A row set aside as personal (ADR 0034) is
 * deliberately not the business's, so proposing a vendor for the grocer is
 * noise on exactly the register — the mixed one — where the list would
 * otherwise be longest.
 */
async function unnamedRows(tx: Tx, tenantId: string, bankAccountId: string) {
  return tx
    .select({
      id: schema.bankTransactions.id,
      description: schema.bankTransactions.description,
      amountCents: schema.bankTransactions.amountCents,
    })
    .from(schema.bankTransactions)
    .where(
      and(
        eq(schema.bankTransactions.tenantId, tenantId),
        eq(schema.bankTransactions.bankAccountId, bankAccountId),
        isNull(schema.bankTransactions.vendorId),
        ne(schema.bankTransactions.status, "excluded"),
      ),
    );
}

export async function listRegisterPayees(
  tx: Tx,
  tenantId: string,
  bankAccountId: string,
): Promise<RegisterPayee[]> {
  const rows = await unnamedRows(tx, tenantId, bankAccountId);
  const candidates = payeeCandidates(rows);
  if (candidates.length === 0) return [];

  const vendors = await listVendors(tx, tenantId, { includeInactive: true });
  const byName = vendors.map((v) => ({ ...v, normalized: normalizeName(v.name) }));
  return candidates.map((c) => {
    /**
     * The vendor's whole name appearing in the phrase, not the other way
     * round: "tractor supply 8821" is Tractor Supply, while a vendor called
     * "Tractor Supply Company" is a different, longer name and matching it
     * to a shorter phrase would be a guess.
     */
    const match = byName.find(
      (v) =>
        v.normalized.length > 0 &&
        ` ${c.phrase} `.includes(` ${v.normalized} `),
    );
    return {
      ...c,
      existingVendorId: match?.id ?? null,
      existingVendorName: match?.name ?? null,
    };
  });
}

export interface PayeePick {
  /** Which candidate. Verified against a freshly computed list. */
  phrase: string;
  /** The name to create, when there is no `vendorId`. */
  name?: string;
  /** Link to this vendor instead of creating one. */
  vendorId?: string;
}

export interface PayeesNamed {
  vendorsCreated: number;
  rowsNamed: number;
  /** What was created or linked, for the message. */
  names: string[];
}

/**
 * Create a vendor for each payee picked, and name every row it covers.
 *
 * THE CANDIDATES ARE RECOMPUTED HERE, and a phrase the fresh list does not
 * hold is skipped. The page's list can be minutes old — a sync may have
 * landed, or somebody may have set rows aside — and the rows a pick labels
 * must be the rows it was counted from, not whatever matches now. Same
 * reason `saveForTarget` re-reads a paste target's fields before it writes.
 *
 * ALL PICKS OR NONE: one transaction, and a vendor the module refuses stops
 * the lot. That is `createVendor`'s refusal, in its own words.
 */
export async function nameRegisterPayees(
  tx: Tx,
  ctx: LedgerCtx,
  args: { bankAccountId: string; picks: PayeePick[] },
): Promise<PayeesNamed> {
  requireOwnerRole(ctx);
  if (args.picks.length === 0) {
    throw new LedgerError("BANK_ACCOUNT_NOT_FOUND", "nothing picked");
  }
  const rows = await unnamedRows(tx, ctx.tenantId, args.bankAccountId);
  const known = new Set(payeeCandidates(rows).map((c) => c.phrase));

  let vendorsCreated = 0;
  let rowsNamed = 0;
  const names: string[] = [];

  for (const pick of args.picks) {
    if (!known.has(pick.phrase)) continue;
    let vendorId = pick.vendorId ?? null;
    let name = pick.name?.trim() ?? "";
    if (!vendorId) {
      if (!name) continue;
      // The module's own verb, so a pasted vendor, a typed one and one born
      // here are the same thing — party and all (ADR 0036's rule, applied).
      const vendor = await createVendor(tx, ctx, { name });
      vendorId = vendor.id;
      vendorsCreated += 1;
    } else {
      name =
        name ||
        (await tx.query.vendors.findFirst({
          where: and(
            eq(schema.vendors.tenantId, ctx.tenantId),
            eq(schema.vendors.id, vendorId),
          ),
          columns: { name: true },
        }))?.name ||
        "";
    }
    names.push(name);

    for (const row of rows) {
      if (!descriptionNamesPayee(row.description, pick.phrase)) continue;
      const updated = await tx
        .update(schema.bankTransactions)
        .set({ vendorId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.bankTransactions.tenantId, ctx.tenantId),
            eq(schema.bankTransactions.id, row.id),
            // Still unnamed: a rule may have named it since the read above.
            isNull(schema.bankTransactions.vendorId),
          ),
        )
        .returning({ id: schema.bankTransactions.id });
      rowsNamed += updated.length;
    }
  }

  return { vendorsCreated, rowsNamed, names };
}
