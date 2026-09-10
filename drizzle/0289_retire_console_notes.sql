-- Console notes retire (ADR 0041, back-office slice 3). Slice 1 carried every
-- note onto the party's timeline in the operator tenant, and the table held
-- nothing on either database by the time this ran. A note about a client is
-- the party's now.
DROP TABLE "tenant_notes" CASCADE;