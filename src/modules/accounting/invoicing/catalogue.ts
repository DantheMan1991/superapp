import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  PaymentMethod,
  PaymentTerm,
  Product,
  SalesTaxRate,
} from "@/db/schema";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { codeFromName } from "./payment-method-code";

/**
 * The four reference lists: what the business sells, when it expects to be
 * paid, how the money arrived, and what tax it charges.
 *
 * All four follow the `customers.ts` shape — owner-gated writes, optimistic
 * `version` compare-and-increment, deactivate rather than delete. Deactivation
 * matters more here than elsewhere: a product, a term or a rate may be named on
 * historic records, and removing the row would rewrite what those records
 * meant.
 */

/* -- products ------------------------------------------------------------- */

export async function listProducts(
  tx: Tx,
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<Product[]> {
  return tx.query.products.findMany({
    where: opts.activeOnly
      ? and(eq(schema.products.tenantId, tenantId), eq(schema.products.isActive, true))
      : eq(schema.products.tenantId, tenantId),
    orderBy: asc(schema.products.name),
  });
}

export interface ProductInput {
  name: string;
  description?: string;
  kind?: "service" | "product";
  unitPriceCents?: number;
  incomeAccountId?: string | null;
  expenseAccountId?: string | null;
}

export async function createProduct(
  tx: Tx,
  ctx: LedgerCtx,
  input: ProductInput,
): Promise<Product> {
  requireOwnerRole(ctx);
  const rows = await tx
    .insert(schema.products)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description ?? "",
      kind: input.kind ?? "service",
      unitPriceCents: input.unitPriceCents ?? 0,
      incomeAccountId: input.incomeAccountId ?? null,
      expenseAccountId: input.expenseAccountId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("PRODUCT_NAME_TAKEN", "a saved item already has that name");
  }
  return rows[0];
}

export async function updateProduct(
  tx: Tx,
  ctx: LedgerCtx,
  args: { productId: string; expectedVersion: number; patch: ProductInput },
): Promise<Product> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.products)
    .set({
      name: args.patch.name,
      description: args.patch.description ?? "",
      kind: args.patch.kind ?? "service",
      unitPriceCents: args.patch.unitPriceCents ?? 0,
      incomeAccountId: args.patch.incomeAccountId ?? null,
      expenseAccountId: args.patch.expenseAccountId ?? null,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.products.tenantId, ctx.tenantId),
        eq(schema.products.id, args.productId),
        eq(schema.products.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "saved item changed since loaded");
  }
  return rows[0];
}

export async function setProductActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { productId: string; expectedVersion: number; active: boolean },
): Promise<Product> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.products)
    .set({
      isActive: args.active,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.products.tenantId, ctx.tenantId),
        eq(schema.products.id, args.productId),
        eq(schema.products.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "saved item changed since loaded");
  }
  return rows[0];
}

/* -- payment terms -------------------------------------------------------- */

export async function listPaymentTerms(
  tx: Tx,
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<PaymentTerm[]> {
  return tx.query.paymentTerms.findMany({
    where: opts.activeOnly
      ? and(
          eq(schema.paymentTerms.tenantId, tenantId),
          eq(schema.paymentTerms.isActive, true),
        )
      : eq(schema.paymentTerms.tenantId, tenantId),
    orderBy: asc(schema.paymentTerms.dueInDays),
  });
}

export async function createPaymentTerm(
  tx: Tx,
  ctx: LedgerCtx,
  input: { name: string; dueInDays: number },
): Promise<PaymentTerm> {
  requireOwnerRole(ctx);
  const rows = await tx
    .insert(schema.paymentTerms)
    .values({ tenantId: ctx.tenantId, name: input.name, dueInDays: input.dueInDays })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("TERM_NAME_TAKEN", "a term already has that name");
  }
  return rows[0];
}

/**
 * Make one term the default, clearing whichever held it.
 *
 * Two statements in the caller's transaction, and the order matters: the
 * partial unique index allows exactly one `is_default = true` per tenant, so
 * the clear must commit before the set within the same tx or the index rejects
 * the pair.
 */
export async function setDefaultPaymentTerm(
  tx: Tx,
  ctx: LedgerCtx,
  args: { termId: string },
): Promise<void> {
  requireOwnerRole(ctx);
  await tx
    .update(schema.paymentTerms)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.paymentTerms.tenantId, ctx.tenantId),
        eq(schema.paymentTerms.isDefault, true),
      ),
    );
  const rows = await tx
    .update(schema.paymentTerms)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.paymentTerms.tenantId, ctx.tenantId),
        eq(schema.paymentTerms.id, args.termId),
      ),
    )
    .returning({ id: schema.paymentTerms.id });
  if (rows.length === 0) {
    throw new LedgerError("TERM_NOT_FOUND", "no such term");
  }
}

export async function setPaymentTermActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { termId: string; expectedVersion: number; active: boolean },
): Promise<PaymentTerm> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.paymentTerms)
    .set({
      isActive: args.active,
      // Deactivating the default would leave a tenant with no default at all,
      // which the invoice form would read as "no terms". Clear the flag with it.
      ...(args.active ? {} : { isDefault: false }),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paymentTerms.tenantId, ctx.tenantId),
        eq(schema.paymentTerms.id, args.termId),
        eq(schema.paymentTerms.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "term changed since loaded");
  }
  return rows[0];
}

/* -- payment methods ------------------------------------------------------ */

export { codeFromName };

