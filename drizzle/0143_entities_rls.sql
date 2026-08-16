-- entities: RLS. Pattern per drizzle/0124_sales_tax_rls.sql — ENABLE + FORCE,
-- superadmin_all, member_all.
--
-- WHAT THESE POLICIES DO AND DO NOT DO, because this table is the one place in
-- the schema where that distinction is load-bearing.
--
-- They keep one CLIENT's entities entirely invisible to another, which is the
-- wall that must stay absolute and is untouched by ADR 0010.
--
-- They deliberately do NOT separate two entities OF THE SAME CLIENT. There is
-- no `app.current_entity` and there is not going to be one in this slice: two
-- LLCs of one landlord share an owner, a bookkeeper and a login, so a bug there
-- leaks the client's data to the client. Separation between entities is
-- application code — a REQUIRED `EntityScope` argument on every report engine,
-- so forgetting it is a compile error rather than a silently wrong statement.
-- ADR 0010 names this reduction in what the database guarantees as its own
-- strongest counter-argument; it is a decision, not an omission.
--
-- The invariant the database DOES carry is the composite foreign key added in
-- `0142`: `journal_entries (tenant_id, entity_id) -> entities (tenant_id, id)`,
-- which makes an entry naming another tenant's entity unrepresentable rather
-- than merely unwritten.

ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "entities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY entities_superadmin_all ON "entities"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY entities_member_all ON "entities"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
