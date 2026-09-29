CREATE TYPE "public"."fitness_reminder_slot" AS ENUM('morning', 'evening');--> statement-breakpoint
CREATE TABLE "fitness_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"slot" "fitness_reminder_slot" NOT NULL,
	"at_minute" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_handled_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_reminders_at_minute_range" CHECK ("fitness_reminders"."at_minute" between 0 and 1430 and "fitness_reminders"."at_minute" % 10 = 0)
);
--> statement-breakpoint
ALTER TABLE "fitness_reminders" ADD CONSTRAINT "fitness_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_reminders" ADD CONSTRAINT "fitness_reminders_program_fk" FOREIGN KEY ("tenant_id","program_id") REFERENCES "public"."fitness_programs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_reminders_tenant_id_id_idx" ON "fitness_reminders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_reminders_program_slot_idx" ON "fitness_reminders" USING btree ("tenant_id","program_id","slot");