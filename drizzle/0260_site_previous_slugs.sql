ALTER TABLE "sites" ADD COLUMN "previous_slugs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "sites_previous_slugs_idx" ON "sites" USING gin ("previous_slugs");