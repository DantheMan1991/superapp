import { withTenant } from "@/db";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { listPostureChecks } from "@/modules/fitness/posture/check-ops";
import { historyCsv, summarize } from "@/modules/fitness/posture/core/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "DOWNLOAD THE NUMBERS" (docs/help/fitness/posture.md; docs/modules/
 * posture.md, slice 3): every posture check in the account, each measure a
 * row, as a CSV file for a spreadsheet, a trainer or a physiotherapist.
 * Numbers and the report's words only: the account has no pictures to give.
 *
 * The personal space's own door for a route (`resolvePersonalContext`, which
 * answers 401 rather than redirecting), then Workouts' gate, then the space's
 * own rows under RLS.
 */
export async function GET(): Promise<Response> {
  const ctx = await resolvePersonalContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  const refused = await routeGate(ctx.tenant.id, "fitness");
  if (refused) return refused;
  const checks = await withTenant(ctx.tenant.id, (tx) => listPostureChecks(tx, ctx.tenant.id), { role: ctx.role });
  const csv = historyCsv(checks.map(summarize));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="posture-checks-${day}.csv"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
