import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Customer } from "@/db/schema";
import { LedgerError, type LedgerCtx } from "../core";

/** Customers: the tenant's OWN customers. Staff may manage these (P21). */

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
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export async function createCustomer(
  tx: Tx,
  ctx: LedgerCtx,
  input: CustomerInput,
): Promise<Customer> {
  const [row] = await tx
    .insert(schema.customers)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      email: input.email ?? "",
      phone: input.phone ?? "",
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
      ...(args.patch.email !== undefined ? { email: args.patch.email } : {}),
      ...(args.patch.phone !== undefined ? { phone: args.patch.phone } : {}),
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
