import "dotenv/config";
import { deleteTestTenants, formatReport } from "./test-tenants";

/**
 * Sweeps stale test tenants before the suite runs.
 *
 * Why here and not in a teardown: the suites already clean up after
 * themselves in `afterAll`, and the rows that survive are precisely the ones
 * from runs that never got there (Ctrl-C, timeout, editor restart). A
 * teardown can't fix those; the next run can.
 *
 * Why an age filter: this database is shared, and two runs can overlap. The
 * full suite takes ~9 minutes, so anything older than an hour cannot belong
 * to a run currently in flight. Override with TEST_TENANT_STALE_MINUTES;
 * `npm run db:clean-test-tenants -- --yes` is the no-waiting version.
 */
const STALE_MINUTES = Number(process.env.TEST_TENANT_STALE_MINUTES ?? 60);

export async function setup() {
  if (!process.env.DATABASE_URL) return;
  try {
    const report = await deleteTestTenants(STALE_MINUTES);
    if (report.tenants.length || report.profiles || report.interviewSessions) {
      console.log(
        `\n🧹 Swept ${report.tenants.length} stale test tenant(s) (>${STALE_MINUTES}m old) ` +
          `left by an interrupted run:\n${formatReport(report)}\n`,
      );
    }
  } catch (err) {
    // Never fail the run over housekeeping — the isolation certification
    // matters more than a tidy CRM list.
    console.warn("⚠ stale test-tenant sweep failed (continuing):", err);
  }
}
