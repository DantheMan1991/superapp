-- Accounting Core Ledger Platform: RLS policies + database-enforced invariants.
-- Hand-written (drizzle-kit cannot express policies or triggers).
-- Pattern per table matches drizzle/0001_rls.sql: ENABLE + FORCE RLS,
-- superadmin_all, member_all (full CRUD — module data members write).

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_superadmin_all ON "accounts"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY accounts_member_all ON "accounts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY journal_entries_superadmin_all ON "journal_entries"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY journal_entries_member_all ON "journal_entries"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY journal_lines_superadmin_all ON "journal_lines"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY journal_lines_member_all ON "journal_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "dimension_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dimension_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dimension_members_superadmin_all ON "dimension_members"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY dimension_members_member_all ON "dimension_members"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "line_dimensions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "line_dimensions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY line_dimensions_superadmin_all ON "line_dimensions"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY line_dimensions_member_all ON "line_dimensions"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "accounting_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounting_settings_superadmin_all ON "accounting_settings"
  USING (app_is_superadmin()) WITH CHECK (app_is_superadmin());
--> statement-breakpoint
CREATE POLICY accounting_settings_member_all ON "accounting_settings"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Balance invariant: every non-draft journal entry must have >= 2 lines and
-- sum to exactly zero. Enforced by DEFERRABLE INITIALLY DEFERRED constraint
-- triggers so the check runs at COMMIT, after the app has written the whole
-- entry. SECURITY INVOKER: the transaction-local app.role / app.tenant_id
-- set by withTenant()/withSystem() are still in effect at commit time, so
-- RLS shows the trigger exactly the rows the writer could see. Accounting
-- rows are only ever written under one of those contexts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting_assert_entry_balanced(p_tenant uuid, p_entry uuid)
RETURNS void AS $$
DECLARE
  v_status journal_entry_status;
  v_count int;
  v_sum bigint;
BEGIN
  SELECT status INTO v_status FROM journal_entries
    WHERE tenant_id = p_tenant AND id = p_entry;
  IF NOT FOUND OR v_status = 'draft' THEN
    -- Drafts are unconstrained; entry deleted in the same tx = nothing to check.
    RETURN;
  END IF;
  SELECT count(*)::int, coalesce(sum(amount_cents), 0)::bigint
    INTO v_count, v_sum
    FROM journal_lines
    WHERE tenant_id = p_tenant AND entry_id = p_entry;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'accounting: entry % has % line(s); non-draft entries need at least 2', p_entry, v_count
      USING ERRCODE = '23514', CONSTRAINT = 'journal_entry_min_lines';
  END IF;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'accounting: entry % is unbalanced by % cents', p_entry, v_sum
      USING ERRCODE = '23514', CONSTRAINT = 'journal_entry_balanced';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting_lines_balance_tg() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM accounting_assert_entry_balanced(NEW.tenant_id, NEW.entry_id);
  END IF;
  -- On UPDATE also recheck the OLD entry (covers a line moved between
  -- entries); on DELETE the OLD entry is the one that lost a line.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM accounting_assert_entry_balanced(OLD.tenant_id, OLD.entry_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accounting_entries_balance_tg() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    PERFORM accounting_assert_entry_balanced(NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accounting_lines_balance_tg();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balance_check
  AFTER INSERT OR UPDATE OF status ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accounting_entries_balance_tg();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit log is append-only, enforced by the database — not just by the
-- absence of UPDATE/DELETE policies. The single permitted UPDATE shape is
-- the FK "ON DELETE SET NULL" from tenants (tenant_id -> NULL, everything
-- else untouched), which fires during whole-tenant deletion.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_append_only_tg() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.tenant_id IS NULL
     AND OLD.tenant_id IS NOT NULL
     AND (to_jsonb(NEW) - 'tenant_id') = (to_jsonb(OLD) - 'tenant_id') THEN
    RETURN NEW; -- tenant cascade SET NULL
  END IF;
  RAISE EXCEPTION 'audit_log is append-only'
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only_tg();
