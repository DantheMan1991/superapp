import type { DocumentVisibility, ShareStatus } from "@/db/schema";

/**
 * A share's status is DERIVED, never stored.
 *
 * A status column would need updating from four different places — revoke,
 * expiry, use exhaustion, and a folder's visibility changing underneath it —
 * and the one that got missed would be a link that kept working after it
 * should have stopped. Computing it makes "should this still open?" a single
 * pure function with a truth table.
 */

export interface ShareStatusInput {
  revokedAt: Date | null;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  failedUnlockCount: number;
  createdRootVisibility: string;
  /** The root's visibility NOW; null when the root has been deleted. */
  currentRootVisibility: DocumentVisibility | null;
}

/** Ten wrong passcodes and the link locks until an owner resets it. */
export const MAX_FAILED_UNLOCKS = 10;

/**
 * Precedence matters and is deliberate: a revoked link reports "revoked" even
 * if it also expired, because that is the state an owner acted on. Every
 * non-active status is rendered identically to the public — the distinction
 * exists for the tenant's own management screen.
 */
export function resolveShareStatus(
  share: ShareStatusInput,
  now: Date = new Date(),
): ShareStatus {
  if (share.revokedAt !== null) return "revoked";
  if (share.currentRootVisibility === null) return "revoked";

  // The root got stricter after the link went out. Do not keep serving a
  // subtree the owner has since closed — make them look at it and re-issue.
  if (
    share.createdRootVisibility === "members" &&
    share.currentRootVisibility === "owners"
  ) {
    return "suspended";
  }

  if (share.failedUnlockCount >= MAX_FAILED_UNLOCKS) return "locked";
  if (share.expiresAt.getTime() <= now.getTime()) return "expired";
  if (share.maxUses !== null && share.useCount >= share.maxUses) {
    return "exhausted";
  }
  return "active";
}

export function isShareOpen(
  share: ShareStatusInput,
  now: Date = new Date(),
): boolean {
  return resolveShareStatus(share, now) === "active";
}

/** Human wording for the tenant's own list. Never shown to a link recipient. */
export function shareStatusLabel(status: ShareStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
    case "exhausted":
      return "Used up";
    case "locked":
      return "Locked — too many passcode attempts";
    case "suspended":
      return "Suspended — folder visibility changed";
  }
}
