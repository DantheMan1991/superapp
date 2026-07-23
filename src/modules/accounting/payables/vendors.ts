import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Vendor } from "@/db/schema";
import { LedgerError, type LedgerCtx } from "../core";

/**
 * Vendors mirror customers: duplicate names allowed, deactivate never
 * delete, staff-manageable. Plus a nullable default expense account —
 * AI-free prefill for this vendor's bill lines (P21).
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
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  defaultExpenseAccountId?: string | null;
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
  const [row] = await tx
    .insert(schema.vendors)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      email: input.email ?? "",
      phone: input.phone ?? "",
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
      email: args.patch.email ?? "",
      phone: args.patch.phone ?? "",
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
  return { before, after: rows[0] };
}

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
