-- HAND-REORDERED, the same way drizzle/0325, 0329, 0333 and 0335 are, and for
-- the same reason: drizzle-kit emits every ADD CONSTRAINT before every CREATE
-- INDEX, which fails when two NEW tables in one file reference each other.
--
-- `job_daily_log_crews_log_fk` points at `job_daily_logs(tenant_id, id)`, and a
-- composite FK needs a UNIQUE index on exactly those columns to exist FIRST.
-- So `job_daily_logs_tenant_id_id_idx` is moved up here, ahead of the
-- constraints. Everything else is as generated.
--
-- Regenerating this file will undo the move.

CREATE TABLE "job_daily_log_crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"log_id" uuid NOT NULL,
	"party_id" uuid,
	"trade" text DEFAULT '' NOT NULL,
	"workers" integer DEFAULT 0 NOT NULL,
	"hours_tenths" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_daily_log_crews_workers_nonnegative" CHECK ("job_daily_log_crews"."workers" >= 0),
	CONSTRAINT "job_daily_log_crews_hours_nonnegative" CHECK ("job_daily_log_crews"."hours_tenths" >= 0),
	CONSTRAINT "job_daily_log_crews_named" CHECK (length(btrim("job_daily_log_crews"."trade")) > 0 or "job_daily_log_crews"."party_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "job_daily_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"log_date" date NOT NULL,
	"weather" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_daily_logs_tenant_id_id_idx" ON "job_daily_logs" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_daily_log_crews" ADD CONSTRAINT "job_daily_log_crews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_daily_log_crews" ADD CONSTRAINT "job_daily_log_crews_log_fk" FOREIGN KEY ("tenant_id","log_id") REFERENCES "public"."job_daily_logs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_daily_log_crews" ADD CONSTRAINT "job_daily_log_crews_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_daily_logs" ADD CONSTRAINT "job_daily_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_daily_logs" ADD CONSTRAINT "job_daily_logs_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_daily_log_crews_tenant_id_id_idx" ON "job_daily_log_crews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_daily_log_crews_tenant_log_idx" ON "job_daily_log_crews" USING btree ("tenant_id","log_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "job_daily_logs_project_date_idx" ON "job_daily_logs" USING btree ("tenant_id","project_id","log_date");--> statement-breakpoint
CREATE INDEX "job_daily_logs_tenant_project_idx" ON "job_daily_logs" USING btree ("tenant_id","project_id");