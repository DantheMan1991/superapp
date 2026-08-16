-- entity_id on the DOCUMENTS: invoices, bills and bank accounts (ADR 0010).
--
-- Slice 1 put the company on the journal ENTRY, which made reports scopeable
-- but left every document posting into the tenant's default company. This is
-- what makes the ten-LLC landlord's books actually separable: an invoice, a
-- bill and a register each belong to one company, and every entry they post
-- follows the document rather than the default.
--
-- HAND-EDITED, exactly as `0142` was and for the same three reasons:
--
--  1. drizzle-kit emitted `ADD COLUMN … NOT NULL` on three populated tables.
--     They arrive NULLABLE and backfilled; `0146` closes them AFTER the deploy,
--     because migrations go out ahead of it and the running deploy does not
--     write these columns. A NOT NULL here rejects every invoice, bill and bank
--     account created in that window.
--  2. No backfill at all. Every existing document belongs to its tenant's one
--     company and has to say so before the foreign keys are validated.
--  3. Ordering: the FKs must follow the backfill, not precede it.
--
-- `entities_tenant_id_id_idx` already exists (`0142`), so the FK ordering trap
-- that bit that migration does not apply here — the target index is not created
-- in this transaction.
--
-- Every statement is guarded, so re-running is a no-op.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "entity_id" uuid;--> statement-breakpoint

-- Every existing document goes to its tenant's default company — which is its
-- only company, since nothing before this could create a second one's
-- documents. Backfilled from `entities`, not from the entries these documents
-- posted, because a DRAFT invoice has no entry yet and would be left behind.
UPDATE "invoices" i
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = i."tenant_id" AND e."is_default" AND i."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "bills" b
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = b."tenant_id" AND e."is_default" AND b."entity_id" IS NULL;
--> statement-breakpoint
UPDATE "bank_accounts" ba
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = ba."tenant_id" AND e."is_default" AND ba."entity_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_tenant_entity_idx" ON "invoices" USING btree ("tenant_id","entity_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_tenant_entity_idx" ON "bank_accounts" USING btree ("tenant_id","entity_id");--> statement-breakpoint
CREATE INDEX "bills_tenant_entity_idx" ON "bills" USING btree ("tenant_id","entity_id");
