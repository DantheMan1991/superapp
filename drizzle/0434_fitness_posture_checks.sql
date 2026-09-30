CREATE TABLE "fitness_posture_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"local_day" date NOT NULL,
	"captures" jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fitness_posture_checks_captures_array" CHECK (jsonb_typeof("fitness_posture_checks"."captures") = 'array'),
	CONSTRAINT "fitness_posture_checks_notes_array" CHECK (jsonb_typeof("fitness_posture_checks"."notes") = 'array'),
	CONSTRAINT "fitness_posture_checks_version_known" CHECK ("fitness_posture_checks"."version" = 1)
);
--> statement-breakpoint
ALTER TABLE "fitness_posture_checks" ADD CONSTRAINT "fitness_posture_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fitness_posture_checks_tenant_id_id_idx" ON "fitness_posture_checks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "fitness_posture_checks_tenant_taken_idx" ON "fitness_posture_checks" USING btree ("tenant_id","taken_at");