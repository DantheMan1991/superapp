-- Time slice 4: what an hour was for. One link table. See docs/modules/time.md.
--
-- NO NEW TAXONOMY, deliberately. `dimension_members` already is the mechanism
-- and five packs already fill it -- land syncs parcels and zones, assets syncs
-- assets, inventory and livestock sync lots, enterprises syncs lines of
-- business -- so tagging an hour with a member makes it bookable to a paddock,
-- a herd or a tractor with no new seam, and the P&L's "Split by" is built from
-- whatever types are present.
--
-- THE SHAPE IS `line_dimensions`', including the denormalized `dimension_type`.
-- That column is what lets both rules be the database's rather than the write
-- path's: one member per type per entry (the unique index), and the member
-- really is of the type claimed (the three-column FK, whose target is
-- `dimension_members_tenant_type_id_idx`).
--
-- `time_entry_dimensions_member_fk` is NO ACTION on purpose: a dimension member
-- is retired by `is_active`, never deleted, so a cascade would describe a path
-- nothing takes -- and if one ever did, losing the tag silently is worse than
-- being stopped.

CREATE TABLE "time_entry_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"dimension_type" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry_dimensions" ADD CONSTRAINT "time_entry_dimensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_dimensions" ADD CONSTRAINT "time_entry_dimensions_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."time_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_dimensions" ADD CONSTRAINT "time_entry_dimensions_member_fk" FOREIGN KEY ("tenant_id","dimension_type","member_id") REFERENCES "public"."dimension_members"("tenant_id","dimension_type","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entry_dimensions_entry_type_idx" ON "time_entry_dimensions" USING btree ("tenant_id","entry_id","dimension_type");--> statement-breakpoint
CREATE INDEX "time_entry_dimensions_tenant_member_idx" ON "time_entry_dimensions" USING btree ("tenant_id","member_id");