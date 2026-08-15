import { Pool } from "@neondatabase/serverless";
import { assertNoBypassRls, provisionAppUser } from "./lib/app-role";
import { configureNeonForLocalProxy } from "./lib/neon-local";

/**
 * Provision the throwaway Postgres that runs the database suite inside a CI
 * runner. Non-interactive, and it rewrites no files.
 *
 * WHY THIS EXISTS. The suite was latency-bound: 1465 of 1519 seconds were spent
 * waiting on round trips to Neon, and the SAME suite cost 717s on one run and
 * 1519s on the next because the wire got slower. A Postgres in the runner makes
 * a round trip sub-millisecond, so the suite stops being a progress bar for the
 * network — and every run gets its own database, which also removes the
 * repo-wide `db-tests` queue and the shared-branch collision risk.
 *
 * IT CREATES `app_user` IN SQL, AND THAT IS THE LOAD-BEARING PART. The
 * isolation suite certifies that RLS stops one tenant reading another's rows —
 * which is only a test at all if the connection cannot bypass RLS. The
 * superuser the container starts as can. So can any role a provider's API would
 * mint (Neon's carry `neon_superuser`), which is the trap this repo has always
 * avoided by creating the role with plain SQL. `assertNoBypassRls` is the
 * backstop, and a failure there stops the run rather than warning.
 *
 * It connects through the same WebSocket proxy the suite will use, so a
 * misconfigured proxy fails HERE — in a two-second step with a clear message —
 * rather than as sixty confusing test failures.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`::error::${name} is not set`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (!configureNeonForLocalProxy()) {
    console.error(
      "::error::NEON_LOCAL_PROXY is not set. This script only provisions the " +
        "throwaway CI database, never a real one.",
    );
    process.exit(1);
  }

  const ownerUrl = required("CI_POSTGRES_OWNER_URL");
  const appPassword = required("CI_APP_USER_PASSWORD");

  const pool = new Pool({ connectionString: ownerUrl });
  const query = async (text: string) => {
    const result = await pool.query(text);
    return { rows: result.rows as unknown[] };
  };

  await provisionAppUser(query, appPassword);
  await assertNoBypassRls(query);

  // A superuser is not subject to RLS either, and `rolbypassrls` is false for
  // one — so the two checks are not the same check.
  const superuser = await query(
    `select rolsuper from pg_roles where rolname = 'app_user'`,
  );
  if ((superuser.rows[0] as { rolsuper?: boolean })?.rolsuper) {
    console.error("::error::app_user is a superuser — RLS would not apply.");
    process.exit(1);
  }

  await pool.end();
  console.log("app_user provisioned, and it cannot bypass RLS.");
}

main().catch((err) => {
  console.error(`::error::${(err as Error).message}`);
  process.exit(1);
});
