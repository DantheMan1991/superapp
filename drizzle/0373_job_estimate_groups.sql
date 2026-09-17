CREATE TABLE "job_estimate_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"name" text NOT NULL,
	"client_note" text DEFAULT '' NOT NULL,
	"price_mode" text DEFAULT 'rollup' NOT NULL,
	"fixed_price_cents" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_estimate_groups_name_present" CHECK (length(btrim("job_estimate_groups"."name")) > 0),
	CONSTRAINT "job_estimate_groups_name_bounded" CHECK (char_length("job_estimate_groups"."name") <= 200),
	CONSTRAINT "job_estimate_groups_note_bounded" CHECK (char_length("job_estimate_groups"."client_note") <= 4000),
	CONSTRAINT "job_estimate_groups_price_mode_valid" CHECK ("job_estimate_groups"."price_mode" in ('rollup', 'fixed')),
	CONSTRAINT "job_estimate_groups_fixed_priced" CHECK (("job_estimate_groups"."price_mode" = 'fixed') = ("job_estimate_groups"."fixed_price_cents" is not null)),
	CONSTRAINT "job_estimate_groups_fixed_nonnegative" CHECK ("job_estimate_groups"."fixed_price_cents" is null or "job_estimate_groups"."fixed_price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job_estimates" DROP CONSTRAINT "job_estimates_presentation_valid";--> statement-breakpoint
ALTER TABLE "job_estimate_lines" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "job_estimate_groups" ADD CONSTRAINT "job_estimate_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_estimate_groups" ADD CONSTRAINT "job_estimate_groups_estimate_fk" FOREIGN KEY ("tenant_id","estimate_id") REFERENCES "public"."job_estimates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_estimate_groups_tenant_id_id_idx" ON "job_estimate_groups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_estimate_groups_tenant_estimate_idx" ON "job_estimate_groups" USING btree ("tenant_id","estimate_id","sort_order");--> statement-breakpoint
-- The column-list form of SET NULL (PG 15, the mail_links precedent in 0046): a bare SET NULL would try
-- to null tenant_id too and can never run on a composite key. A group deleted leaves its lines loose —
-- that is what ungrouping means — and never destroys what was priced (ADR 0079).
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."job_estimate_groups"("tenant_id","id") ON DELETE SET NULL ("group_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_estimate_lines_tenant_group_idx" ON "job_estimate_lines" USING btree ("tenant_id","group_id");--> statement-breakpoint
ALTER TABLE "job_estimates" ADD CONSTRAINT "job_estimates_presentation_valid" CHECK ("job_estimates"."presentation" in ('lines', 'codes', 'groups', 'sum'));