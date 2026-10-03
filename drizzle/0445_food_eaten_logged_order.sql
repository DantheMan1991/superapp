-- Food D4a: a meal lists its foods in the order they were logged. A plate's foods
-- are written in one transaction, where now() is one instant for every row;
-- clock_timestamp() moves on between them. Safe against the running code: a
-- default only.
ALTER TABLE "food_eaten" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();