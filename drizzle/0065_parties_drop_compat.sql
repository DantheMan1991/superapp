-- Drop the party compatibility triggers. The last step of the slice 0
-- expand/contract, deferred to here on purpose.
--
-- WHAT THEY WERE FOR. 0061 put a BEFORE INSERT trigger on `customers` and
-- `vendors` that minted a party when the insert omitted one. That covered the
-- window between adding `party_id` and enforcing it, when the DEPLOYED code
-- still knew nothing about parties — this repo migrates a live database ahead
-- of the deploy, so without them 0062's NOT NULL would have taken the product
-- down the moment somebody added a customer.
--
-- WHY THEY GO NOW. That window is closed: slice 0 shipped, and every insert
-- site is accounted for. `createCustomer` and `createVendor` mint the party
-- through `src/lib/parties/`, and the compiler proves there are no others —
-- `partyId` is required in `$inferInsert`, so a raw insert that forgot it would
-- not build. The only remaining callers were the isolation fixtures, which pass
-- one explicitly.
--
-- WHY LEAVING THEM WOULD BE WORSE THAN THE WORK OF REMOVING THEM. A trigger
-- that silently writes a `parties` row is a SECOND writer, and the entire point
-- of `src/lib/parties/` is that there is one door. A hidden writer with a
-- hardcoded `kind = 'organization'` would keep quietly creating organizations
-- for records somebody meant to be people, and it would do it in exactly the
-- code path a future agent is least likely to read. It also makes the single
-- door a claim the codebase contradicts, which is how a convention stops being
-- believed.
--
-- SAFE AGAINST THE RUNNING CODE, which is the question every migration here has
-- to answer. The currently deployed application is slice 0, which sets
-- `party_id` on every insert — so these triggers already do nothing but return
-- NEW. Dropping something that is a no-op for the running code cannot break it.
-- The direction that WOULD be dangerous is the reverse order: dropping them
-- before slice 0 deployed.

DROP TRIGGER IF EXISTS customers_mint_party ON "customers";
--> statement-breakpoint
DROP TRIGGER IF EXISTS vendors_mint_party ON "vendors";
--> statement-breakpoint
DROP FUNCTION IF EXISTS app_mint_party_for_role();
