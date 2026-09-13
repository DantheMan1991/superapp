-- Feedback slice 2: attachments. RLS is the next migration, 0324.
--
-- HAND-REORDERED, and it will not apply otherwise — the SECOND time this table
-- family has hit it (see 0321's header).
--
-- drizzle-kit emitted every ALTER TABLE ... ADD CONSTRAINT before every CREATE
-- INDEX. That puts `feedback_attachments_message_fk` — a composite key on
-- (tenant_id, message_id) — ahead of the unique index on
-- feedback_messages (tenant_id, id) that it references, and Postgres refuses a
-- foreign key whose target columns carry no unique constraint:
--
--   there is no unique constraint matching given keys for referenced table
--
-- SHARPER THAN 0321's VERSION, because that index is on an EXISTING table
-- rather than one born in this migration, so the failure would not be confined
-- to a fresh database — it would fail on dev and on production too. The index
-- therefore moves to the very top.

CREATE UNIQUE INDEX "feedback_messages_tenant_id_id_idx" ON "feedback_messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE TABLE "feedback_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"blob_pathname" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."feedback_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."feedback_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_attachments_pathname_idx" ON "feedback_attachments" USING btree ("blob_pathname");--> statement-breakpoint
CREATE INDEX "feedback_attachments_message_idx" ON "feedback_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "feedback_attachments_report_idx" ON "feedback_attachments" USING btree ("report_id");
