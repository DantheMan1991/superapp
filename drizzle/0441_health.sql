CREATE TABLE "health_habit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"habit_id" uuid NOT NULL,
	"done_on" date NOT NULL,
	"amount" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_habit_logs_amount_positive" CHECK ("health_habit_logs"."amount" is null or "health_habit_logs"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "health_habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_habits_name_length" CHECK (char_length("health_habits"."name") between 1 and 60),
	CONSTRAINT "health_habits_unit_length" CHECK ("health_habits"."unit" is null or char_length("health_habits"."unit") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "health_plunges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"taken_on" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"water_f" double precision,
	"feel_after" integer,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_plunges_seconds_range" CHECK ("health_plunges"."seconds" between 1 and 3600),
	CONSTRAINT "health_plunges_water_range" CHECK ("health_plunges"."water_f" is null or "health_plunges"."water_f" between 28 and 110),
	CONSTRAINT "health_plunges_feel_range" CHECK ("health_plunges"."feel_after" is null or "health_plunges"."feel_after" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "health_sleep" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"woke_on" date NOT NULL,
	"bed_time" time NOT NULL,
	"woke_time" time NOT NULL,
	"minutes" integer NOT NULL,
	"rested" integer,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_sleep_minutes_range" CHECK ("health_sleep"."minutes" between 1 and 1440),
	CONSTRAINT "health_sleep_rested_range" CHECK ("health_sleep"."rested" is null or "health_sleep"."rested" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "health_habit_logs" ADD CONSTRAINT "health_habit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The composite key's target index first: a foreign key needs it to exist.
CREATE UNIQUE INDEX "health_habits_tenant_id_id_idx" ON "health_habits" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "health_habit_logs" ADD CONSTRAINT "health_habit_logs_habit_fk" FOREIGN KEY ("tenant_id","habit_id") REFERENCES "public"."health_habits"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_habits" ADD CONSTRAINT "health_habits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_plunges" ADD CONSTRAINT "health_plunges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sleep" ADD CONSTRAINT "health_sleep_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_habit_logs_tenant_habit_day_idx" ON "health_habit_logs" USING btree ("tenant_id","habit_id","done_on");--> statement-breakpoint
CREATE INDEX "health_habit_logs_tenant_day_idx" ON "health_habit_logs" USING btree ("tenant_id","done_on");--> statement-breakpoint
CREATE INDEX "health_habits_tenant_position_idx" ON "health_habits" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "health_plunges_tenant_day_idx" ON "health_plunges" USING btree ("tenant_id","taken_on");--> statement-breakpoint
CREATE UNIQUE INDEX "health_sleep_tenant_morning_idx" ON "health_sleep" USING btree ("tenant_id","woke_on");