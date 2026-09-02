ALTER TABLE "recurring_entries" ADD COLUMN "last_error" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_entries" ADD COLUMN "last_error_at" timestamp with time zone;