-- land_occupancy: the structure an occupant is IN, while on a zone.
--
-- A pen, a barn, a chicken tractor, a greenhouse. NULL is a real and common
-- answer rather than a missing one: cattle roam a paddock with no structure at
-- all, while broilers live in a pen that sits on the paddock. Both are
-- ordinary.
--
-- IT IS AN ASSET, so this migration is what makes `land` require `assets`.
-- The design settled it before either pack existed: a chicken tractor is an
-- asset that holds a lot and sits on a zone. A parallel structure table would
-- be the same row twice, minus the depreciation and the service schedule.
--
-- NOT REORDERED, and correctly so: the composite FK targets "assets", which
-- has existed since 0125. The rule is check whether the TARGET is created in
-- this migration — it is not.
ALTER TABLE "land_occupancy" ADD COLUMN "structure_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "land_occupancy" ADD CONSTRAINT "land_occupancy_structure_fk" FOREIGN KEY ("tenant_id","structure_asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "land_occupancy_tenant_structure_idx" ON "land_occupancy" USING btree ("tenant_id","structure_asset_id");