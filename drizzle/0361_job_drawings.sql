-- Hand-reordered (ADR 0014's ritual, the schedule's precedent in 0359): job_sheets carries a composite key to
-- job_drawing_sets (tenant_id, id), which needs that table's unique index BEFORE the ALTER TABLE that adds the key.
-- drizzle-kit emits every CREATE INDEX after every ALTER TABLE, so the one index is moved up here.
CREATE TABLE "job_drawing_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issued_on" date NOT NULL,
	"from_party_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_drawing_sets_name_present" CHECK (length(btrim("job_drawing_sets"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "job_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"sheet_number" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revision" text DEFAULT '' NOT NULL,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sheets_number_present" CHECK (length(btrim("job_sheets"."sheet_number")) > 0),
	CONSTRAINT "job_sheets_page_positive" CHECK ("job_sheets"."page_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_drawing_sets_tenant_id_id_idx" ON "job_drawing_sets" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "job_drawing_sets" ADD CONSTRAINT "job_drawing_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_drawing_sets" ADD CONSTRAINT "job_drawing_sets_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_drawing_sets" ADD CONSTRAINT "job_drawing_sets_party_fk" FOREIGN KEY ("tenant_id","from_party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_set_fk" FOREIGN KEY ("tenant_id","set_id") REFERENCES "public"."job_drawing_sets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sheets" ADD CONSTRAINT "job_sheets_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_drawing_sets_tenant_project_idx" ON "job_drawing_sets" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sheets_tenant_id_id_idx" ON "job_sheets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sheets_set_number_idx" ON "job_sheets" USING btree ("tenant_id","set_id","sheet_number");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sheets_set_page_idx" ON "job_sheets" USING btree ("tenant_id","set_id","document_id","page_number");--> statement-breakpoint
CREATE INDEX "job_sheets_tenant_project_number_idx" ON "job_sheets" USING btree ("tenant_id","project_id","sheet_number");--> statement-breakpoint
CREATE INDEX "job_sheets_tenant_document_idx" ON "job_sheets" USING btree ("tenant_id","document_id");