export async function listPaymentMethods(
  tx: Tx,
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<PaymentMethod[]> {
  return tx.query.paymentMethods.findMany({
    where: opts.activeOnly
      ? and(
          eq(schema.paymentMethods.tenantId, tenantId),
          eq(schema.paymentMethods.isActive, true),
        )
      : eq(schema.paymentMethods.tenantId, tenantId),
    orderBy: asc(schema.paymentMethods.sortOrder),
  });
}

export async function createPaymentMethod(
  tx: Tx,
  ctx: LedgerCtx,
  input: { name: string },
): Promise<PaymentMethod> {
  requireOwnerRole(ctx);
  const code = codeFromName(input.name);
  if (code === "") {
    throw new LedgerError("PAYMENT_METHOD_INVALID", "give the method a name");
  }
  const existing = await listPaymentMethods(tx, ctx.tenantId);
  const rows = await tx
    .insert(schema.paymentMethods)
    .values({
      tenantId: ctx.tenantId,
      code,
      name: input.name.trim(),
      sortOrder: (existing.at(-1)?.sortOrder ?? 0) + 10,
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("PAYMENT_METHOD_TAKEN", "that method already exists");
  }
  return rows[0];
}

export async function renamePaymentMethod(
  tx: Tx,
  ctx: LedgerCtx,
  args: { methodId: string; expectedVersion: number; name: string },
): Promise<PaymentMethod> {
  requireOwnerRole(ctx);
  // The CODE is untouched — see codeFromName.
  const rows = await tx
    .update(schema.paymentMethods)
    .set({
      name: args.name.trim(),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paymentMethods.tenantId, ctx.tenantId),
        eq(schema.paymentMethods.id, args.methodId),
        eq(schema.paymentMethods.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "payment method changed since loaded");
  }
  return rows[0];
}

export async function setPaymentMethodActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { methodId: string; expectedVersion: number; active: boolean },
): Promise<PaymentMethod> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.paymentMethods)
    .set({
      isActive: args.active,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.paymentMethods.tenantId, ctx.tenantId),
        eq(schema.paymentMethods.id, args.methodId),
        eq(schema.paymentMethods.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "payment method changed since loaded");
  }
  return rows[0];
}

/* -- sales tax rates ------------------------------------------------------ */

export async function listSalesTaxRates(
  tx: Tx,
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<SalesTaxRate[]> {
  return tx.query.salesTaxRates.findMany({
    where: opts.activeOnly
      ? and(
          eq(schema.salesTaxRates.tenantId, tenantId),
          eq(schema.salesTaxRates.isActive, true),
        )
      : eq(schema.salesTaxRates.tenantId, tenantId),
    orderBy: asc(schema.salesTaxRates.name),
  });
}

export async function createSalesTaxRate(
  tx: Tx,
  ctx: LedgerCtx,
  input: { name: string; ratePpm: number },
): Promise<SalesTaxRate> {
  requireOwnerRole(ctx);
  const existing = await listSalesTaxRates(tx, ctx.tenantId);
  const rows = await tx
    .insert(schema.salesTaxRates)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      ratePpm: input.ratePpm,
      // The first rate a tenant creates becomes the default, because a list of
      // one with nothing selected is a control that does nothing. Later ones
      // do not, so adding a second rate never silently re-points the first.
      isDefault: existing.length === 0,
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("TAX_RATE_NAME_TAKEN", "a tax rate already has that name");
  }
  return rows[0];
}

/**
 * Rename a rate, or correct its number.
 *
 * CHANGING THE RATE DOES NOT TOUCH ANY EXISTING INVOICE. `invoices.tax_rate_ppm`
 * is a copy taken at write time, so a rate that goes from 7% to 7.25% applies
 * to what is written next and leaves every issued document — and every entry
 * posted from one — exactly as it was.
 */
export async function updateSalesTaxRate(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    rateId: string;
    expectedVersion: number;
    patch: { name: string; ratePpm: number };
  },
): Promise<SalesTaxRate> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.salesTaxRates)
    .set({
      name: args.patch.name,
      ratePpm: args.patch.ratePpm,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.salesTaxRates.tenantId, ctx.tenantId),
        eq(schema.salesTaxRates.id, args.rateId),
        eq(schema.salesTaxRates.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "tax rate changed since loaded");
  }
  return rows[0];
}

/** Clear-then-set in the caller's tx — the partial unique needs that order. */
export async function setDefaultSalesTaxRate(
  tx: Tx,
  ctx: LedgerCtx,
  args: { rateId: string },
): Promise<void> {
  requireOwnerRole(ctx);
  await tx
    .update(schema.salesTaxRates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.salesTaxRates.tenantId, ctx.tenantId),
        eq(schema.salesTaxRates.isDefault, true),
      ),
    );
  const rows = await tx
    .update(schema.salesTaxRates)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.salesTaxRates.tenantId, ctx.tenantId),
        eq(schema.salesTaxRates.id, args.rateId),
      ),
    )
    .returning({ id: schema.salesTaxRates.id });
  if (rows.length === 0) {
    throw new LedgerError("TAX_RATE_NOT_FOUND", "no such tax rate");
  }
}

export async function setSalesTaxRateActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { rateId: string; expectedVersion: number; active: boolean },
): Promise<SalesTaxRate> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.salesTaxRates)
    .set({
      isActive: args.active,
      // Same reason as a payment term: a deactivated default would leave the
      // invoice form offering a rate the owner has retired.
      ...(args.active ? {} : { isDefault: false }),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.salesTaxRates.tenantId, ctx.tenantId),
        eq(schema.salesTaxRates.id, args.rateId),
        eq(schema.salesTaxRates.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "tax rate changed since loaded");
  }
  return rows[0];
}
