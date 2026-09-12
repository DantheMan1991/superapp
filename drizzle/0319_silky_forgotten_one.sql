-- device_grants + device_grant_uses: the credential a phone holds, and every
-- sentence it sent. ADR 0048, docs/modules/identity-and-roles.md. RLS for both
-- is in 0320 beside this one.
--
-- HAND-REORDERED, AND IT HAS TO BE. drizzle-kit emits every ADD CONSTRAINT
-- before every CREATE INDEX, which cannot work when a composite FK and the
-- unique index it points at are born in the SAME migration:
-- `device_grant_uses_grant_fk` references `device_grants(tenant_id, id)`, and
-- Postgres refuses an FK whose referenced columns carry no unique constraint
-- YET. So `device_grants_tenant_id_id_idx` is created first, below, and the FK
-- follows it. 0276 hit this exact wall. The snapshot is diffed against the
-- schema file and not against this SQL, so the reordering survives the next
-- `db:generate`.

CREATE TYPE "public"."device_grant_scope" AS ENUM('tell');--> statement-breakpoint
CREATE TYPE "public"."device_use_outcome" AS ENUM('proposed', 'recorded', 'refused');--> statement-breakpoint
CREATE TABLE "device_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"scope" "device_grant_scope" DEFAULT 'tell' NOT NULL,
	"platform" "push_platform" NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_grants_label_length" CHECK (length("device_grants"."label") <= 60)
);
--> statement-breakpoint
CREATE TABLE "device_grant_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"outcome" "device_use_outcome" NOT NULL,
	"action_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_at" timestamp with time zone,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_grant_uses_key_length" CHECK (length("device_grant_uses"."idempotency_key") between 8 and 200)
);
--> statement-breakpoint
-- BEFORE THE COMPOSITE FK BELOW. See the header.
CREATE UNIQUE INDEX "device_grants_tenant_id_id_idx" ON "device_grants" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "device_grants" ADD CONSTRAINT "device_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_grant_uses" ADD CONSTRAINT "device_grant_uses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_grant_uses" ADD CONSTRAINT "device_grant_uses_grant_fk" FOREIGN KEY ("tenant_id","grant_id") REFERENCES "public"."device_grants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_grants_hash_idx" ON "device_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_grants_owner_idx" ON "device_grants" USING btree ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_grant_uses_key_idx" ON "device_grant_uses" USING btree ("grant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "device_grant_uses_window_idx" ON "device_grant_uses" USING btree ("grant_id","created_at");
