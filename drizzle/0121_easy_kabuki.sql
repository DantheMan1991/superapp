-- Recurring invoices fold into recurring_entries: the schema half.
--
-- The kind enum is RECREATED rather than extended, and that is not stylistic.
-- Drizzle's migrator runs every pending migration inside ONE transaction, so
-- `ALTER TYPE ... ADD VALUE 'invoice'` followed by 0122's backfill — which
-- inserts that very value — trips Postgres' check_safe_enum_use:
--
--     unsafe use of new value "invoice" of enum type recurring_entry_kind
--     HINT: New enum values must be committed before they can be used.
--
-- A type CREATED in the current transaction is the documented exception: its
-- values are usable immediately, because there is no committed state anybody
-- could already be reading. So the type is built new, the column moved onto it
-- through text, the old one dropped and the new one renamed into its place.
-- Splitting the two migrations does not help — they still share a transaction,
-- and a fresh database (CI, a new environment) would hit this on its first run.
--
-- Both CHECKs that mention `kind` come off first and go back on after. A CHECK
-- expression is re-parsed against the new column type, so leaving one in place
-- fails with `operator does not exist: recurring_entry_kind_new =
-- recurring_entry_kind` — the old type name is still in the expression, and
-- still exists, until it is dropped two statements later.
ALTER TABLE "recurring_entries" DROP CONSTRAINT "recurring_entries_vendor_shape";--> statement-breakpoint
ALTER TABLE "recurring_entries" DROP CONSTRAINT "recurring_entries_auto_post_shape";--> statement-breakpoint
CREATE TYPE "public"."recurring_entry_kind_new" AS ENUM('journal', 'bill', 'invoice');--> statement-breakpoint
ALTER TABLE "recurring_entries" ALTER COLUMN "kind" TYPE "public"."recurring_entry_kind_new" USING "kind"::text::"public"."recurring_entry_kind_new";--> statement-breakpoint
DROP TYPE "public"."recurring_entry_kind";--> statement-breakpoint
ALTER TYPE "public"."recurring_entry_kind_new" RENAME TO "recurring_entry_kind";--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_auto_post_shape" CHECK ("recurring_entries"."auto_post" = false or "recurring_entries"."kind" = 'journal');--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recurring_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_entry_fk" FOREIGN KEY ("tenant_id","recurring_entry_id") REFERENCES "public"."recurring_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_party_shape" CHECK (("recurring_entries"."kind"::text = 'bill' and "recurring_entries"."vendor_id" is not null and "recurring_entries"."customer_id" is null)
       or ("recurring_entries"."kind"::text = 'invoice' and "recurring_entries"."customer_id" is not null and "recurring_entries"."vendor_id" is null)
       or ("recurring_entries"."kind"::text = 'journal' and "recurring_entries"."vendor_id" is null and "recurring_entries"."customer_id" is null));