CREATE TABLE "production_run_carcasses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"run_input_id" uuid NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"head_count" integer DEFAULT 1 NOT NULL,
	"live_lb" numeric(18, 4),
	"hanging_lb" numeric(18, 4),
	"disposition" text DEFAULT 'passed' NOT NULL,
	"condemn_reason" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_carcasses_head_positive" CHECK ("production_run_carcasses"."head_count" > 0),
	CONSTRAINT "production_run_carcasses_live_positive" CHECK ("production_run_carcasses"."live_lb" is null or "production_run_carcasses"."live_lb" > 0),
	CONSTRAINT "production_run_carcasses_hanging_positive" CHECK ("production_run_carcasses"."hanging_lb" is null or "production_run_carcasses"."hanging_lb" > 0),
	CONSTRAINT "production_run_carcasses_disposition_valid" CHECK ("production_run_carcasses"."disposition" in ('passed', 'condemned')),
	CONSTRAINT "production_run_carcasses_condemned_unweighed" CHECK ("production_run_carcasses"."disposition" = 'passed' or "production_run_carcasses"."hanging_lb" is null),
	CONSTRAINT "production_run_carcasses_reason_when_condemned" CHECK ("production_run_carcasses"."disposition" = 'condemned' or length(btrim("production_run_carcasses"."condemn_reason")) = 0)
);
--> statement-breakpoint
ALTER TABLE "production_run_carcasses" ADD CONSTRAINT "production_run_carcasses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_carcasses" ADD CONSTRAINT "production_run_carcasses_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_carcasses" ADD CONSTRAINT "production_run_carcasses_input_fk" FOREIGN KEY ("tenant_id","run_input_id") REFERENCES "public"."production_run_inputs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_run_carcasses_tenant_id_id_idx" ON "production_run_carcasses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "production_run_carcasses_tenant_run_idx" ON "production_run_carcasses" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "production_run_carcasses_tenant_input_idx" ON "production_run_carcasses" USING btree ("tenant_id","run_input_id");