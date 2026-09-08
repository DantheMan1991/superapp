CREATE TABLE "livestock_advisor_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_advisor_messages_role_valid" CHECK ("livestock_advisor_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "livestock_advisor_messages_content_present" CHECK (length("livestock_advisor_messages"."content") > 0),
	CONSTRAINT "livestock_advisor_messages_position_valid" CHECK ("livestock_advisor_messages"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "livestock_advisor_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"title" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livestock_advisor_threads_title_present" CHECK (length(btrim("livestock_advisor_threads"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "livestock_advisor_messages" ADD CONSTRAINT "livestock_advisor_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livestock_advisor_threads" ADD CONSTRAINT "livestock_advisor_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_advisor_messages_tenant_id_id_idx" ON "livestock_advisor_messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_advisor_messages_tenant_thread_position_idx" ON "livestock_advisor_messages" USING btree ("tenant_id","thread_id","position");--> statement-breakpoint
CREATE INDEX "livestock_advisor_messages_tenant_role_created_idx" ON "livestock_advisor_messages" USING btree ("tenant_id","role","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "livestock_advisor_threads_tenant_id_id_idx" ON "livestock_advisor_threads" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "livestock_advisor_threads_tenant_user_updated_idx" ON "livestock_advisor_threads" USING btree ("tenant_id","clerk_user_id","updated_at");--> statement-breakpoint
-- HAND-REORDERED: the composite FK needs livestock_advisor_threads_tenant_id_id_idx first,
-- and drizzle-kit emits every FK before every index (see 0222 for the precedent).
ALTER TABLE "livestock_advisor_messages" ADD CONSTRAINT "livestock_advisor_messages_thread_fk" FOREIGN KEY ("tenant_id","thread_id") REFERENCES "public"."livestock_advisor_threads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
