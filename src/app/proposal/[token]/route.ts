import { NextRequest } from "next/server";
import { hashIp } from "@/lib/public-token";
import { countShareView } from "@/packs/jobs/estimate-shares";
import { proposalHtml } from "@/packs/jobs/proposal";
import { GENERIC_GONE, resolveProposalShare } from "@/packs/jobs/proposal-share";
import { goneHtml } from "./gone";

export const runtime = "nodejs";

/**
 * A CLIENT'S COPY OF A PROPOSAL (E5c, ADR 0085).
 *
 * The third door onto the document ADR 0083 built, and the one with no
 * session behind it: the same sections, the same stylesheet, the same page
 * order, served to whoever holds 256 bits of token. A GET route rather than a
 * page for the reason 0083 gave — a document is not a screen — and now for a
 * second one: there is no app around this, so there is nothing for a page to
 * inherit.
 *
 * **Every failure is the same answer.** Unknown, revoked, expired, already
 * accepted, estimate revised, pack switched off, business gone: one page, so
 * a visitor cannot learn from it that a token was nearly right or that a
 * proposal was withdrawn. `resolveProposalShare` is where that is enforced.
 *
 * **NO SERVER-PRINTED PDF LIVES HERE.** The PDF route beside the dashboard
 * runs a browser (E5b), and an anonymous caller who could trigger that would
 * be an unbounded CPU and egress amplifier for anyone holding one leaked
 * link. The client gets a PDF the way they already could: the Print control
 * on the document, which costs this server nothing.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const ipHash = hashIp(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "");

  const resolved = await resolveProposalShare(token, ipHash);
  if (!resolved.ok) return gone();

  // Counted after the gates and before the render; a failure to count must
  // never be a failure to serve, so it is not awaited into the response.
  await countShareView(resolved.tenantId, resolved.share.id).catch(() => undefined);

  const html = await proposalHtml(resolved.loaded, {
    acceptUrl: `/proposal/${encodeURIComponent(token)}/accept`,
    estimateVersion: resolved.loaded.data.row.estimate.version,
    signed:
      resolved.share.signedAt && resolved.share.signedName
        ? { name: resolved.share.signedName, on: dayOf(resolved.share.signedAt) }
        : null,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never cached anywhere: this is one client's private document.
      "Cache-Control": "private, no-store",
      // Nothing here should be framed, sniffed, or leak its token in a referer.
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      // A proposal is not search-engine material, whoever has the link.
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

/** `14 October 2026`, in the reader's own words rather than a timestamp. */
function dayOf(at: Date): string {
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function gone(): Response {
  return new Response(goneHtml(GENERIC_GONE), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
