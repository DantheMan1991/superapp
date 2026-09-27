-- tenants.kind and tenants.personal_owner_clerk_user_id never change once the
-- row exists (ADR 0111). The auth split reads `kind` on every request —
-- `requireTenant` refuses a personal space, `requirePersonalSpace` refuses
-- anything else — so a workspace whose kind could change could change which
-- half of the product may open it, and an owner that could change could hand
-- somebody's private space to somebody else.
--
-- Enforced here rather than trusted to code because the code that can write
-- `tenants` is `withSystem`, which RLS does not watch: members cannot update
-- the row at all (0001), and this is what holds for everything else. The
-- precedent is `audit_log_append_only` (0008). Only these two columns: the
-- name follows Clerk and every other column keeps moving as before. Setting a
-- column to the value it already has is not a change, and is allowed.
CREATE OR REPLACE FUNCTION tenants_kind_immutable_tg() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.personal_owner_clerk_user_id IS DISTINCT FROM OLD.personal_owner_clerk_user_id THEN
    RAISE EXCEPTION 'tenants_kind_immutable: a workspace''s kind and owner never change'
      USING ERRCODE = '0A000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tenants_kind_immutable
  BEFORE UPDATE OF kind, personal_owner_clerk_user_id ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_kind_immutable_tg();
