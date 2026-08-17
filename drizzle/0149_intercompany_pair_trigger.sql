-- A pair is EXACTLY TWO entries, and the database says so (ADR 0010 slice 2).
--
-- Same shape and the same reasoning as the balance check in `0008`: the posting
-- engine writes both halves inside one transaction, and this is the backstop
-- for anything that engine gets wrong. A half-written pair leaves one company
-- owing an affiliate that nobody is owed by — every report still balances, the
-- consolidation eliminates one leg against nothing, and no screen would ever
-- surface it. That is precisely the failure class ADR 0010 exists to prevent,
-- so it gets a database guarantee rather than a code comment.
--
-- DEFERRED, and it has to be: the two entries are inserted one after the other,
-- so the constraint is false in between. It is checked once at COMMIT, which is
-- also what lets a reversal write its own new pair in the same transaction.
--
-- The two halves are required to be in DIFFERENT companies. One company owing
-- itself is not a transaction; it is a mistake with a link on it.
--
-- Cross-tenant is unreachable — `intercompany_id` is scoped by `tenant_id`
-- everywhere it is read, and the composite FKs make an entry naming another
-- tenant's company unrepresentable — but the count below is per (tenant, id)
-- rather than per id alone, so the trigger cannot be fooled by a collision
-- across tenants either.

CREATE OR REPLACE FUNCTION accounting_assert_intercompany_pair(
  p_tenant uuid,
  p_intercompany uuid
) RETURNS void AS $$
DECLARE
  v_entries int;
  v_entities int;
BEGIN
  IF p_intercompany IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*), count(DISTINCT entity_id)
    INTO v_entries, v_entities
    FROM journal_entries
   WHERE tenant_id = p_tenant
     AND intercompany_id = p_intercompany;

  -- Zero means the pair was rolled back or deleted wholesale, which is fine.
  IF v_entries = 0 THEN
    RETURN;
  END IF;
  IF v_entries <> 2 THEN
    RAISE EXCEPTION
      'intercompany % has % entries, expected exactly 2', p_intercompany, v_entries
      USING ERRCODE = '23514';
  END IF;
  IF v_entities <> 2 THEN
    RAISE EXCEPTION
      'intercompany % has both entries in one company', p_intercompany
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION accounting_intercompany_pair_tg() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM accounting_assert_intercompany_pair(NEW.tenant_id, NEW.intercompany_id);
  END IF;
  -- On UPDATE also recheck what the row LEFT, and on DELETE the pair it was
  -- part of — either can drop a pair to one entry.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM accounting_assert_intercompany_pair(OLD.tenant_id, OLD.intercompany_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_entries_intercompany_check
  AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION accounting_intercompany_pair_tg();
