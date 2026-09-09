import type { Tx } from "@/db";
import { normalizeName } from "@/lib/paste-targets/shape";
import {
  PasteRefusal,
  type PasteCtx,
  type PasteField,
  type PasteRow,
  type PasteSaved,
  type PasteTarget,
} from "@/lib/paste-targets/types";
import { friendlyMessage, LedgerError } from "../core/errors";
import { createCustomer, listCustomers } from "../invoicing/customers";
import { createVendor, listVendors } from "../payables/vendors";

/**
 * Vendors and customers as paste targets (ADR 0036): the two lists a business
 * moving in has on paper before anything else, and the two the plan says
 * "mostly make themselves" afterwards — a new name on a bill or an invoice
 * creates one. This is for the day before that, when the list is forty
 * suppliers in a spreadsheet.
 *
 * The same five fields for both, because a customer and a vendor are the same
 * shape on paper: who, how to reach them, where, and a note. Terms and the
 * default expense account are deliberately NOT here — a pasted list does not
 * carry them, and a guess at Net 30 would set every due date wrong.
 *
 * `save` is `createVendor` / `createCustomer` exactly as the forms call them:
 * a party is born in the same transaction (see those functions), so a pasted
 * vendor is indistinguishable from a typed one, and the CRM sees both.
 */

const PEOPLE_FIELDS: PasteField[] = [
  {
    key: "name",
    label: "Name",
    kind: "text",
    required: true,
    hint: "The name as the business knows them — a company or a person.",
  },
  { key: "email", label: "Email", kind: "text", hint: "An email address, if the list gives one." },
  { key: "phone", label: "Phone", kind: "text", hint: "A phone number, as written." },
  { key: "address", label: "Address", kind: "text", hint: "A postal address on one line, if given." },
  {
    key: "notes",
    label: "Notes",
    kind: "text",
    hint: "Anything else the list says about them — what they supply or buy, a contact's name.",
  },
];

const text = (v: PasteRow[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** The module's own words for its own refusal; anything else is a failure. */
function refusal(err: unknown): unknown {
  return err instanceof LedgerError ? new PasteRefusal(friendlyMessage(err)) : err;
}

/** Each row's name against the existing names, case and punctuation aside. */
function byName(existing: Array<{ name: string }>, rows: PasteRow[]): Array<string | null> {
  const known = new Map(existing.map((e) => [normalizeName(e.name), e.name]));
  return rows.map((row) => {
    const name = text(row.name);
    return name ? (known.get(normalizeName(name)) ?? null) : null;
  });
}

export const vendorsPasteTarget: PasteTarget = {
  slug: "accounting.vendors",
  moduleSlug: "accounting",
  label: "Vendors",
  noun: { one: "vendor", many: "vendors" },
  about: "vendors — the suppliers and service providers the business buys from",
  async describe() {
    return { fields: PEOPLE_FIELDS };
  },
  async duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]) {
    return byName(await listVendors(tx, ctx.tenantId, { includeInactive: true }), rows);
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    try {
      const vendor = await createVendor(tx, ctx, {
        name: text(row.name)!,
        email: text(row.email) ?? undefined,
        phone: text(row.phone) ?? undefined,
        address: text(row.address) ?? undefined,
        notes: text(row.notes) ?? undefined,
      });
      return { id: vendor.id, label: vendor.name };
    } catch (err) {
      throw refusal(err);
    }
  },
  revalidate: ["/dashboard/m/accounting/purchases/vendors", "/dashboard"],
};

export const customersPasteTarget: PasteTarget = {
  slug: "accounting.customers",
  moduleSlug: "accounting",
  label: "Customers",
  noun: { one: "customer", many: "customers" },
  about: "customers — the people and businesses this business bills or sells to",
  async describe() {
    return { fields: PEOPLE_FIELDS };
  },
  async duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]) {
    return byName(await listCustomers(tx, ctx.tenantId), rows);
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    try {
      const customer = await createCustomer(tx, ctx, {
        name: text(row.name)!,
        email: text(row.email) ?? undefined,
        phone: text(row.phone) ?? undefined,
        address: text(row.address) ?? undefined,
        notes: text(row.notes) ?? undefined,
      });
      return { id: customer.id, label: customer.name };
    } catch (err) {
      throw refusal(err);
    }
  },
  revalidate: ["/dashboard/m/accounting/sales/customers", "/dashboard"],
};
