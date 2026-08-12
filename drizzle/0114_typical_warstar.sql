ALTER TABLE "accounting_settings" ADD COLUMN "reminders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "reminder_offsets" jsonb DEFAULT '[-3,0,7,14,30]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reminders_muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reminders_muted" boolean DEFAULT false NOT NULL;