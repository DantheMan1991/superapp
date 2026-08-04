-- THE CONTRACT STEP. `customers.email` / `.phone` and the vendor pair stop
-- existing; `party_contact_points` becomes the only store for a way of reaching
-- somebody. 0073 added the table, 0074 copied the values across, this removes
-- the originals.
--
-- ============================================================================
-- RUN THIS ONE **AFTER** THE DEPLOY, NOT BEFORE. It is the only migration in
-- this repo with that requirement, and ignoring it takes the product down.
-- ============================================================================
--
-- Every other migration here goes out AHEAD of the code — the standing rule,
-- learned from the 0023/0025 outage recorded in docs/modules/documents.md — and
-- it works because those changes are additive and the deployed code simply does
-- not know about the new column. A DROP inverts the risk. Drizzle names every
-- column of a table in the SELECT list it builds, so the moment these four
-- disappear, code that predates this deploy answers `column customers.email
-- does not exist` on the customers page, the vendors page and the full-books
-- export. The application must already be serving the version that stopped
-- reading them.
--
-- Nothing enforces the order, because nothing can: the database cannot see
-- which build is running. What makes the window survivable is that the reverse
-- order is harmless — the new code neither reads nor writes these columns, so a
-- deploy that lands hours before this file is applied leaves a database
-- carrying four dead columns and nothing else. Deploy first, migrate when
-- convenient.
--
-- THE CATCH-UP BACKFILL BELOW IS NOT A DUPLICATE OF 0074, and deleting it as
-- one would lose real data. 0074 ran ahead of the code that started writing
-- contact points, so any customer edited in the window between the two — a
-- corrected address typed into the old form, on the old build — wrote to the
-- column and nowhere else. This re-runs the same statements against whatever
-- the columns hold at the moment they are removed, which is the last instant
-- the question can be asked at all. `ON CONFLICT DO NOTHING` throughout, so it
-- is a no-op on a database where nothing changed.
--
-- The normalization must still agree with `src/lib/parties/contact-values.ts`;
-- the correspondence is written out line by line in 0074 and is unchanged here.

------------------------------------------------------------------------------
-- Emails
------------------------------------------------------------------------------

INSERT INTO party_contact_points
  (tenant_id, party_id, kind, label, value, normalized_value, is_primary)
SELECT DISTINCT ON (src.tenant_id, src.party_id)
  src.tenant_id,
  src.party_id,
  'email',
  src.label,
  trim(src.raw),
  lower(trim(src.raw)),
  -- Primary only if the party has no email at all yet, which is the difference
  -- from 0074's unconditional `true`. A record whose main address was chosen
  -- deliberately — in CRM, or through the new form — must not have a stale
  -- accounting column arriving late demote it, so a column holding a DIFFERENT
  -- address lands as an alternative rather than as the main one. Unconditional
  -- `true` would also trip the one-primary-per-kind partial unique, and the
  -- whole statement would roll back rather than skip the row.
  NOT EXISTS (
    SELECT 1 FROM party_contact_points p
     WHERE p.tenant_id = src.tenant_id
       AND p.party_id = src.party_id
       AND p.kind = 'email'
  )
FROM (
  SELECT tenant_id, party_id, email AS raw, 'billing' AS label FROM customers
   WHERE trim(email) <> '' AND position('@' in email) > 1
  UNION ALL
  SELECT tenant_id, party_id, email AS raw, 'accounts' AS label FROM vendors
   WHERE trim(email) <> '' AND position('@' in email) > 1
) AS src
ORDER BY src.tenant_id, src.party_id, src.label
ON CONFLICT DO NOTHING;
--> statement-breakpoint

------------------------------------------------------------------------------
-- Phones
------------------------------------------------------------------------------

INSERT INTO party_contact_points
  (tenant_id, party_id, kind, label, value, normalized_value, is_primary)
SELECT DISTINCT ON (src.tenant_id, src.party_id)
  src.tenant_id,
  src.party_id,
  'phone',
  src.label,
  trim(src.raw),
  CASE
    WHEN left(regexp_replace(src.raw, '[^0-9+]', '', 'g'), 1) = '+'
      THEN '+' || regexp_replace(src.raw, '[^0-9]', '', 'g')
    ELSE regexp_replace(src.raw, '[^0-9]', '', 'g')
  END,
  NOT EXISTS (
    SELECT 1 FROM party_contact_points p
     WHERE p.tenant_id = src.tenant_id
       AND p.party_id = src.party_id
       AND p.kind = 'phone'
  )
FROM (
  SELECT tenant_id, party_id, phone AS raw, 'main' AS label FROM customers
   WHERE length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6
  UNION ALL
  SELECT tenant_id, party_id, phone AS raw, 'main' AS label FROM vendors
   WHERE length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6
) AS src
ORDER BY src.tenant_id, src.party_id, src.label
ON CONFLICT DO NOTHING;
--> statement-breakpoint

------------------------------------------------------------------------------
-- Verify before destroying — the same shape 0062 used before SET NOT NULL, and
-- for the same reason: a silent partial backfill followed by a DROP is data
-- loss with no error to notice.
--
-- The check is deliberately narrow. Every USABLE address must now exist as a
-- contact point on the right party; values the normalizer would refuse are
-- excluded by the same predicates that filtered the inserts above, because
-- `bob@` is a string a text column was willing to hold and no migration can
-- turn it into a way of reaching anybody. Those are lost here, which is the
-- correct outcome rather than an oversight — stated so that a count which does
-- NOT tie is recognised as a bug rather than as this.
--
-- Phones are not re-checked separately: they travel the same path, and the
-- email side is the one anything reads.
------------------------------------------------------------------------------

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing FROM (
    SELECT c.tenant_id, c.party_id, lower(trim(c.email)) AS v FROM customers c
     WHERE trim(c.email) <> '' AND position('@' in c.email) > 1
    UNION
    SELECT v.tenant_id, v.party_id, lower(trim(v.email)) FROM vendors v
     WHERE trim(v.email) <> '' AND position('@' in v.email) > 1
  ) AS want
  WHERE NOT EXISTS (
    SELECT 1 FROM party_contact_points p
     WHERE p.tenant_id = want.tenant_id
       AND p.party_id = want.party_id
       AND p.kind = 'email'
       AND p.normalized_value = want.v
  );

  IF missing > 0 THEN
    RAISE EXCEPTION
      'contact backfill incomplete: % address(es) still exist only on the accounting columns. Not dropping them.',
      missing;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "customers" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "vendors" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "vendors" DROP COLUMN "phone";
