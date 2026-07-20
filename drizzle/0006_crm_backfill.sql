-- Attach any pre-CRM audits to a prospect record so every engagement has a
-- home in the CRM. Slug encodes the audit id so the UPDATE can correlate.
WITH created AS (
  INSERT INTO "tenants" ("clerk_org_id", "name", "slug", "industry", "status", "contact_name")
  SELECT NULL, a."business_name", 'prospect-' || left(a."id"::text, 8), a."industry", 'prospect', a."contact_name"
  FROM "audits" a
  WHERE a."tenant_id" IS NULL
  RETURNING "id", "slug"
)
UPDATE "audits" a
SET "tenant_id" = c."id"
FROM created c
WHERE c."slug" = 'prospect-' || left(a."id"::text, 8);
