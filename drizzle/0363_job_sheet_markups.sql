CREATE TABLE "job_sheet_markups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sheet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"color" text DEFAULT 'red' NOT NULL,
	"geometry" jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"work_item_id" uuid,
	"created_by_clerk_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sheet_markups_kind_valid" CHECK ("job_sheet_markups"."kind" in ('cloud', 'arrow', 'text', 'pin')),
	CONSTRAINT "job_sheet_markups_color_valid" CHECK ("job_sheet_markups"."color" in ('red', 'blue', 'green', 'yellow', 'black')),
	CONSTRAINT "job_sheet_markups_geometry_object" CHECK (jsonb_typeof("job_sheet_markups"."geometry") = 'object'),
	CONSTRAINT "job_sheet_markups_words_present" CHECK ("job_sheet_markups"."kind" not in ('text', 'pin') or length(btrim("job_sheet_markups"."text")) > 0),
	CONSTRAINT "job_sheet_markups_text_bounded" CHECK (char_length("job_sheet_markups"."text") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."job_projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_sheet_fk" FOREIGN KEY ("tenant_id","sheet_id") REFERENCES "public"."job_sheets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The column-list form of SET NULL (PG 15, the mail_links precedent in 0046): a bare SET NULL would try to
-- null tenant_id too and can never run on a composite key. A punch item cleared from Work leaves the pin as a note.
ALTER TABLE "job_sheet_markups" ADD CONSTRAINT "job_sheet_markups_work_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE SET NULL ("work_item_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_sheet_markups_tenant_id_id_idx" ON "job_sheet_markups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "job_sheet_markups_tenant_sheet_idx" ON "job_sheet_markups" USING btree ("tenant_id","sheet_id");--> statement-breakpoint
CREATE INDEX "job_sheet_markups_tenant_project_idx" ON "job_sheet_markups" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "job_sheet_markups_tenant_work_idx" ON "job_sheet_markups" USING btree ("tenant_id","work_item_id");