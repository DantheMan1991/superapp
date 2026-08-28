-- Slice 8g: the herd tables go.
--
-- **THE SECOND OF TWO RELEASES, AND THAT IS THE WHOLE POINT.** 8e (`0231`)
-- converted every herd into a LOT holding what it held and stopped the code
-- reading these tables; this drops them, one deploy later. `main` auto-deploys
-- and nothing applies migrations for it, so a DROP shipped beside the code that
-- stops reading a table takes the running app down in the gap between the two.
-- ADR 0014's rule, read backwards for a removal.
--
-- **CHECKED BEFORE RUNNING, on both databases:** every herd had a converted lot
-- (`metadata->>'migratedFromHerd'`), so nothing here loses a grouping — and no
-- foreign key outside these two tables points at them, so the CASCADE takes
-- only their own constraints and policies with it.

DROP TABLE "livestock_group_members" CASCADE;--> statement-breakpoint
DROP TABLE "livestock_groups" CASCADE;