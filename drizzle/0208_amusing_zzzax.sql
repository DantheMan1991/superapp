-- payment_accounts: drop v1's vocabulary. Paired with 0209, which adds v2's.
--
-- WHY THIS EXISTS AT ALL, one migration after the table was created: Stripe
-- began refusing `POST /v1/accounts` for new Connect integrations on
-- 2026-08-25, so this integration moved to Accounts v2 before it had ever
-- created an account. v2's object has no `charges_enabled`, no
-- `payouts_enabled` and no `details_submitted` — it has a capability STATUS and
-- a list of requirements that each say who is holding them up.
--
-- SAFE BECAUSE THE TABLE IS EMPTY. `0206` created it inside this same unmerged
-- branch and nothing ever wrote a row: the first write attempt is what returned
-- the v1 refusal. `0206` is NOT edited in place — it is already applied to both
-- databases, and rewriting an applied migration is the drift ADR 0014 exists to
-- prevent.
--
-- The RLS policies from `0207` survive untouched: they reference `tenant_id`
-- and nothing else, so no policy migration is needed alongside this.
--
-- Split from `0209` so that `drizzle-kit generate` never had to ask whether a
-- dropped column was a rename of an added one — a deletes-only diff and an
-- adds-only diff are both unambiguous, and the prompt cannot be answered in a
-- non-interactive shell.

ALTER TABLE "payment_accounts" DROP COLUMN "charges_enabled";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "payouts_enabled";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "details_submitted";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "disabled_reason";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "requirements_currently_due";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "requirements_past_due";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "business_name";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP COLUMN "deauthorized_at";