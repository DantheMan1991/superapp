import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  LinkableEntity,
  MailExtension,
  MailExtensionCtx,
} from "@/lib/mail-extensions/types";
import { formatCents } from "../lib/money";

/**
 * What Accounting contributes to Mail: four things a conversation is usually
 * *about*.
 *
 * This file imports `@/lib/mail-extensions/types` and nothing else from outside
 * the accounting module. It does not import Mail, and Mail does not import it —
 * `src/lib/mail-extensions/registry.ts` is the only place the two are named
 * together. eslint.config.mjs enforces that.
 *
 * THE SECURITY PROPERTY, in one sentence: every function below takes the
 * caller's `tx` and adds `tenant_id` to its own WHERE clause, so it can only
 * ever find rows the person asking could already see. No `withTenant`, no
 * `withSystem`, no widening — invariant S12.
 *
 * The `tenant_id` predicates are belt-and-braces on top of RLS rather than the
 * control: RLS has already removed other tenants' rows. They stay because every
 * other query in this module has them, and a query in this file that looked
 * different would invite someone to wonder which style was load-bearing.
 */

/** One `%term%` fragment, bound as a parameter — never interpolated. */
function contains(term: string): string {
  // Escape LIKE's own wildcards so a customer searching for "50% deposit" is not
  // silently matching everything. `\` is the default escape character.
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Money on one line, the way the rest of the module writes it. */
function amount(cents: number): string {
  return `$${formatCents(cents)}`;
}

const invoiceEntity = {
  type: "invoice",
  label: "Invoice",
  pluralLabel: "Invoices",
  icon: "receipt",

  async search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]> {
    const like = contains(query);
    const rows = await tx
      .select({
        id: schema.invoices.id,
        number: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        totalCents: schema.invoices.totalCents,
        issueDate: schema.invoices.issueDate,
        customerName: schema.customers.name,
      })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        and(
          eq(schema.customers.tenantId, schema.invoices.tenantId),
          eq(schema.customers.id, schema.invoices.customerId),
        ),
      )
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenantId),
          // Number or customer name: the two things anyone actually remembers
          // about an invoice while looking at an email about it.
          or(
            ilike(schema.invoices.invoiceNumber, like),
            ilike(schema.customers.name, like),
          ),
        ),
      )
      .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      entityType: "invoice",
      entityId: r.id,
      label: `Invoice ${r.number}`,
      sublabel: `${r.customerName} · ${amount(r.totalCents)} · ${r.status}`,
      href: `/dashboard/m/accounting/sales/invoices/${r.id}`,
    }));
  },

  async resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.invoices.id,
        number: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        totalCents: schema.invoices.totalCents,
        customerName: schema.customers.name,
      })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        and(
          eq(schema.customers.tenantId, schema.invoices.tenantId),
          eq(schema.customers.id, schema.invoices.customerId),
        ),
      )
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenantId),
          inArray(schema.invoices.id, [...ids]),
        ),
      );

    return rows.map((r) => ({
      entityType: "invoice",
      entityId: r.id,
      label: `Invoice ${r.number}`,
      sublabel: `${r.customerName} · ${amount(r.totalCents)} · ${r.status}`,
      href: `/dashboard/m/accounting/sales/invoices/${r.id}`,
    }));
  },
};

