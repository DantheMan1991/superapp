import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { loadOrderPaper, renderOrderPaper } from "@/packs/jobs/paper";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/**
 * A purchase order or a subcontract as the document the vendor signs
 * (ADR 0075): the order as placed, its change orders beneath it with where
 * each stands, the total that counts only the approved ones. The same gates
 * as every printed document here — tenant, module, RLS — and any member may
 * print. Rendered on request, never stored: an issued order's lines are
 * locked (ADR 0065), so the live rows are the agreement.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The BUSINESS has the tool AND this PERSON may reach it (ADR 0096).
  const refused = await routeGate(ctx.tenant.id, PACK, ["jobs:commitments", "jobs:ordered"]);
  if (refused) return refused;

  const loaded = await withTenant(ctx.tenant.id, (tx) => loadOrderPaper(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { bytes, filename } = await renderOrderPaper(loaded);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
