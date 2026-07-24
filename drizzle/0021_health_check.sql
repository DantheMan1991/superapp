CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exchange_count" integer DEFAULT 0 NOT NULL,
	"ip_hash" text NOT NULL,
	"last_turn_at" timestamp with time zone,
	"assessment" text,
	"audit_id" uuid,
	"email" text,
	"contact_name" text,
	"business_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_sessions_state_check" CHECK ("interview_sessions"."state" in ('active', 'awaiting_contact', 'completed', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "source" text DEFAULT 'founder' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_sessions_ip_created_idx" ON "interview_sessions" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "interview_sessions_created_idx" ON "interview_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_sessions_audit_idx" ON "interview_sessions" USING btree ("audit_id") WHERE "interview_sessions"."audit_id" is not null;