CREATE TABLE "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_sessions_user_idx" ON "support_sessions" USING btree ("clerk_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "support_sessions_tenant_idx" ON "support_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_sessions_live_idx" ON "support_sessions" USING btree ("clerk_user_id") WHERE "support_sessions"."ended_at" is null;