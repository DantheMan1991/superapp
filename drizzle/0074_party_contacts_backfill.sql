-- Backfill contact points from the addresses Accounting already holds.
--
-- Every non-empty `customers.email` / `vendors.email` / `.phone` becomes a
-- contact point on that role row's party. Nothing is moved: the accounting
-- columns stay exactly where they are and keep working. This is the EXPAND
-- phase, the same shape slice 0 used for the party spine itself — both stores
-- exist, `src/lib/parties/` keeps them in step, and a later slice contracts.
--
-- THE NORMALIZATION BELOW MUST AGREE WITH `src/lib/parties/contact-values.ts`,
-- and that is the one genuinely fragile thing in this file. If the two ever
-- disagree, a backfilled row stops matching a value normalized by the app — and
-- the symptom is not an error, it is the duplicate check quietly failing to
-- find duplicates. Both expressions are written out here against the TS they
-- mirror so the correspondence can be checked by reading rather than guessed:
--
--   EMAIL   ts: value.trim().toLowerCase()
--           sql: lower(trim(email))                              — identical
--
--   PHONE   ts: digits = value.replace(/[^\d+]/g, '')
--               bare   = digits.replace(/\+/g, '')
--               result = digits.startsWith('+') ? '+' + bare : bare
--           sql: bare = regexp_replace(phone, '[^0-9]', '', 'g')
--                plus = left(regexp_replace(phone, '[^0-9+]', '', 'g'), 1) = '+'
--                                                                  — identical
--
-- There is a test in tests/party-contact-values.test.ts pinning the TS side.
-- If you change it, change this file in the same commit.
--
-- IS_PRIMARY IS SET FOR THE FIRST OF EACH KIND PER PARTY, and only because a
-- backfilled record with no primary would make the composer's fallback the only
-- thing keeping it reachable. `DISTINCT ON` picks one deterministically rather
-- than leaving it to row order.
--
-- ON CONFLICT DO NOTHING throughout: a party that is BOTH a customer and a
-- vendor with the same email would otherwise trip the
-- (tenant, party, kind, normalized) unique, and one address recorded once is
-- the correct outcome rather than an error.
--
-- Idempotent — a re-run conflicts on every row and writes nothing.

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
  true
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
  true
FROM (
  SELECT tenant_id, party_id, phone AS raw, 'main' AS label FROM customers
   WHERE length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6
  UNION ALL
  SELECT tenant_id, party_id, phone AS raw, 'main' AS label FROM vendors
   WHERE length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6
) AS src
ORDER BY src.tenant_id, src.party_id, src.label
ON CONFLICT DO NOTHING;
