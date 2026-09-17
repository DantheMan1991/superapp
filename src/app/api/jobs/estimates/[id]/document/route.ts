import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { withLogoBytes } from "@/modules/accounting/invoicing/invoice-brand";
import { loadBrochureExtras, loadProposal, proposalDocumentFrom } from "@/packs/jobs/proposal";
import { renderProposalHtml } from "@/packs/jobs/proposal-html";
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
 * It is deliberately the same URL a client link will serve and a headless
 * print will consume, so there is one document and three doors onto it rather
 * than three documents.
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
  const today = todayInTimezone(timeZone);
  const loaded = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const proposal = await loadProposal(tx, ctx.tenant.id, id);
      if (!proposal) return null;
      // Only the brochure has a page for either, so the letter costs two queries less.
      const extras =
        proposal.data.row.estimate.format === "brochure"
          ? await loadBrochureExtras(
              tx,
              ctx.tenant.id,
              proposal.data.row.estimate.projectId,
              proposal.data.row.estimate.letter,
              timeZone,
              today,
            )
          : {};
      return { proposal, extras };
    },
    { role: ctx.role },
  );
  if (!loaded) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const brand = await withLogoBytes(loaded.proposal.brand);
  const doc = proposalDocumentFrom(
    loaded.proposal.data,
    {
      businessName: loaded.proposal.brand.businessName,
      tagline: brand.tagline,
      primaryColor: brand.primaryColor,
      logo: brand.logo,
    },
    loaded.extras,
  );
  const html = renderProposalHtml(doc, {
    businessName: loaded.proposal.brand.businessName,
    tagline: brand.tagline,
    primaryColor: brand.primaryColor,
    logo: brand.logo,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
