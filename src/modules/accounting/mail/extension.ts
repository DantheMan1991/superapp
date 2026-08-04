import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  LinkableEntity,
  MailExtension,
  MailContactCandidate,
  MailExtensionCtx,
} from "@/lib/mail-extensions/types";
import { listContactPointsFor } from "@/lib/parties/contacts";
import { preferredContactValue } from "@/lib/parties/contact-values";
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

/**
 * Every listed party's main email, for the sublabels below.
 *
 * A CUSTOMER'S ADDRESS IS NOT A COLUMN ON `customers` ANY MORE (0075), so what
 * used to be `r.email` is now a second read against `party_contact_points` —
 * one batched query for the whole page of results rather than one per row.
 * Through the caller's `tx` like everything else here, so the addresses this
 * can see are the addresses that person can see.
 */
async function mainEmails(
  tx: Tx,
  tenantId: string,
  partyIds: readonly string[],
): Promise<Map<string, string>> {
  const byParty = await listContactPointsFor(tx, tenantId, partyIds);
  const out = new Map<string, string>();
  for (const [partyId, points] of byParty) {
    out.set(partyId, preferredContactValue(points, "email"));
  }
  return out;
}

/**
 * "This role row's party can be reached at something matching the query."
 *
 * Searching a role by address used to be `ilike(customers.email, …)`. The
 * addresses moved, so the predicate follows them. RLS applies inside this
 * subquery exactly as it does in the outer one — `party_contact_points` is
 * tenant-scoped — and the explicit `cp.tenant_id = <role>.tenant_id` is the
 * same belt-and-braces every other predicate in this file wears. Note this is
 * a POSITIVE existence test, so RLS removing rows can only ever narrow what is
 * found; the failure mode `crm_affiliations` documents (a NOT EXISTS that goes
 * true precisely because the caller cannot see the row) does not arise.
 */
