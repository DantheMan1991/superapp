import { config } from "dotenv";

/**
 * The environment the instance-migration scripts run in.
 *
 * `dotenv/config` reads `.env` and nothing else. The cutover's extra keys
 * (`CLERK_TARGET_SECRET_KEY`, and `CLERK_SOURCE_SECRET_KEY` if ever set)
 * live in `.env.local`, so that `.env` — what local development and the
 * tests read — is never edited for a one-off. `.env.local` is read FIRST,
 * so anything both files define takes the `.env.local` value, which is the
 * precedence Next.js gives it and the one a laptop already relies on for
 * `DATABASE_URL`.
 */
config({ path: ".env.local" });
config({ path: ".env" });
