import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { loadProposalDocument, proposalHtml } from "@/packs/jobs/proposal";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/**
 * The proposal as an HTML DOCUMENT (E5a, ADR 0083) — the brochure for a custom
 * home, the letter for everything else, whichever the estimate names.
 *
 * A GET route and not a page, because it is a document rather than a screen:
 * no sidebar, no nav, its own type and its own page breaks. Same gates as the
 * PDF beside it — tenant, module, then RLS proves the estimate is the
 * caller's — and the same rule: **rendered on request, never stored**, so a
 * draft's brochure is the draft as it stands and an accepted one cannot move.
 *
 * It is the same URL a client link will serve, and since E5b the PDF beside it
 * is a print of the very string this returns rather than a second rendering —
 * one document, three doors.
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

  const timeZone = ctx.tenant.timezone;
  const loaded = await withTenant(
    ctx.tenant.id,
    (tx) => loadProposalDocument(tx, ctx.tenant.id, id, timeZone, todayInTimezone(timeZone)),
    { role: ctx.role },
  );
  if (!loaded) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new Response(await proposalHtml(loaded), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
