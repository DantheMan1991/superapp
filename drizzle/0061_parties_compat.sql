-- The compatibility triggers. EXPAND step 3 of 3 — the piece that makes the
-- migration CONVERGE rather than merely start.
--
-- THE PROBLEM THEY SOLVE, stated plainly. 0059 added a nullable `party_id`.
-- 0062 will make it NOT NULL. In between there is a window in which the
-- DEPLOYED code still inserts customers and vendors with no party at all — this
-- repo migrates a live database AHEAD of the deploy, so that window is real and
-- not hypothetical. A backfill alone never finishes: it fills the rows that
-- exist, and the running application immediately creates more without parties.
-- The finish line moves as fast as you walk toward it.
--
-- A trigger closes it with no deploy at all. Every insert that omits a party
-- gets one, whoever wrote the insert and whichever version of the application
-- is running. That is why 0062 can enforce NOT NULL safely even though the old
-- code is still live at that moment.
--
-- TRIGGERS AS STRUCTURAL BACKSTOPS ARE PRECEDENTED HERE: the deferrable
-- constraint trigger that rejects unbalanced entries at commit, and the
-- append-only guard on `audit_log`. This is the same idea used for a migration
-- window instead of an invariant.
--
-- IT IS DELIBERATELY **NOT** `SECURITY DEFINER`, and that is the security
-- decision in this file. A definer-rights function would run as the table owner
-- — the role that carries BYPASSRLS — so it could write a `parties` row for ANY
-- tenant, and it would be reachable from any insert into `customers`. Running
-- with invoker rights means the INSERT below is checked by
-- `parties_member_all` against the caller's own `app.tenant_id`, exactly like
-- every other write in the system. It cannot widen anything, which is S12 —
-- and there is nothing it needs to do that ordinary rights cannot.
--
-- WHY IT PASSES RLS AT ALL: `NEW.tenant_id` has already been checked by the
-- `customers`/`vendors` WITH CHECK before this runs, so the party inherits a
-- tenant id that is by construction the caller's own.
--
-- `kind = 'organization'` IS AN ASSUMPTION, AND THE ONLY ONE AVAILABLE. A role
-- row carries a name and nothing that distinguishes a company from a person.
-- Organization is the majority case for a B2B office platform and it is one
-- click to correct once CRM has a UI, which slice 1 surfaces. The alternative —
-- a third `unknown` enum value — would put a permanent null-shaped case into
-- every reader forever to record a fact we will know within a week.
--
-- THESE TRIGGERS ARE TEMPORARY. They stay through the contract migration as a
-- safety net for any writer not yet routed through `src/lib/parties/`, and are
-- dropped in CRM slice 1 once every insert site is accounted for. A permanent
-- hidden writer would make "the single door" untrue.

CREATE OR REPLACE FUNCTION app_mint_party_for_role() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  minted uuid;
BEGIN
  -- The new path sets it explicitly. Nothing to do, and nothing to overwrite.
  IF NEW.party_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO parties (tenant_id, kind, display_name)
  VALUES (NEW.tenant_id, 'organization', NEW.name)
  RETURNING id INTO minted;

  NEW.party_id := minted;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- BEFORE INSERT, so the row reaches the NOT NULL check in 0062 already filled.
-- An AFTER trigger would be too late to satisfy a constraint on the same row.
CREATE TRIGGER customers_mint_party
  BEFORE INSERT ON "customers"
  FOR EACH ROW EXECUTE FUNCTION app_mint_party_for_role();
--> statement-breakpoint

CREATE TRIGGER vendors_mint_party
  BEFORE INSERT ON "vendors"
  FOR EACH ROW EXECUTE FUNCTION app_mint_party_for_role();
