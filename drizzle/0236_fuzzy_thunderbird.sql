-- land_zones: `planned` joins the status lifecycle (slice 2b.2).
--
-- A PLANNED ZONE IS GROUND WITH NO FENCE ROUND IT YET — what subdividing a
-- field produces, before anybody has been out to build the divisions. It goes
-- on the FRONT of a lifecycle this column already had (`active`, `retired`),
-- rather than into a second table for proposed ground that would duplicate
-- every polygon and then drift from it.
--
-- WIDENING THIS CHANGED NO EXISTING QUERY, which is worth knowing because it
-- easily could have. Every read that must not see unfenced ground — zoneAtPoint,
-- zoneCountsByParcel, mappedZoneCount, retireParcel, combineParcels — already
-- filtered `status = 'active'` explicitly rather than "not retired". The one
-- guard that had to be ADDED lives in src/packs/land/ops.ts: `startOccupancy`
-- never looked at zone status at all, and would happily have put animals on a
-- paddock that does not exist.
--
-- No default change: `active` stays the default, because creating a zone by
-- hand still means creating one that is there.

ALTER TABLE "land_zones" DROP CONSTRAINT "land_zones_status_valid";--> statement-breakpoint
ALTER TABLE "land_zones" ADD CONSTRAINT "land_zones_status_valid" CHECK ("land_zones"."status" in ('planned', 'active', 'retired'));
