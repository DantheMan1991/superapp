import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { loadChangeOrderPaper, renderChangeOrderPaper } from "@/packs/jobs/paper";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/**
 * A change order as the document the client signs (ADR 0075). A GET route
 * for the same reason the proposal and the certificate are: a file somebody
 * prints, signs and sends. The same gates — tenant, module, then RLS proves
 * the change order is the caller's — and any member may print: the figures
 * are the ones the job's Changes tab already shows, at their price.
 * Rendered on request, never stored; a proposed change's paper changes
 * whenever it does, and an approved one is fixed by the rules that fix it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The BUSINESS has the tool AND this PERSON may reach it (ADR 0096).
  const refused = await routeGate(ctx.tenant.id, PACK, ["jobs:changes"]);
  if (refused) return refused;

  const loaded = await withTenant(ctx.tenant.id, (tx) => loadChangeOrderPaper(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { bytes, filename } = await renderChangeOrderPaper(loaded);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
