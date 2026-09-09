CREATE TABLE "setup_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exchange_count" integer DEFAULT 0 NOT NULL,
	"last_turn_at" timestamp with time zone,
	"plan" jsonb,
	"started_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_interviews_state_check" CHECK ("setup_interviews"."state" in ('active', 'done'))
);
--> statement-breakpoint
ALTER TABLE "setup_interviews" ADD CONSTRAINT "setup_interviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "setup_interviews_tenant_id_idx" ON "setup_interviews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "setup_interviews_tenant_created_idx" ON "setup_interviews" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_interviews_one_active_idx" ON "setup_interviews" USING btree ("tenant_id") WHERE "setup_interviews"."state" = 'active';