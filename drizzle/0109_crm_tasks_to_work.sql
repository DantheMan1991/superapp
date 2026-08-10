-- Work slice 5b: CRM follow-ups become work items.
--
-- ============================================================================
-- A DATA MIGRATION, NOT A SCHEMA ONE. IT CHANGES NO TABLE.
-- ============================================================================
--
-- Every statement is an INSERT with ON CONFLICT DO NOTHING, so running it twice
-- is a no-op and running it before the deploy leaves the currently-running code
-- working: `crm_tasks` is not touched, so old code keeps reading exactly what it
-- read before.
--
-- THE ONE WINDOW THIS OPENS, STATED RATHER THAN HIDDEN. Between this migration
-- and the deploy that removes CRM's attention source, a follow-up exists in BOTH
-- `crm_tasks` and `work_items`, and both sources report it — so a digest sent in
-- that window lists it twice. It cannot be closed by ordering: the only thing
-- that stops CRM reporting is the deploy. It is accepted because the window is
-- minutes, the digest fires once a day per tenant, and production carries FOUR
-- follow-up rows across one tenant. On a database where that number is large,
-- disable the CRM source first and deploy that on its own.
--
-- IDS ARE PRESERVED. `work_items.id` is set to `crm_tasks.id`, which makes the
-- links below a straight join instead of needing a mapping table, makes a
-- re-run idempotent through the primary key, and means any URL somebody has
-- already bookmarked keeps pointing at the same obligation.

-- 1. Somewhere to put them. `ensureDefaultWorkList` runs on membership sync, so
--    nearly every tenant already has one — but a tenant whose Clerk webhook has
--    not fired would otherwise have its follow-ups land nowhere, and a data
--    migration that silently drops rows is the worst kind.
INSERT INTO work_lists (tenant_id, name, is_default)
SELECT DISTINCT t.tenant_id, 'Work', true
FROM crm_tasks t
WHERE NOT EXISTS (
  SELECT 1 FROM work_lists l
  WHERE l.tenant_id = t.tenant_id AND l.is_default
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. The follow-ups.
--
-- `completed_at` maps to `closed_at` and drives `state`, which is what keeps
-- the two CHECKs happy: `work_items_closed_matches_state` demands that `done`
-- and a non-null `closed_at` agree, and `work_items_closed_pair` demands that
-- `closed_at` and `closed_by` travel together — which `crm_tasks` already
-- guarantees with a CHECK of its own.
--
-- `cancelled` is not produced: CRM had no such state, so inventing one here
-- would be this migration deciding something the data never said.
INSERT INTO work_items (
  id, tenant_id, list_id, title, description, state, due_on,
  assignee_clerk_user_id, closed_at, closed_by_clerk_user_id,
  version, created_by_clerk_user_id, created_at, updated_at
)
SELECT
  t.id,
  t.tenant_id,
  (SELECT l.id FROM work_lists l
    WHERE l.tenant_id = t.tenant_id AND l.is_default),
  t.title,
  t.notes,
  CASE WHEN t.completed_at IS NULL THEN 'todo' ELSE 'done' END,
  t.due_on,
  t.assignee_clerk_user_id,
  t.completed_at,
  t.completed_by_clerk_user_id,
  t.version,
  t.created_by_clerk_user_id,
  t.created_at,
  t.updated_at
FROM crm_tasks t
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 3. What each one is about.
--
-- THE ENTITY TYPE COMES FROM `parties.kind`, and getting this wrong is silent.
-- CRM registers `contact` and `company` as two linkable types over ONE table —
-- a party is a person or an organisation — so a link written as `crm_party`
-- (which is what this module's dossier originally said) would match no
-- registered type, resolve to nothing, and render as a dangling chip that looks
-- like a deleted record.
INSERT INTO work_item_links (
  tenant_id, item_id, extension_slug, entity_type, entity_id,
  created_by_clerk_user_id
)
SELECT
  t.tenant_id,
  t.id,
  'crm',
  CASE p.kind WHEN 'person' THEN 'contact' ELSE 'company' END,
  t.party_id,
  t.created_by_clerk_user_id
FROM crm_tasks t
JOIN parties p ON p.tenant_id = t.tenant_id AND p.id = t.party_id
WHERE t.party_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. And the deal, where there is one. A follow-up can carry both.
INSERT INTO work_item_links (
  tenant_id, item_id, extension_slug, entity_type, entity_id,
  created_by_clerk_user_id
)
SELECT t.tenant_id, t.id, 'crm', 'deal', t.deal_id, t.created_by_clerk_user_id
FROM crm_tasks t
WHERE t.deal_id IS NOT NULL
ON CONFLICT DO NOTHING;
