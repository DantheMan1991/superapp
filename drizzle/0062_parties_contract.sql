-- The backfill and the CONTRACT step. Every existing AR/AP relationship gets
-- the identity row it should always have had, and `party_id` becomes required.
--
-- WHY THIS IS SAFE TO RUN WHILE THE OLD CODE IS STILL LIVE, which is the
-- question 0023/0025 taught this repo to ask of every migration. 0061's BEFORE
-- INSERT triggers fill `party_id` for any writer that omits it, so the NOT NULL
-- added at the bottom of this file cannot be violated by the currently deployed
-- application. Without those triggers this migration would take the product
-- down the moment somebody added a customer.
--
-- ONE PARTY PER ROLE ROW. NOTHING IS MATCHED, NOTHING IS MERGED.
-- A customer named "Probe Construction" and a vendor named "Probe Construction"
-- become two parties, not one. That is not laziness and it is not a bug to fix
-- later — it is the only defensible behaviour available to a migration. Fusing
-- rows on a name match would silently merge two real businesses inside a live
-- tenant's books, and by the time anybody noticed, the evidence needed to
-- separate them again would be gone. The merge tool in CRM slice 7 proposes
-- candidates to a human on stronger evidence than a string compare, and a human
-- accepts. Same discipline as the rest of the platform: the machine suggests,
-- a person commits.
--
-- IDEMPOTENT. Both loops select only rows with a null `party_id`, so a re-run
-- finds nothing and does nothing. Safe to apply to a database that already had
-- it, which is what makes running it against two databases a chore rather than
-- a risk.
--
-- A ROW LOOP RATHER THAN SET-BASED SQL, on purpose. `INSERT ... RETURNING`
-- cannot report which source row each generated id belongs to, so a set-based
-- version needs a temp table to carry the mapping and depends on the migration
-- runner keeping one session across statements. The loop needs no such
-- assumption and is obviously correct on inspection. These tables hold hundreds
-- of rows, not millions; clarity is worth more here than a single pass.

DO $$
DECLARE
  r record;
  minted uuid;
BEGIN
  FOR r IN SELECT id, tenant_id, name FROM customers WHERE party_id IS NULL LOOP
    INSERT INTO parties (tenant_id, kind, display_name)
    VALUES (r.tenant_id, 'organization', r.name)
    RETURNING id INTO minted;
    -- Scoped by id alone is correct here: `customers.id` is the primary key.
    UPDATE customers SET party_id = minted WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, tenant_id, name FROM vendors WHERE party_id IS NULL LOOP
    INSERT INTO parties (tenant_id, kind, display_name)
    VALUES (r.tenant_id, 'organization', r.name)
    RETURNING id INTO minted;
    UPDATE vendors SET party_id = minted WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint

------------------------------------------------------------------------------
-- Verify before enforcing.
--
-- The SAME-TENANT property is not checked here because it cannot be violated:
-- `customers_party_fk` and `vendors_party_fk` are composite on
-- (tenant_id, party_id) → parties (tenant_id, id), so a cross-tenant reference
-- is rejected by the database at write time rather than found by an audit
-- afterwards. What is worth asserting is that the backfill actually covered
-- everything — a silent partial backfill followed by SET NOT NULL would fail
-- with a bare constraint error and no explanation of which step went wrong.
------------------------------------------------------------------------------

DO $$
DECLARE
  stragglers integer;
BEGIN
  SELECT (SELECT count(*) FROM customers WHERE party_id IS NULL)
       + (SELECT count(*) FROM vendors WHERE party_id IS NULL)
    INTO stragglers;

  IF stragglers > 0 THEN
    RAISE EXCEPTION
      'parties backfill incomplete: % role row(s) still have no party. Not enforcing NOT NULL.',
      stragglers;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "customers" ALTER COLUMN "party_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "party_id" SET NOT NULL;

------------------------------------------------------------------------------
-- THE TRIGGERS FROM 0061 DELIBERATELY SURVIVE THIS MIGRATION.
--
-- They are the reason the statements above are safe while the old code runs,
-- and dropping them in the same file would reopen the window this whole
-- sequence exists to close. They come out in CRM slice 1, once every insert
-- site is routed through `src/lib/parties/` and can be named. Until then they
-- are a safety net, and they are recorded as such in docs/modules/crm.md so
-- nobody mistakes them for the intended write path.
------------------------------------------------------------------------------
