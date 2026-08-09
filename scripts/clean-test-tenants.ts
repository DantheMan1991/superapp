import "dotenv/config";
import {
  deleteTestTenants,
  findTestTenants,
  formatReport,
  TEST_STAMP_PATTERN,
} from "../tests/test-tenants";

/**
 * Removes the tenants left behind by interrupted test runs — the suites stamp
 * every row they create with `<prefix>-${process.pid}` and delete it in
 * afterAll, so anything still matching that shape is from a run that was
 * killed. See tests/test-tenants.ts for the pattern.
 *
 *   npm run db:clean-test-tenants                  # dry run — lists, deletes nothing
 *   npm run db:clean-test-tenants -- --yes         # delete them
 *   npm run db:clean-test-tenants -- --yes --older-than=60
 *
 * --older-than=<minutes> spares anything younger, so a suite currently
 * running against the same database is left alone.
 */
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--yes");
  const olderThanArg = args.find((a) => a.startsWith("--older-than="));
  const olderThanMinutes = olderThanArg ? Number(olderThanArg.split("=")[1]) : 0;

  if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
    console.error("--older-than must be a non-negative number of minutes.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. See SETUP.md.");
    process.exit(1);
  }

  console.log(`Matching slugs: ${TEST_STAMP_PATTERN}`);
  if (olderThanMinutes) console.log(`Only rows older than ${olderThanMinutes} minute(s).`);

  const report = apply
    ? await deleteTestTenants(olderThanMinutes)
    : await findTestTenants(olderThanMinutes);

  if (!report.tenants.length && !report.profiles && !report.interviewSessions) {
    console.log("\nNothing to clean — no stamped test rows found.");
    process.exit(0);
  }

  console.log(`\n${apply ? "Deleted" : "Would delete"} ${report.tenants.length} tenant(s):`);
  console.log(formatReport(report));
  if (!apply) console.log("\nDry run. Re-run with --yes to delete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
