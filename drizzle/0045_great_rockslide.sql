DROP INDEX "mail_links_unique_idx";--> statement-breakpoint
ALTER TABLE "mail_annotations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_links" ADD COLUMN "mail_account_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_links_unique_idx" ON "mail_links" USING btree ("tenant_id","mail_account_id","thread_id","entity_type","entity_id");