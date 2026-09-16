CREATE TABLE "job_bonding_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"single_job_limit_cents" bigint,
	"aggregate_limit_cents" bigint,
	"surety_party_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_bonding_lines_single_positive" CHECK (coalesce("job_bonding_lines"."single_job_limit_cents", 1) > 0),
	CONSTRAINT "job_bonding_lines_aggregate_positive" CHECK (coalesce("job_bonding_lines"."aggregate_limit_cents", 1) > 0),
	CONSTRAINT "job_bonding_lines_single_within_aggregate" CHECK ("job_bonding_lines"."single_job_limit_cents" is null or "job_bonding_lines"."aggregate_limit_cents" is null or "job_bonding_lines"."single_job_limit_cents" <= "job_bonding_lines"."aggregate_limit_cents"),
	CONSTRAINT "job_bonding_lines_notes_bounded" CHECK (char_length("job_bonding_lines"."notes") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "job_bonds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid,
	"kind" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"surety_party_id" uuid,
	"penal_sum_cents" bigint NOT NULL,
	"premium_cents" bigint,
	"cost_code_id" uuid,
	"effective_on" date,
	"expires_on" date,
	"released_on" date,
	"status" text DEFAULT 'requested' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_bonds_kind_format" CHECK ("job_bonds"."kind" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "job_bonds_penal_sum_positive" CHECK ("job_bonds"."penal_sum_cents" > 0),
	CONSTRAINT "job_bonds_premium_nonnegative" CHECK (coalesce("job_bonds"."premium_cents", 0) >= 0),
	CONSTRAINT "job_bonds_status_valid" CHECK ("job_bonds"."status" in ('requested', 'issued', 'released', 'void')),
	CONSTRAINT "job_bonds_in_force_dated" CHECK ("job_bonds"."status" in ('requested', 'void') or "job_bonds"."effective_on" is not null),
	CONSTRAINT "job_bonds_released_dated" CHECK (("job_bonds"."status" = 'released') = ("job_bonds"."released_on" is not null)),
	CONSTRAINT "job_bonds_expiry_after_effective" CHECK ("job_bonds"."expires_on" is null or "job_bonds"."effective_on" is null or "job_bonds"."expires_on" >= "job_bonds"."effective_on"),
	CONSTRAINT "job_bonds_number_bounded" CHECK (char_length("job_bonds"."number") <= 100),
	CONSTRAINT "job_bonds_notes_bounded" CHECK (char_length("job_bonds"."notes") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "job_bonding_lines" ADD CONSTRAINT "job_bonding_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_bonding_lines" ADD CONSTRAINT "job_bonding_lines_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_bonding_lines" ADD CONSTRAINT "job_bonding_lines_surety_fk" FOREIGN KEY ("tenant_id","surety_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_bonds" ADD CONSTRAINT "job_bonds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_bonds" ADD CONSTRAINT "job_bonds_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The column-list form of SET NULL (PG 15, the mail_links precedent in 0046): a bare SET NULL would try to
-- null tenant_id too and can never run on a composite key. A contract gone leaves the bond on the job, and a
-- code retired leaves what the bond cost (ADR 0078).
ALTER TABLE "job_bonds" ADD CONSTRAINT "job_bonds_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."job_contracts"("tenant_id","id") ON DELETE SET NULL ("contract_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_bonds" ADD CONSTRAINT "job_bonds_cost_code_fk" FOREIGN KEY ("tenant_id","cost_code_id") REFERENCES "public"."job_cost_codes"("tenant_id","id") ON DELETE SET NULL ("cost_code_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_bonds" ADD CONSTRAINT "job_bonds_surety_fk" FOREIGN KEY ("tenant_id","surety_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_bonding_lines_tenant_id_id_idx" ON "job_bonding_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_bonding_lines_entity_idx" ON "job_bonding_lines" USING btree ("tenant_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_bonds_tenant_id_id_idx" ON "job_bonds" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_bonds_tenant_project_idx" ON "job_bonds" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_bonds_tenant_contract_idx" ON "job_bonds" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "job_bonds_tenant_surety_idx" ON "job_bonds" USING btree ("tenant_id","surety_party_id");