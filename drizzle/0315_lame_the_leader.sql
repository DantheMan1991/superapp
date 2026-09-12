CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin" text DEFAULT 'hand' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"image_id" uuid,
	"shape" text DEFAULT 'square' NOT NULL,
	"focus_x" real DEFAULT 0.5 NOT NULL,
	"focus_y" real DEFAULT 0.5 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"work_item_id" uuid,
	"created_by_clerk_user_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_status_values" CHECK ("social_posts"."status" in ('draft', 'scheduled', 'posted')),
	CONSTRAINT "social_posts_origin_values" CHECK ("social_posts"."origin" in ('hand', 'assistant', 'pack')),
	CONSTRAINT "social_posts_shape_values" CHECK ("social_posts"."shape" in ('square', 'portrait', 'story', 'wide')),
	CONSTRAINT "social_posts_body_length" CHECK (length("social_posts"."body") <= 5000),
	CONSTRAINT "social_posts_link_length" CHECK (length("social_posts"."link") <= 500),
	CONSTRAINT "social_posts_focus_range" CHECK ("social_posts"."focus_x" between 0 and 1 and "social_posts"."focus_y" between 0 and 1),
	CONSTRAINT "social_posts_scheduled_has_time" CHECK ("social_posts"."status" <> 'scheduled' or "social_posts"."scheduled_at" is not null),
	CONSTRAINT "social_posts_posted_has_time" CHECK ("social_posts"."status" <> 'posted' or "social_posts"."posted_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "public"."social_channels"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- HAND-EDITED, and it must stay this way. drizzle-kit emits a bare
-- `ON DELETE set null`, which on a composite (tenant_id, image_id) key means
-- "null BOTH columns" -- and tenant_id is NOT NULL, so the cascade can never
-- run: deleting a photo would fail with a not-null violation instead of
-- clearing the post's picture. PG 15's column-list form nulls only the photo.
-- drizzle-kit diffs SNAPSHOTS rather than the database, so it will not revert
-- this; see docs/modules/marketing.md and the composite-FK note in accounting.
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_image_fk" FOREIGN KEY ("tenant_id","image_id") REFERENCES "public"."site_images"("tenant_id","id") ON DELETE SET NULL ("image_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_tenant_id_id_idx" ON "social_posts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "social_posts_channel_idx" ON "social_posts" USING btree ("tenant_id","channel_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "social_posts_due_idx" ON "social_posts" USING btree ("scheduled_at") WHERE status = 'scheduled' and reminded_at is null;