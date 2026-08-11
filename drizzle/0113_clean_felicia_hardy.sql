ALTER TABLE "bank_rules" ADD COLUMN "set_vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_set_vendor_fk" FOREIGN KEY ("tenant_id","set_vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_vendor_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;