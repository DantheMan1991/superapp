CREATE TYPE "public"."digest_preference" AS ENUM('daily', 'off');--> statement-breakpoint
CREATE TABLE "notification_digest_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"item_keys" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"digest" "digest_preference" DEFAULT 'daily' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_digest_log" ADD CONSTRAINT "notification_digest_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digest_log" ADD CONSTRAINT "notification_digest_log_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_log_person_day_idx" ON "notification_digest_log" USING btree ("tenant_id","profile_id","local_date");--> statement-breakpoint
CREATE INDEX "notification_digest_log_tenant_idx" ON "notification_digest_log" USING btree ("tenant_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_person_idx" ON "notification_preferences" USING btree ("tenant_id","profile_id");