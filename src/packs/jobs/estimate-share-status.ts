/**
 * WHAT A CLIENT LINK'S STANDING IS, DERIVED (E5c, ADR 0085).
 *
 * Pure, no database, no clock of its own. The same rule the pack uses for a
 * warranty period, a bond, a lien waiver and a subcontractor's insurance:
 * **the standing is not a column, it is a reading of the facts.** Nothing
 * sweeps these rows to mark them expired, and nothing can be stale.
 *
 * There are two audiences and they get different amounts of truth. The
 * BUILDER sees which of these it is, because they need to know whether to
 * re-send the link or chase the client. A VISITOR is told only that a link is
 * not available, and never which reason — see `GENERIC_GONE` at the route.
 */

export type ShareStanding =
  /** Open, unsigned, not expired: the client can read and accept. */
  | "open"
  /** Accepted on this link, and the estimate has not moved since. */
  | "signed"
  /** The builder took it back. */
  | "revoked"
  /** Past its date. A proposal that has expired should not still open. */
  | "expired"
  /**
   * Signed, and the ESTIMATE HAS CHANGED SINCE. The link is dead: it cannot
   * go on showing a document that is not the one that was signed, and it must
   * not offer a second signature against different content. The signature
   * itself stays — it is what was agreed to, and the record says at which
   * version. The builder makes a new link for a revision.
   */
  | "superseded";

export interface ShareFacts {
  revokedAt: Date | null;
  expiresAt: Date;
  signedAt: Date | null;
  signedEstimateVersion: number | null;
  /** The estimate's version right now. */
  estimateVersion: number;
}

/**
 * Order matters and is the point. Revoked beats everything, because it is the
 * builder saying no. Expiry beats a signature, so an expired link stops
 * opening even though its signature stands. And a signature against a version
 * the estimate has left behind is `superseded`, which is the only one of these
 * that is a fact about two rows rather than one.
 */
export function shareStanding(facts: ShareFacts, now: Date): ShareStanding {
  if (facts.revokedAt !== null) return "revoked";
  if (facts.expiresAt.getTime() <= now.getTime()) return "expired";
  if (facts.signedAt !== null) {
    return facts.signedEstimateVersion === facts.estimateVersion ? "signed" : "superseded";
  }
  return "open";
}

/** Only an open link serves the document; everything else is gone to a visitor. */
export function shareOpens(standing: ShareStanding): boolean {
  return standing === "open" || standing === "signed";
}

/** And only an open one may be signed — a signed link cannot be signed twice. */
export function shareAcceptsSignature(standing: ShareStanding): boolean {
  return standing === "open";
}

/** What the builder reads in the list. Never shown to a visitor. */
export const SHARE_STANDING_LABELS: Record<ShareStanding, string> = {
  open: "Open",
  signed: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
  superseded: "Estimate changed",
};
