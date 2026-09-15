import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { loadProposal, renderProposal } from "@/packs/jobs/proposal";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/**
 * An estimate as the proposal the client is sent (slice 10b, ADR 0070). A
 * GET route for the same reason the pay application's certificate is one —
 * a file somebody prints, signs and sends — and the same gates: tenant,
 * module, then RLS proves the estimate is the caller's. Any member may
 * print; the figures are the ones the estimate's page already shows them,
 * at their price. Rendered on request, never stored: a draft's proposal
 * changes whenever the draft does, and an accepted one cannot change.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.tenant.id, PACK))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const loaded = await withTenant(ctx.tenant.id, (tx) => loadProposal(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!loaded) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { bytes, filename } = await renderProposal(loaded);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // inline: the browser previews it, and Save is one more click away.
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
