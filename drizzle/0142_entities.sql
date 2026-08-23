-- entities: a tenant holds many legal entities, and the entity owns the books.
-- ADR 0010 (docs/decisions/0010-entities-inside-a-tenant.md), slice 1.
--
-- HAND-REORDERED AND HAND-EDITED. drizzle-kit generated three things this
-- cannot ship as written:
--
--  1. `ADD COLUMN entity_id uuid NOT NULL` on a table with rows. It has to
--     arrive NULLABLE, be backfilled, and take its NOT NULL in a LATER
--     migration — because migrations go out AHEAD of the deploy, and the
--     deploy that is running while this lands does not write the column. A
--     NOT NULL here rejects every invoice issued, bill approved and bank row
--     categorised in that window. Same expand/contract split `0123` made for
--     its `total = subtotal + tax` CHECK, for the same reason.
--  2. No backfill at all. Every existing entry belongs to the tenant's one
--     entity, and it has to say so before the foreign key is validated.
--  3. Ordering. The composite FK targets `entities_tenant_id_id_idx`, which is
--     created in this same migration, so the unique index must precede the
--     constraint. drizzle-kit emits every FK before every index.
--
-- `src/db/schema/ledger.ts` declares `entity_id` NOT NULL, which is one release
-- AHEAD of this database on purpose. The column comment there says so.
--
-- EVERY tenant gets an entity, not only those with journal entries, so
-- `defaultEntityId` can never come back empty for a tenant that is about to
-- post its first row. It is named after the tenant, which the single-entity
-- client never sees — the picker does not appear until there are two.
--
-- Every statement is guarded, so re-running this migration is a no-op.

CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_tenant_id_id_idx" ON "entities" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_tenant_name_idx" ON "entities" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "entities_tenant_idx" ON "entities" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_tenant_default_idx" ON "entities" USING btree ("tenant_id") WHERE "entities"."is_default";--> statement-breakpoint

-- One default entity per tenant, named after the tenant.
INSERT INTO "entities" ("tenant_id", "name", "is_default")
SELECT t."id", t."name", true
  FROM "tenants" t
 WHERE NOT EXISTS (
   SELECT 1 FROM "entities" e WHERE e."tenant_id" = t."id"
 );
--> statement-breakpoint

ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "entity_id" uuid;--> statement-breakpoint

-- Backfill BEFORE the constraint, so the FK validates rather than fails.
UPDATE "journal_entries" je
   SET "entity_id" = e."id"
  FROM "entities" e
 WHERE e."tenant_id" = je."tenant_id"
   AND e."is_default"
   AND je."entity_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_entity_date_idx" ON "journal_entries" USING btree ("tenant_id","entity_id","entry_date");
