import { cache } from "react";

/**
 * WHO IS MAKING THIS REQUEST, resolved without being told (ADR 0094).
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * Company scoping has to be enforced by Postgres, which means a policy needs to
 * know who is asking. Every other piece of RLS context is passed in by the
 * caller — and `withTenant` has **877 call sites**. An optional argument that
 * grants full access to every company when omitted is not a boundary; it is a
 * boundary with 877 chances to be forgotten, and the one that is forgotten is
 * silent. Making it mandatory would be a compiler-checked sweep of 877 files,
 * which buries the change it is part of and is unreviewable.
 *
 * So the transaction resolves the caller itself, from the session, and no call
 * site can leave it out.
 *
 * ── WHY NOT THE OBVIOUS WAYS ────────────────────────────────────────────────
 *
 * **Not `requireTenant()`.** `src/db` cannot import `src/lib/auth`, which
 * imports `src/db` — the header on `withTenant` already notes that cycle and
 * inlines a type to avoid it.
 *
 * **Not `AsyncLocalStorage`.** It needs a callback enclosing the work, and
 * `requireTenant()` returns a value rather than wrapping the render. Nothing in
 * an App Router request is positioned to open that scope: middleware runs on a
 * different runtime and does not enclose the RSC render.
 *
 * **`auth()` needs neither.** It is Clerk's own request-scoped read, it does not
 * import anything of ours, and `cache` collapses it to once per request.
 *
 * ── AND WHY IT IS A SEPARATE SETTING FROM `app.clerk_user_id` ───────────────
 *
 * That one is the MAIL seam (`drizzle/0043`), and its documented contract is
 * that a caller who forgets it sees NOTHING — the least privileged value.
 * Quietly filling it in from the session would turn "forgot, so saw nothing"
 * into "forgot, so saw their own", on tables holding private correspondence,
 * with no test anywhere asserting the difference. `app.acting_user` is new,
 * carries only the company scope, and leaves that contract exactly as it was.
 *
 * ── WHAT "NO CALLER" MEANS ──────────────────────────────────────────────────
 *
 * Empty, for a seed, a script, a cron or a test — anything with no request to
 * read. `app_entity_scope()` finds no membership for an empty user and answers
 * "unrestricted", which is what those callers have always had and must keep:
 * the isolation suite calls `withTenant` directly, outside any request, and
 * exists to prove what the TENANT boundary does.
 *
 * **That is the one soft edge in this design and it is worth naming.** The
 * scope is only as good as "every real request has a session", which is true
 * because `auth()` is what Clerk's own middleware has already established by
 * the time any page or action runs. A request that somehow had none would be
 * unrestricted — and would also have failed `requireTenant()` long before
 * reaching a query.
 */
export const actingClerkUserId = cache(async (): Promise<string> => {
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    return userId ?? "";
  } catch {
    // No request scope: a script, a seed, a test, or a cron. Not an error, and
    // deliberately not logged — it is the ordinary case for those callers.
    return "";
  }
});
