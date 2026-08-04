import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Customer } from "@/db/schema";
import { createPartyForRole, syncPartyName } from "@/lib/parties/role-sync";
import { setPreferredContactValue } from "@/lib/parties/contacts";
import { LedgerError, type LedgerCtx } from "../core";

/**
 * Customers: the tenant's OWN customers. Staff may manage these (P21).
 *
 * SINCE THE PARTY SPINE (CRM slice 0) this row is a ROLE, not an identity:
 * "a party we invoice". `parties` says who they are, and a business that is
 * both a customer and a vendor is one party holding two role rows. Every write
 * here goes through `@/lib/parties`, which is the single door onto that table —
 * this module does not INSERT or UPDATE `parties` itself.
 *
 * `email` AND `phone` ARE NOT COLUMNS ON THIS TABLE AND HAVE NOT BEEN SINCE
 * 0075. They are still part of `CustomerInput` because the customer form still
 * asks for them; they now land on `party_contact_points`, where the CRM and the
 * mail composer read the same rows. `address` and `notes` stay here — postal
 * addresses have no shared table yet, and that is recorded as deferred rather
 * than forgotten in docs/modules/crm.md.
 */

export async function listCustomers(tx: Tx, tenantId: string): Promise<Customer[]> {
  return tx.query.customers.findMany({
    where: eq(schema.customers.tenantId, tenantId),
    orderBy: asc(schema.customers.name),
  });
}

export async function loadCustomer(
  tx: Tx,
  tenantId: string,
  customerId: string,
): Promise<Customer> {
  const row = await tx.query.customers.findFirst({
    where: and(
      eq(schema.customers.tenantId, tenantId),
      eq(schema.customers.id, customerId),
    ),
  });
  if (!row) throw new LedgerError("CUSTOMER_NOT_FOUND", `customer ${customerId} missing`);
  return row;
}

export interface CustomerInput {
  name: string;
  /** Stored on the party, not here. Empty string clears; undefined leaves. */
  email?: string;
  /** Same. */
  phone?: string;
  address?: string;
  notes?: string;
}

/**
 * The two contact fields the customer form carries, written to the party.
 *
 * `billing` labels the email because that is what an AR address is; the phone
 * is `main`, matching what the 0074 backfill wrote, so a number recorded before
 * this slice and one recorded after are not distinguishable by label alone.
 */
async function writeCustomerContacts(
  tx: Tx,
  tenantId: string,
  partyId: string,
  input: Pick<CustomerInput, "email" | "phone">,
): Promise<void> {
  await setPreferredContactValue(tx, tenantId, partyId, "email", input.email, {
    label: "billing",
  });
  await setPreferredContactValue(tx, tenantId, partyId, "phone", input.phone, {
    label: "main",
  });
}

export async function createCustomer(
  tx: Tx,
  ctx: LedgerCtx,
  input: CustomerInput,
): Promise<Customer> {
  // The identity is born in the same transaction as the role, so a customer
  // without a party is not a state this code can reach. 0061's trigger is the
  // backstop for writers that predate this line, not a substitute for it.
  const party = await createPartyForRole(tx, ctx.tenantId, input.name);
  await writeCustomerContacts(tx, ctx.tenantId, party.id, input);
  const [row] = await tx
    .insert(schema.customers)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      name: input.name,
      address: input.address ?? "",
      notes: input.notes ?? "",
    })
    .returning();
  return row;
}

export async function updateCustomer(
  tx: Tx,
  ctx: LedgerCtx,
  args: { customerId: string; expectedVersion: number; patch: Partial<CustomerInput> },
): Promise<{ before: Customer; after: Customer }> {
  const before = await loadCustomer(tx, ctx.tenantId, args.customerId);
  const rows = await tx
    .update(schema.customers)
    .set({
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(args.patch.address !== undefined ? { address: args.patch.address } : {}),
      ...(args.patch.notes !== undefined ? { notes: args.patch.notes } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.customers.tenantId, ctx.tenantId),
        eq(schema.customers.id, args.customerId),
        eq(schema.customers.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "customer changed since loaded");
  }
  // Same transaction, so the two names cannot commit out of step. Without this
  // the first corrected spelling makes the invoice and the CRM disagree about
  // who the customer is.
  if (args.patch.name !== undefined) {
    await syncPartyName(tx, ctx.tenantId, rows[0].partyId, args.patch.name);
  }
  await writeCustomerContacts(tx, ctx.tenantId, rows[0].partyId, args.patch);
  return { before, after: rows[0] };
}

export async function setCustomerActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { customerId: string; expectedVersion: number; active: boolean },
): Promise<Customer> {
  const rows = await tx
    .update(schema.customers)
    .set({ isActive: args.active, version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.customers.tenantId, ctx.tenantId),
        eq(schema.customers.id, args.customerId),
        eq(schema.customers.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "customer changed since loaded");
  }
  return rows[0];
}
