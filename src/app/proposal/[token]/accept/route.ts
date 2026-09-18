import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { estimateTotals } from "@/packs/jobs/estimate-math";
import { recordAttempt } from "@/lib/public-limits";
import { hashIp } from "@/lib/public-token";
import { signEstimateShare } from "@/packs/jobs/estimate-shares";
import { shareAcceptsSignature } from "@/packs/jobs/estimate-share-status";
import { proposalHtml } from "@/packs/jobs/proposal";
import { GENERIC_GONE, resolveProposalShare } from "@/packs/jobs/proposal-share";
import { goneHtml } from "../gone";

export const runtime = "nodejs";

/**
 * THE ONE WRITE A STRANGER MAY MAKE (E5c, ADR 0085).
 *
 * No `requireTenant`, by design and exactly like the document share's unlock
 * action: the defences are the 256-bit token, the abuse cap, Zod at the
 * boundary, a version check, and answers that give nothing away. The tenant
 * is never taken from the request — it comes from the token, through the one
 * `withSystem` lookup in `resolveProposalShare`, and the write itself runs
 * under `withTenant` where RLS governs it.
 *
 * **IT DOES NOT ACCEPT THE ESTIMATE.** It records that somebody holding the
 * link put a name to this proposal, with the version and total as they stood.
 * `acceptEstimate` wants an owner and the contract the estimate priced, and a
 * client has neither — so the business still accepts it, with this in front of
 * them as the reason to.
 *
 * A form POST rather than a server action, because the document is plain HTML
 * with no React around it. The answer is the same page re-rendered, which is
 * also what a reload after it gets.
 */

const acceptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.coerce.number().int().min(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const ipHash = hashIp(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "");

  // Counted before anything is looked up, so hammering the endpoint costs the
  // attacker the cap rather than costing us the queries.
  const capped = await recordAttempt("proposal_sign", ipHash);
  if (capped.overCap) return gone();

  const resolved = await resolveProposalShare(token, ipHash);
  if (!resolved.ok) return gone();
  const { share, standing, loaded } = resolved;

  const form = await req.formData().catch(() => null);
  const parsed = acceptSchema.safeParse({
    name: form?.get("name"),
    version: form?.get("version"),
  });
  if (!parsed.success) {
    return page(resolved, token, "Please type your full name.");
  }

  // Already accepted, revoked or expired: the page says what it is, and the
  // standing has already been checked once by the resolver.
  if (!shareAcceptsSignature(standing)) {
    return page(resolved, token, null);
  }

  /**
   * **THE VERSION THE CLIENT WAS SHOWN IS CHECKED, NOT TRUSTED.** If the
   * builder edited the estimate between this page loading and the button being
   * pressed, a signature would name a document the client never read. So it is
   * refused and the page reloads with what the estimate says now — the same
   * `STALE_VERSION` discipline every other guarded verb in this pack keeps,
   * pointed at the person with the most to lose from it.
   */
  const current = loaded.data.row.estimate.version;
  if (parsed.data.version !== current) {
    return page(resolved, token, "This proposal was updated while you had it open. Please read it again before accepting.");
  }

  const totals = estimateTotals(
    loaded.data.row.lines,
    loaded.data.row.estimate,
    loaded.data.row.groups,
  );

  try {
    await signEstimateShare(resolved.tenantId, share.id, {
      name: parsed.data.name,
      ipHash,
      estimateVersion: current,
      totalCents: totals.totalCents,
    });
  } catch {
    // Someone else signed it first, or it closed underneath us. Re-render:
    // the page will show it as accepted, which is the truth either way.
    return page(resolved, token, null);
  }

  /**
   * A redirect, not a rendered body, so a refresh does not re-post the form.
   * 303 rather than 302 because the answer to a POST is a GET, and this is the
   * one status that says so.
   */
  return NextResponse.redirect(new URL(`/proposal/${encodeURIComponent(token)}`, req.url), 303);
}

/** The document again, with a message above the field. Never a bare error. */
async function page(
  resolved: Extract<Awaited<ReturnType<typeof resolveProposalShare>>, { ok: true }>,
  token: string,
  error: string | null,
): Promise<Response> {
  const { share, loaded } = resolved;
  const html = await proposalHtml(loaded, {
    acceptUrl: `/proposal/${encodeURIComponent(token)}/accept`,
    estimateVersion: loaded.data.row.estimate.version,
    signed:
      share.signedAt && share.signedName
        ? {
            name: share.signedName,
            on: share.signedAt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          }
        : null,
    ...(error ? { error } : {}),
  });
  return new Response(html, {
    status: error ? 400 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
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
