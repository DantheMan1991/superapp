CREATE TABLE "health_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"measure_id" uuid NOT NULL,
	"measured_on" date NOT NULL,
	"cm" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_measurements_cm_range" CHECK ("health_measurements"."cm" between 1 and 400)
);
--> statement-breakpoint
CREATE TABLE "health_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"better" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_measures_name_length" CHECK (char_length("health_measures"."name") between 1 and 40),
	CONSTRAINT "health_measures_better_value" CHECK ("health_measures"."better" is null or "health_measures"."better" in ('smaller', 'bigger'))
);
--> statement-breakpoint
CREATE TABLE "health_weighins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"weighed_on" date NOT NULL,
	"kg" double precision NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_weighins_kg_range" CHECK ("health_weighins"."kg" between 20 and 320)
);
--> statement-breakpoint
CREATE TABLE "health_weight_goals" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"goal_kg" double precision NOT NULL,
	"pace_kg" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_weight_goals_goal_range" CHECK ("health_weight_goals"."goal_kg" between 20 and 320),
	CONSTRAINT "health_weight_goals_pace_range" CHECK ("health_weight_goals"."pace_kg" between 0.1 and 1)
);
--> statement-breakpoint
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The composite key's target index first: a foreign key needs it to exist.
CREATE UNIQUE INDEX "health_measures_tenant_id_id_idx" ON "health_measures" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_measure_fk" FOREIGN KEY ("tenant_id","measure_id") REFERENCES "public"."health_measures"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_measures" ADD CONSTRAINT "health_measures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_weighins" ADD CONSTRAINT "health_weighins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_weight_goals" ADD CONSTRAINT "health_weight_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_measurements_tenant_measure_day_idx" ON "health_measurements" USING btree ("tenant_id","measure_id","measured_on");--> statement-breakpoint
CREATE INDEX "health_measurements_tenant_day_idx" ON "health_measurements" USING btree ("tenant_id","measured_on");--> statement-breakpoint
CREATE INDEX "health_measures_tenant_position_idx" ON "health_measures" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "health_weighins_tenant_day_idx" ON "health_weighins" USING btree ("tenant_id","weighed_on");