function reachableAt(
  tenantIdColumn: AnyColumn,
  partyIdColumn: AnyColumn,
  like: string,
) {
  return sql`exists (
    select 1 from party_contact_points cp
     where cp.tenant_id = ${tenantIdColumn}
       and cp.party_id = ${partyIdColumn}
       and cp.value ilike ${like}
  )`;
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

  /**
   * What an invoice can fill into a mail template.
   *
   * Chosen for what somebody actually writes in a chasing email — the number
   * to quote, the amount, when it was due — rather than for completeness. A
   * field nobody puts in a sentence is a longer list to read past.
   */
  templateFields: [
    { key: "number", label: "Invoice number" },
    { key: "total", label: "Invoice total" },
    { key: "status", label: "Invoice status" },
    { key: "due_date", label: "Invoice due date" },
    { key: "customer_name", label: "Customer name on the invoice" },
  ],

  async templateValues(
    tx: Tx,
    ctx: MailExtensionCtx,
    entityId: string,
  ): Promise<Record<string, string> | null> {
    const [row] = await tx
      .select({
        number: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        totalCents: schema.invoices.totalCents,
        dueDate: schema.invoices.dueDate,
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
          eq(schema.invoices.id, entityId),
        ),
      );
    // Null for "not yours" and "not there" alike — see the seam's contract.
    if (!row) return null;

    // Formatted HERE, because Mail renders money and dates it does not
    // understand. `amount` is the same helper the picker's sublabel uses, so a
    // total quoted in an email and a total shown in the picker cannot disagree.
    return {
      number: row.number,
      total: amount(row.totalCents),
      status: row.status,
      due_date: row.dueDate ?? "",
      customer_name: row.customerName,
    };
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
        partyId: schema.customers.partyId,
        name: schema.customers.name,
        isActive: schema.customers.isActive,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          or(
            ilike(schema.customers.name, like),
            reachableAt(
              schema.customers.tenantId,
              schema.customers.partyId,
              like,
            ),
          ),
        ),
      )
      // Active first: an archived customer is rarely who somebody means, but
      // hiding them outright would break linking historical correspondence.
      .orderBy(desc(schema.customers.isActive), sql`lower(${schema.customers.name})`)
      .limit(limit);

    const email = await mainEmails(
      tx,
      ctx.tenantId,
      rows.map((r) => r.partyId),
    );

    return rows.map((r) => ({
      entityType: "customer",
      entityId: r.id,
      label: r.name,
      sublabel: [email.get(r.partyId), r.isActive ? null : "archived"]
        .filter(Boolean)
        .join(" · "),
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
        partyId: schema.customers.partyId,
        name: schema.customers.name,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          inArray(schema.customers.id, [...ids]),
        ),
      );

    const email = await mainEmails(
      tx,
      ctx.tenantId,
      rows.map((r) => r.partyId),
    );

    return rows.map((r) => ({
      entityType: "customer",
      entityId: r.id,
      label: r.name,
      sublabel: email.get(r.partyId) ?? "",
      href: `/dashboard/m/accounting/sales/customers`,
    }));
  },

  /**
   * A SECOND implementation of `templateFields`, and that is deliberate rather
   * than incidental. This dossier's own rule — learned the day three Migadu
   * assumptions turned out to be baked into supposedly shared code — is that
   * **a seam with one user is a seam that has never been tested.** Invoice and
   * customer exercise the two shapes that differ: a joined record whose values
   * are formatted, and a flat one whose values are not.
   */
  /**
   * `{{customer.email}}` SURVIVED THE COLUMN IT WAS NAMED AFTER, and keeping
   * the key was not optional. A template's placeholders are validated against
   * this array when it is saved, so renaming a key breaks every stored template
   * that used it — with no migration able to guess what the author meant. The
   * key names a question ("how do we reach this customer?"), the answer moved,
   * and only the answer moved.
   */
  templateFields: [
    { key: "name", label: "Customer name" },
    { key: "email", label: "Customer email" },
  ],

  async templateValues(
    tx: Tx,
    ctx: MailExtensionCtx,
    entityId: string,
  ): Promise<Record<string, string> | null> {
    const [row] = await tx
      .select({ name: schema.customers.name, partyId: schema.customers.partyId })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          eq(schema.customers.id, entityId),
        ),
      );
    if (!row) return null;
    const email = await mainEmails(tx, ctx.tenantId, [row.partyId]);
    // "" for a customer with no address, exactly as the empty column gave —
    // an unknown value pastes as nothing rather than as the word "null".
    return { name: row.name, email: email.get(row.partyId) ?? "" };
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
        partyId: schema.vendors.partyId,
        name: schema.vendors.name,
        isActive: schema.vendors.isActive,
      })
      .from(schema.vendors)
      .where(
        and(
          eq(schema.vendors.tenantId, ctx.tenantId),
          or(
            ilike(schema.vendors.name, like),
            reachableAt(schema.vendors.tenantId, schema.vendors.partyId, like),
          ),
        ),
      )
      .orderBy(desc(schema.vendors.isActive), sql`lower(${schema.vendors.name})`)
      .limit(limit);

    const email = await mainEmails(
      tx,
      ctx.tenantId,
      rows.map((r) => r.partyId),
    );

    return rows.map((r) => ({
      entityType: "vendor",
      entityId: r.id,
      label: r.name,
      sublabel: [email.get(r.partyId), r.isActive ? null : "archived"]
        .filter(Boolean)
        .join(" · "),
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
        partyId: schema.vendors.partyId,
        name: schema.vendors.name,
      })
      .from(schema.vendors)
      .where(
        and(
          eq(schema.vendors.tenantId, ctx.tenantId),
          inArray(schema.vendors.id, [...ids]),
        ),
      );

    const email = await mainEmails(
      tx,
      ctx.tenantId,
      rows.map((r) => r.partyId),
    );

    return rows.map((r) => ({
      entityType: "vendor",
      entityId: r.id,
      label: r.name,
      sublabel: email.get(r.partyId) ?? "",
      href: `/dashboard/m/accounting/purchases/vendors`,
    }));
  },
};

export const accountingMailExtension: MailExtension = {
  slug: "accounting",
  moduleSlug: "accounting",
  name: "Accounting",
  entityTypes: [invoiceEntity, billEntity, customerEntity, vendorEntity],
  contacts: { search: searchContacts },
};

