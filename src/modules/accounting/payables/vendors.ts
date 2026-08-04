import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Vendor } from "@/db/schema";
import { createPartyForRole, syncPartyName } from "@/lib/parties/role-sync";
import { setPreferredContactValue } from "@/lib/parties/contacts";
import { LedgerError, type LedgerCtx } from "../core";

/**
 * Vendors mirror customers: duplicate names allowed, deactivate never
 * delete, staff-manageable. Plus a nullable default expense account —
 * AI-free prefill for this vendor's bill lines (P21).
 *
 * SINCE THE PARTY SPINE (CRM slice 0) this row is a ROLE — "a party we pay" —
 * and `parties` owns the identity. The mirror runs deeper than it used to: a
 * business that invoices us AND buys from us is now ONE party with a customer
 * row and a vendor row, which is the fact these two tables could never state.
 * All `parties` writes go through `@/lib/parties`, the single door.
 *
 * The mirror extends to contacts: `email` and `phone` left this table in 0075
 * and live on `party_contact_points`. See `customers.ts` for the reasoning,
 * which is the same reasoning — and note the consequence the shared spine
 * makes true, that the one business paid AND invoiced now has ONE main email
 * rather than two columns free to disagree.
 */

export async function loadVendor(
  tx: Tx,
  tenantId: string,
  vendorId: string,
): Promise<Vendor> {
  const row = await tx.query.vendors.findFirst({
    where: and(
      eq(schema.vendors.tenantId, tenantId),
      eq(schema.vendors.id, vendorId),
    ),
  });
  if (!row) throw new LedgerError("VENDOR_NOT_FOUND", `vendor ${vendorId} missing`);
  return row;
}

export async function listVendors(
  tx: Tx,
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Vendor[]> {
  return tx.query.vendors.findMany({
    where: and(
      eq(schema.vendors.tenantId, tenantId),
      ...(opts.includeInactive ? [] : [eq(schema.vendors.isActive, true)]),
    ),
    orderBy: asc(schema.vendors.name),
  });
}

export interface VendorInput {
  name: string;
  /** Stored on the party, not here. Empty string clears; undefined leaves. */
  email?: string;
  /** Same. */
  phone?: string;
  address?: string;
  notes?: string;
  defaultExpenseAccountId?: string | null;
}

/**
 * The vendor form's two contact fields, written to the party.
 *
 * `accounts` labels the email — an AP address is whoever sends the invoices —
 * and the phone is `main`, matching the 0074 backfill. Note the asymmetry with
 * `updateVendor`'s other fields: this takes `email`/`phone` exactly as given,
 * so `undefined` leaves the party's address alone rather than clearing it. The
 * update path passes `?? ""` on purpose; see the call site.
 */
async function writeVendorContacts(
  tx: Tx,
  tenantId: string,
  partyId: string,
  input: Pick<VendorInput, "email" | "phone">,
): Promise<void> {
  await setPreferredContactValue(tx, tenantId, partyId, "email", input.email, {
    label: "accounts",
  });
  await setPreferredContactValue(tx, tenantId, partyId, "phone", input.phone, {
    label: "main",
  });
}

async function assertDefaultAccount(
  tx: Tx,
  tenantId: string,
  accountId: string | null | undefined,
): Promise<void> {
  if (!accountId) return;
  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.id, accountId),
    ),
  });
  if (!account || !account.isActive) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "default expense account invalid");
  }
}

export async function createVendor(
  tx: Tx,
  ctx: LedgerCtx,
  input: VendorInput,
): Promise<Vendor> {
  await assertDefaultAccount(tx, ctx.tenantId, input.defaultExpenseAccountId);
  // Identity and role born in one transaction — see createCustomer.
  const party = await createPartyForRole(tx, ctx.tenantId, input.name);
  await writeVendorContacts(tx, ctx.tenantId, party.id, input);
  const [row] = await tx
    .insert(schema.vendors)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      name: input.name,
      address: input.address ?? "",
      notes: input.notes ?? "",
      defaultExpenseAccountId: input.defaultExpenseAccountId ?? null,
    })
    .returning();
  return row;
}

export async function updateVendor(
  tx: Tx,
  ctx: LedgerCtx,
  args: { vendorId: string; expectedVersion: number; patch: VendorInput },
): Promise<{ before: Vendor; after: Vendor }> {
  const before = await loadVendor(tx, ctx.tenantId, args.vendorId);
  await assertDefaultAccount(tx, ctx.tenantId, args.patch.defaultExpenseAccountId);
  const rows = await tx
    .update(schema.vendors)
    .set({
      name: args.patch.name,
      address: args.patch.address ?? "",
      notes: args.patch.notes ?? "",
      defaultExpenseAccountId: args.patch.defaultExpenseAccountId ?? null,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.vendors.tenantId, ctx.tenantId),
        eq(schema.vendors.id, args.vendorId),
        eq(schema.vendors.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "vendor changed since loaded");
  }
  // Same transaction, so the role's name and the party's cannot commit out of
  // step. `VendorInput.name` is required, so unlike the customer path there is
  // no "was it edited?" to test.
  await syncPartyName(tx, ctx.tenantId, rows[0].partyId, args.patch.name);
  // `?? ""` rather than passing through, because `VendorInput` is a WHOLE
  // record here rather than a patch — the dialog sends every field on every
  // save, so a missing email means the box was empty and the address is meant
  // to go. The customer path is a genuine partial and passes `undefined`
  // through untouched, which is the same distinction spelled two ways because
  // the two forms genuinely differ.
  await writeVendorContacts(tx, ctx.tenantId, rows[0].partyId, {
    email: args.patch.email ?? "",
    phone: args.patch.phone ?? "",
  });
  return { before, after: rows[0] };
}

/**
 * Deactivating a vendor does NOT deactivate the party, and that asymmetry is
 * deliberate: `is_active` here means "we no longer buy from them", while
 * `parties.is_active` would mean "we no longer deal with them at all". The same
 * business may well still be a live customer.
 */
export async function setVendorActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { vendorId: string; expectedVersion: number; isActive: boolean },
): Promise<Vendor> {
  await loadVendor(tx, ctx.tenantId, args.vendorId);
  const rows = await tx
    .update(schema.vendors)
    .set({
      isActive: args.isActive,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.vendors.tenantId, ctx.tenantId),
        eq(schema.vendors.id, args.vendorId),
        eq(schema.vendors.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "vendor changed since loaded");
  }
  return rows[0];
}