const billEntity = {
  type: "bill",
  label: "Bill",
  pluralLabel: "Bills",
  icon: "file-text",

  async search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]> {
    const like = contains(query);
    const rows = await tx
      .select({
        id: schema.bills.id,
        number: schema.bills.billNumber,
        status: schema.bills.status,
        totalCents: schema.bills.totalCents,
        billDate: schema.bills.billDate,
        vendorName: schema.vendors.name,
      })
      .from(schema.bills)
      .innerJoin(
        schema.vendors,
        and(
          eq(schema.vendors.tenantId, schema.bills.tenantId),
          eq(schema.vendors.id, schema.bills.vendorId),
        ),
      )
      .where(
        and(
          eq(schema.bills.tenantId, ctx.tenantId),
          or(
            ilike(schema.bills.billNumber, like),
            ilike(schema.vendors.name, like),
          ),
        ),
      )
      .orderBy(desc(schema.bills.billDate), desc(schema.bills.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      entityType: "bill",
      entityId: r.id,
      // A bill carries the VENDOR'S number, which is often blank — the vendor
      // is the identifying fact, so it leads.
      label: r.number ? `${r.vendorName} · ${r.number}` : `Bill from ${r.vendorName}`,
      sublabel: `${amount(r.totalCents)} · ${r.status} · ${r.billDate}`,
      href: `/dashboard/m/accounting/purchases/bills/${r.id}`,
    }));
  },

  async resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.bills.id,
        number: schema.bills.billNumber,
        status: schema.bills.status,
        totalCents: schema.bills.totalCents,
        billDate: schema.bills.billDate,
        vendorName: schema.vendors.name,
      })
      .from(schema.bills)
      .innerJoin(
        schema.vendors,
        and(
          eq(schema.vendors.tenantId, schema.bills.tenantId),
          eq(schema.vendors.id, schema.bills.vendorId),
        ),
      )
      .where(
        and(
          eq(schema.bills.tenantId, ctx.tenantId),
          inArray(schema.bills.id, [...ids]),
        ),
      );

    return rows.map((r) => ({
      entityType: "bill",
      entityId: r.id,
      label: r.number ? `${r.vendorName} · ${r.number}` : `Bill from ${r.vendorName}`,
      sublabel: `${amount(r.totalCents)} · ${r.status} · ${r.billDate}`,
      href: `/dashboard/m/accounting/purchases/bills/${r.id}`,
    }));
  },
};

const customerEntity = {
  type: "customer",
  label: "Customer",
  pluralLabel: "Customers",
  icon: "user",

  async search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]> {
    const like = contains(query);
    const rows = await tx
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        isActive: schema.customers.isActive,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          or(
            ilike(schema.customers.name, like),
            ilike(schema.customers.email, like),
          ),
        ),
      )
      // Active first: an archived customer is rarely who somebody means, but
      // hiding them outright would break linking historical correspondence.
      .orderBy(desc(schema.customers.isActive), sql`lower(${schema.customers.name})`)
      .limit(limit);

    return rows.map((r) => ({
      entityType: "customer",
      entityId: r.id,
      label: r.name,
      sublabel: [r.email, r.isActive ? null : "archived"].filter(Boolean).join(" · "),
      href: `/dashboard/m/accounting/sales/customers`,
    }));
  },

  async resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          inArray(schema.customers.id, [...ids]),
        ),
      );

    return rows.map((r) => ({
      entityType: "customer",
      entityId: r.id,
      label: r.name,
      sublabel: r.email,
      href: `/dashboard/m/accounting/sales/customers`,
    }));
  },
};

const vendorEntity = {
  type: "vendor",
  label: "Vendor",
  pluralLabel: "Vendors",
  icon: "truck",

  async search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]> {
    const like = contains(query);
    const rows = await tx
      .select({
        id: schema.vendors.id,
        name: schema.vendors.name,
        email: schema.vendors.email,
        isActive: schema.vendors.isActive,
      })
      .from(schema.vendors)
      .where(
        and(
          eq(schema.vendors.tenantId, ctx.tenantId),
          or(ilike(schema.vendors.name, like), ilike(schema.vendors.email, like)),
        ),
      )
      .orderBy(desc(schema.vendors.isActive), sql`lower(${schema.vendors.name})`)
      .limit(limit);

    return rows.map((r) => ({
      entityType: "vendor",
      entityId: r.id,
      label: r.name,
      sublabel: [r.email, r.isActive ? null : "archived"].filter(Boolean).join(" · "),
      href: `/dashboard/m/accounting/purchases/vendors`,
    }));
  },

  async resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.vendors.id,
        name: schema.vendors.name,
        email: schema.vendors.email,
      })
      .from(schema.vendors)
      .where(
        and(
          eq(schema.vendors.tenantId, ctx.tenantId),
          inArray(schema.vendors.id, [...ids]),
        ),
      );

    return rows.map((r) => ({
      entityType: "vendor",
      entityId: r.id,
      label: r.name,
      sublabel: r.email,
      href: `/dashboard/m/accounting/purchases/vendors`,
    }));
  },
};

export const accountingMailExtension: MailExtension = {
  slug: "accounting",
  moduleSlug: "accounting",
  name: "Accounting",
  entityTypes: [invoiceEntity, billEntity, customerEntity, vendorEntity],
};
