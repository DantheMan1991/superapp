import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { loadCertificate, renderCertificate } from "@/packs/jobs/certificate";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/**
 * A pay application as a PDF: the certificate page and the continuation
 * sheet (slice 5e, ADR 0063). A GET route for the same reason the invoice
 * PDF is one — a file somebody prints, signs and sends — and the same gates:
 * tenant, module, then RLS proves the application is the caller's. Any
 * member may print; the figures are the ones the contract page already
 * shows them. Rendered on request from the frozen certificate, never stored.
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

  const loaded = await withTenant(
    ctx.tenant.id,
    (tx) => loadCertificate(tx, ctx.tenant.id, id),
    { role: ctx.role },
  );
  if (!loaded) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { bytes, filename } = await renderCertificate(loaded);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // inline: the browser previews it, and Save is one more click away.
      "Content-Disposition": `inline; filename="${filename}"`,
      // A draft's PDF changes whenever the draft does.
      "Cache-Control": "private, no-store",
    },
  });
}
