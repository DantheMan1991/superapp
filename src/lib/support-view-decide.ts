/**
 * Whether a request may be answered AS A SUPPORT VIEW (back-office slice 4).
 *
 * A support session lets a superadmin look at a client's workspace as its
 * staff see it. The rule that makes it safe is simple enough to be pure:
 * a live session is honoured for a GET and for nothing else. A server action
 * arrives as a POST carrying a `next-action` header; a route handler that
 * changes anything is not a GET. Both are REFUSED outright while a session is
 * live — not answered under the superadmin's own workspace, which would land
 * a client's ids in the wrong tenant, and not answered under the client's,
 * which would be a write. The wall is here, once, instead of in every action.
 *
 * Import-free so it can be tested without a request.
 */

export interface SupportSessionFacts {
  expiresAt: Date;
  endedAt: Date | null;
}

export interface SupportRequestFacts {
  /** The HTTP method as the middleware stamped it — never as a client said. */
  method: string;
  /** True when the request carries a `next-action` header. */
  isAction: boolean;
  now: Date;
}

export type SupportDecision =
  | { kind: "none" }
  | { kind: "view" }
  | { kind: "refuse"; reason: "action" | "method" };

export function decideSupportView(
  session: SupportSessionFacts | null,
  facts: SupportRequestFacts,
): SupportDecision {
  if (!session || session.endedAt !== null || session.expiresAt <= facts.now) {
    return { kind: "none" };
  }
  if (facts.isAction) return { kind: "refuse", reason: "action" };
  // An unstamped method — the middleware did not run — reads as not-a-GET:
  // the safe way round.
  if (facts.method !== "GET" && facts.method !== "HEAD") {
    return { kind: "refuse", reason: "method" };
  }
  return { kind: "view" };
}

/** How long a support view lasts. Long enough for a call; short enough to be forgotten safely. */
export const SUPPORT_SESSION_MINUTES = 60;

export function supportExpiry(from: Date): Date {
  return new Date(from.getTime() + SUPPORT_SESSION_MINUTES * 60_000);
}
