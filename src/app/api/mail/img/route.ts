import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { fetchRemoteImage } from "@/lib/net/fetch-image";
import { verifyImageClaim } from "@/modules/email/render/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The remote-image proxy.
 *
 * Exists so that unblocking images does not tell the sender who read the
 * message. Loading a tracking pixel directly hands them the reader's IP,
 * user agent and the exact moment they opened it; fetched here, they learn only
 * that somebody did.
 *
 * It also keeps the frame's CSP absolute: every image is `'self'`, so
 * `img-src 'self'` never has to be relaxed and there is no permissive mode of
 * the policy to get wrong.
 *
 * THE URL IS NOT A PARAMETER THE CALLER CHOOSES. It is inside a signed claim
 * minted during sanitization, for one tenant and one user, so this route can
 * only ever fetch addresses that already appeared in a message that person
 * opened. Without that, this endpoint would be an open SSRF proxy wearing our
 * server's network position.
 */

const notFound = () =>
  new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });

export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (ctx.role === "expert") return notFound();
  if (!(await isModuleEnabled(ctx.tenant.id, "email"))) return notFound();

  const query = new URL(request.url).searchParams;
  const url = query.get("u") ?? "";
  const expiresAt = Number(query.get("exp") ?? "0");
  const signature = query.get("sig") ?? "";
  if (!url || !Number.isFinite(expiresAt) || expiresAt <= 0) return notFound();

  // Rebuilt from the LIVE session, so a URL minted for somebody else cannot
  // verify here. Checked before any network work — a flood of forged links
  // costs one HMAC each and nothing else.
  const claim = {
    tenantId: ctx.tenant.id,
    clerkUserId: ctx.userId,
    url,
    expiresAt,
  };
  if (!verifyImageClaim(claim, signature)) return notFound();

  const image = await fetchRemoteImage(url);
  // A blocked or broken image is a 404, not an explanation. The reader sees a
  // missing image; nobody gets a probe oracle for what our network can reach.
  if (!image.ok) return notFound();

  return new Response(new Uint8Array(image.body), {
    status: 200,
    headers: {
      // The SNIFFED type, never the one the remote server claimed.
      "Content-Type": image.contentType,
      "Content-Length": String(image.body.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      // Short and private: this is one person's correspondence, and a message
      // reopened a minute later should not re-hit the sender's server.
      "Cache-Control": "private, max-age=600",
    },
  });
}
