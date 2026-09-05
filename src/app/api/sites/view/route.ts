import { NextRequest, NextResponse } from "next/server";
import { recordSiteView } from "@/lib/sites/views";
import { ViewBeaconSchema } from "@/lib/sites/views-core";

export const runtime = "nodejs";

/**
 * The page-view beacon — PUBLIC, unauthenticated by design (ADR 0022).
 *
 * A browser on a tenant's site posts `{ site, path, first }` once per page
 * load. Under the platform's `/api/` prefix so the proxy leaves it alone on
 * a site's own hostname. Sent as text so `sendBeacon` needs no preflight;
 * parsed as JSON and Zod-checked here.
 *
 * Always 204: a bad body, an unknown site and a counted view all look the
 * same from outside, so the beacon cannot be used to ask which addresses
 * exist. A failure to count is logged and never shown — a view that is not
 * counted is not the visitor's problem.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = null;
  }
  const parsed = ViewBeaconSchema.safeParse(body);
  if (parsed.success) {
    try {
      await recordSiteView(parsed.data);
    } catch (err) {
      console.error("site view: not counted", err instanceof Error ? err.message : err);
    }
  }
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
