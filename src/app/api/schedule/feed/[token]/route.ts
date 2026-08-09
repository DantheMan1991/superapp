import { NextRequest } from "next/server";
import { serveFeed } from "@/modules/scheduling/feed-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A person's calendar, as an iCalendar feed for their phone.
 *
 * ============================================================================
 * THE ONLY UNAUTHENTICATED ROUTE IN THE PRODUCT THAT SERVES TENANT DATA.
 * ============================================================================
 *
 * There is no session: a calendar subscription is fetched by iOS or Google on
 * a schedule, with no cookie and no way to sign in. The token in the path is
 * the entire credential.
 *
 * `clerkMiddleware()` attaches auth context and never enforces it (src/proxy.ts),
 * so nothing had to be excluded for this to be reachable — which cuts both
 * ways, and is why the safety lives here and in `serveFeed`:
 *
 *  • The token is looked up BY HASH; the plaintext is never stored.
 *  • `serveFeed` uses `withSystem` for exactly one query — turning the hash into
 *    a person — and then reopens as that person for everything else.
 *  • A revoked token, an unknown token and a token whose owner has left the
 *    workspace all return the SAME 404. Distinguishing them would confirm which
 *    tokens exist to somebody guessing.
 *
 * `Cache-Control: no-store` because a shared cache holding somebody's calendar
 * keyed by a URL that is itself the credential is a second copy nobody can
 * revoke.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  // Cheap shape check before touching the database, so a scanner hitting this
  // path with junk costs a string comparison rather than a query.
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const result = await serveFeed(token);
  if (!result) return new Response("Not found", { status: 404 });

  return new Response(result.ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Some clients decide how to treat the response from the filename rather
      // than the content type, so it carries an .ics one even though the path
      // has no extension.
      "Content-Disposition": 'inline; filename="yosher.ics"',
      "Cache-Control": "no-store, private",
      // A calendar client following a redirect chain across origins would leak
      // the token in a Referer. Nothing here redirects, but say so anyway.
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
