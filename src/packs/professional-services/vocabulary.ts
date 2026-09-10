/**
 * Professional-services vocabulary. NO IMPORTS AND NO DIRECTIVE, deliberately —
 * these values are rendered in the browser by pickers, and importing them
 * from the schema would drag drizzle into that bundle (the trap documents.md
 * wrote up). `src/packs/assets/vocabulary.ts` is the precedent.
 */

/**
 * SUGGESTIONS, NOT A CONSTRAINT. `ps_engagements.kind` is an open taxonomy:
 * the database checks the format of the column and never its values. These
 * are the neutral shapes every services business bills in; a profile adds
 * its own through `packConfig["professional-services"].kinds`, and a tenant
 * types one nobody listed.
 */
export const SUGGESTED_ENGAGEMENT_KINDS = ["retainer", "project", "hourly"] as const;

/** Mirrors the `ps_engagements_kind_format` CHECK. */
export const ENGAGEMENT_KIND_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidEngagementKind(kind: string): boolean {
  return ENGAGEMENT_KIND_FORMAT.test(kind);
}

/** "fixed_fee" → "Fixed fee". Kinds are slugs; people are not. */
export function engagementKindLabel(kind: string): string {
  const spaced = kind.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const ENGAGEMENT_STATUSES = ["proposed", "active", "paused", "ended"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export function isEngagementStatus(value: string): value is EngagementStatus {
  return (ENGAGEMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Where an engagement may go from where it is. A proposal starts; live work
 * pauses or ends; a pause resumes or ends; an ended engagement reopens —
 * ending is reversible, which is why nothing here asks twice.
 */
const TRANSITIONS: Record<EngagementStatus, readonly EngagementStatus[]> = {
  proposed: ["active", "ended"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: ["active"],
};

export function canTransition(from: EngagementStatus, to: EngagementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: EngagementStatus): readonly EngagementStatus[] {
  return TRANSITIONS[from];
}

/** The verb on the button that moves an engagement from `from` to `to`. */
export function transitionVerb(from: EngagementStatus, to: EngagementStatus): string {
  if (to === "active") return from === "paused" ? "Resume" : from === "ended" ? "Reopen" : "Start";
  if (to === "paused") return "Pause";
  return "End";
}

/** What the toast says once the move is made. */
export function transitionDone(from: EngagementStatus, to: EngagementStatus): string {
  if (to === "active") return from === "paused" ? "Resumed" : from === "ended" ? "Reopened" : "Started";
  return to === "paused" ? "Paused" : "Ended";
}

export function engagementStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * "1:30", "1.5", "90m", "90" — the ways somebody writes an hour and a half.
 *
 * A time box that only takes decimal hours is a box people get wrong twice a
 * day, so this reads what they actually type. Bare numbers under 16 are read
 * as HOURS, which is the common case ("2" is two hours, not two minutes); a
 * bare number of 16 or more is read as minutes, because nobody logs a
 * sixteen-hour day and everybody logs ninety minutes. Returns 0 when it
 * cannot tell, and the caller refuses rather than guessing.
 */
export function parseDuration(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (!s) return 0;
  const colon = s.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const withUnit = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)$/);
  if (withUnit) {
    const n = Number(withUnit[1]);
    return withUnit[2].startsWith("h") ? Math.round(n * 60) : Math.round(n);
  }
  const bare = Number(s);
  if (!Number.isFinite(bare) || bare <= 0) return 0;
  return bare < 16 ? Math.round(bare * 60) : Math.round(bare);
}
