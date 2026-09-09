ALTER TABLE "invoices" ADD COLUMN "is_opening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "is_opening" boolean DEFAULT false NOT NULL;