/* -- People the composer can address ------------------------------------- */

/**
 * Customers and vendors as recipient suggestions.
 *
 * The addresses a business actually writes to are, overwhelmingly, the ones it
 * already invoices and pays. Offering them costs one query over tables the
 * caller can already read — and it means the contact seam ships with a REAL
 * implementation rather than waiting for the CRM it was designed for.
 *
 * Uses the CALLER'S transaction, so this is exactly the set of customers and
 * vendors that person may see. Nothing here filters on visibility.
 *
 * THIS OVERLAPS CRM'S SOURCE AND IS KEPT ANYWAY. Since 0075 both read the same
 * `party_contact_points` rows, so a customer with CRM installed is found twice
 * — and `rankContacts` collapses the two by lowercased address before anything
 * is shown, then keeps the sublabel of whichever source the registry lists
 * first. That is this one, so a business address reads "Customer" rather than
 * "Company", which is the more useful of the two true answers. Deleting this
 * source instead would leave an accounting-only tenant with no suggestions at
 * all, because an extension whose module is off contributes nothing.
 *
 * The join is to the ROLE row rather than to the party, which is what makes the
 * distinction possible: `name` is the customer's name as invoicing knows it,
 * and only parties the business actually invoices or pays are offered.
 */
async function searchContacts(
  tx: Tx,
  ctx: MailExtensionCtx,
  query: string,
  limit: number,
): Promise<MailContactCandidate[]> {
  const term = query.trim();
  if (term.length === 0) return [];
  const like = contains(term);

  // Two selects rather than a UNION: drizzle's union typing across differently
  // named columns costs more than it saves for six rows, and these run
  // concurrently inside the one transaction anyway.
  //
  // INNER JOIN, so a role row with no address is not offered — a suggestion
  // that does nothing when clicked is worse than absent, and that used to be
  // the `ne(email, "")` predicate. All of a party's addresses are offered
  // rather than only the primary, main one first, the same way CRM's source
  // does: a picker is where somebody chooses between them.
  const [customerRows, vendorRows] = await Promise.all([
    tx
      .select({
        name: schema.customers.name,
        email: schema.partyContactPoints.value,
      })
      .from(schema.customers)
      .innerJoin(
        schema.partyContactPoints,
        and(
          eq(schema.partyContactPoints.tenantId, schema.customers.tenantId),
          eq(schema.partyContactPoints.partyId, schema.customers.partyId),
          eq(schema.partyContactPoints.kind, "email"),
        ),
      )
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          sql`(${schema.customers.name} ilike ${like} or ${schema.partyContactPoints.value} ilike ${like})`,
        ),
      )
      .orderBy(desc(schema.partyContactPoints.isPrimary), asc(schema.customers.name))
      .limit(limit),
    tx
      .select({
        name: schema.vendors.name,
        email: schema.partyContactPoints.value,
      })
      .from(schema.vendors)
      .innerJoin(
        schema.partyContactPoints,
        and(
          eq(schema.partyContactPoints.tenantId, schema.vendors.tenantId),
          eq(schema.partyContactPoints.partyId, schema.vendors.partyId),
          eq(schema.partyContactPoints.kind, "email"),
        ),
      )
      .where(
        and(
          eq(schema.vendors.tenantId, ctx.tenantId),
          sql`(${schema.vendors.name} ilike ${like} or ${schema.partyContactPoints.value} ilike ${like})`,
        ),
      )
      .orderBy(desc(schema.partyContactPoints.isPrimary), asc(schema.vendors.name))
      .limit(limit),
  ]);

  return [
    ...customerRows.map((r) => ({
      email: r.email,
      name: r.name,
      // Says WHERE it came from. Two rows reading "Acme Ltd" with no other
      // difference is a choice nobody can make.
      sublabel: "Customer",
    })),
    ...vendorRows.map((r) => ({
      email: r.email,
      name: r.name,
      sublabel: "Vendor",
    })),
  ];
}
