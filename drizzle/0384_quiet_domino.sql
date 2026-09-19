CREATE TABLE "access_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"denied" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "access_level_id" uuid;--> statement-breakpoint
ALTER TABLE "access_levels" ADD CONSTRAINT "access_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_levels_tenant_id_id_idx" ON "access_levels" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "access_levels_tenant_idx" ON "access_levels" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_access_level_fk" FOREIGN KEY ("tenant_id","access_level_id") REFERENCES "public"."access_levels"("tenant_id","id") ON DELETE no action ON UPDATE no action;