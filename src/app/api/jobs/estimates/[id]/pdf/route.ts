import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { PrintUnavailableError } from "@/lib/pdf/print-press";
import { todayInTimezone } from "@/lib/timezone";
import { loadProposalDocument, proposalPdf } from "@/packs/jobs/proposal";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";
/**
 * A brochure is printed by a headless Chromium, and a cold one downloads and
 * inflates its own binary before it can (E5b, ADR 0084). A letter needs none
 * of that and returns in well under a second.
 */
export const maxDuration = 60;

/**
 * An estimate as the proposal the client is sent (slice 10b, ADR 0070). A
 * GET route for the same reason the pay application's certificate is one —
 * a file somebody prints, signs and sends — and the same gates: tenant,
 * module, then RLS proves the estimate is the caller's. Any member may
 * print; the figures are the ones the estimate's page already shows them,
 * at their price. Rendered on request, never stored: a draft's proposal
 * changes whenever the draft does, and an accepted one cannot change.
 *
 * **THE FORMAT PICKS THE ENGINE** (E5b, ADR 0084): a letter is react-pdf, a
 * brochure is this URL's own HTML through a browser. One address for "the PDF
 * of this proposal", so the button never has to know which.
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

  let printed: { bytes: Uint8Array; filename: string };
  try {
    printed = await proposalPdf(loaded);
  } catch (err) {
    /**
     * **A DEAD END IS WORSE THAN A PLAIN ANSWER.** A brochure whose print
     * cannot run must not fall back to the letter's PDF — that is the silent
     * wrong document this slice exists to end — and must not be a blank 500
     * either. So it says what happened and points at the document itself,
     * which any browser can print with `Print` and `Save as PDF`.
     */
    const configured = !(err instanceof PrintUnavailableError);
    if (configured) console.error("[jobs] brochure print failed", err);
    return new Response(cannotPrint(id, configured), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  // Copied into a plain ArrayBuffer, which is the only view `BodyInit` takes.
  return new Response(new Uint8Array(printed.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // inline: the browser previews it, and Save is one more click away.
      "Content-Disposition": `inline; filename="${printed.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** The one page in this repo that is a document's apology. Plain on purpose. */
function cannotPrint(id: string, configured: boolean): string {
  const why = configured
    ? "The print did not finish. It has been logged."
    : "This deployment has no browser to print a brochure with.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>The brochure could not be printed</title>
<style>
  body { margin: 0; background: #f3f4f6; color: #111827;
         font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 34rem; margin: 12vh auto; padding: 32px; background: #fff; border-radius: 10px;
         box-shadow: 0 1px 3px rgba(0,0,0,.14), 0 8px 24px rgba(0,0,0,.06); }
  h1 { font-size: 1.2rem; margin: 0 0 10px; }
  p { margin: 0 0 12px; }
  a { color: #1d4ed8; }
</style></head>
<body><main>
  <h1>The brochure could not be printed</h1>
  <p>${why}</p>
  <p>The proposal itself is fine — <a href="/api/jobs/estimates/${encodeURIComponent(id)}/document">open the
  document</a> and print it from your browser, choosing <strong>Save as PDF</strong> as the destination.</p>
</main></body></html>`;
}
