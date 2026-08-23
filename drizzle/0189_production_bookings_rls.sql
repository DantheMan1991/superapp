-- production_bookings: RLS. Pattern per drizzle/0187_production_processors_rls.sql
-- — ENABLE + FORCE, superadmin_all, member_all.
--
-- MEMBER-WIDE for reading and writing, like the rest of this pack. The write
-- guard that matters here is in the ops layer and is OWNER: booking a date
-- commits the farm to a day and usually to a deposit, which is a decision rather
-- than a chore. RLS answers only "whose rows are these", and a policy that tried
-- to answer the other question would put the rule in two places.
--
-- WHAT A LEAKED ROW WOULD GIVE AWAY, and it is worse than the directory's.
-- A booking says which plant a named farm is using, ON WHICH DAY, for how many
-- head, and what it paid to hold the slot. Slaughter dates are the scarce
-- resource in this trade — the design says plants book six to twelve months
-- ahead and that losing a date is expensive — so a competitor who could read
-- this table would know exactly which mornings to ring for, and how much of the
-- season's capacity a neighbour has already taken. That is a commercial harm
-- with no equivalent anywhere else in this pack.
--
-- The processor cascade reaches it, so a booking cannot outlive the plant it
-- was made with. The run reference is SET NULL rather than cascading, on
-- purpose: deleting a processing day must not erase the record that a date was
-- held and money was paid for it.

ALTER TABLE "production_bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_bookings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_bookings_superadmin_all ON "production_bookings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY production_bookings_member_all ON "production_bookings"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
