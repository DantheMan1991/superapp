/**
 * The catalogue's payment terms, in a file of their own (2026-09-07) because
 * BOTH sides of the ledger point at them: `customers.payment_terms_id` in
 * invoicing.ts and `vendors.payment_terms_id` in payables.ts. invoicing.ts
 * already imports payables.ts, so a table both need has to sit below both
 * of them or the two files import each other. Same table, same name, same
 * migration history as when it lived in invoicing.ts (0116).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

/**
 * When payment is expected, as a named rule.
 *
 * `due_in_days` is the whole of the arithmetic: due date = issue date + N.
 * Deliberately no "net EOM" or "2/10 net 30" — early-payment discounts
 * change what is OWED, which is a posting question rather than a date
 * question, and inventing half of it would be worse than not having it.
 */
export const paymentTerms = pgTable(
  "payment_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueInDays: integer("due_in_days").notNull().default(0),
    /** The one offered first on a new invoice. At most one per tenant. */
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_terms_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("payment_terms_tenant_name_idx").on(t.tenantId, t.name),
    // At most one default, enforced by the database rather than by care.
    uniqueIndex("payment_terms_tenant_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault} = true`),
    check("payment_terms_due_in_days", sql`${t.dueInDays} between 0 and 365`),
  ],
);

export type PaymentTerm = typeof paymentTerms.$inferSelect;
