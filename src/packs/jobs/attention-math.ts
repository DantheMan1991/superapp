/**
 * WHAT A JOB SAYS YOU STILL OWE. Pure — no database, no clock of its own, and
 * the pack's fourth attention source after production's, livestock's and
 * inventory's.
 *
 * **THREE THINGS EVERY SCREEN SHOWED AND NOBODY WAS TOLD.** A client's
 * acceptance has sat on the estimate's page since the link shipped (ADR 0085)
 * and nothing anywhere said so; the board has coloured an overdue selection
 * since ADR 0067; the Subcontractors page has read `expired` since ADR 0068.
 * Every one of them waited for somebody to open the page.
 *
 * An obligation here is **derived, never stored** (the rule in
 * `src/lib/attention-sources/types.ts`), so doing the work makes the line
 * disappear and there is nothing to mark read. All three clear that way:
 *
 *  1. **A client accepted a proposal and nobody has accepted the estimate.**
 *     Clears by accepting it — or by declining it, or by superseding it, which
 *     are the other three honest answers. **This is the one the client is
 *     waiting on**, and it is the reason a business that sends a link should
 *     not have to keep checking the page.
 *  2. **A selection is past the date the client was asked for.** Clears when a
 *     choice is recorded. Money and time both stop while a selection is open,
 *     which is why the date exists at all.
 *  3. **A subcontractor on a live job is not covered.** Expired or never on
 *     file is overdue — an uninsured trade is on site today; expiring within
 *     the month is `soon`, which is the point at which asking is still polite
 *     rather than urgent.
 *
 * ── WHAT IS DELIBERATELY NOT AN OBLIGATION ──────────────────────────────────
 *
 *  1. **A phase running late.** The board says so, and it is the one thing
 *     here that would NOT self-clear by doing the work: schedules slip for
 *     weeks and nobody updates the record daily, so the line would repeat
 *     every morning until somebody moved a date — the accumulating digest
 *     people mute. A late phase needs the schedule screen, not an email.
 *  2. **A proposal nobody has answered.** That is the CLIENT's move, not the
 *     business's, and an obligation belongs to whoever can clear it. Chasing
 *     is a Work item somebody makes on purpose.
 *  3. **A bond near its limit.** Real, and not dated: it is a capacity fact
 *     the bonding page reads, and it clears by winning less work, which is
 *     nobody's morning task.
 */

export type JobsUrgency = "overdue" | "today" | "soon";

/** Structurally an `AttentionItem` — the source spreads it into one. */
export interface JobsAttentionItem {
  key: string;
  title: string;
  detail?: string;
  urgency: JobsUrgency;
  dueOn: string | null;
  href: string;
}

const BASE = "/dashboard/m/jobs";

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no daylight saving. */
function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** "1 certificate" / "3 certificates" — the plural nobody should hand-write twice. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------- 1. a client accepted it */

export interface AcceptedProposal {
  estimateId: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  /** The estimate's own number, as the business writes it: `EST-2`. */
  number: string;
  title: string;
  /** What the client typed. Shown, never treated as identity. */
  signedName: string;
  /** `YYYY-MM-DD` in the tenant's zone. */
  signedOn: string;
  /** Already formatted by the caller — this file holds no money rules. */
  amount: string;
  /**
   * True when the estimate has been edited since the signature. The line is
   * still raised, because the acceptance happened and somebody must answer
   * it; the wording changes so nobody reads a stale price as current.
   */
  movedSince: boolean;
}

/**
 * A client put their name to a proposal and the estimate is still open.
 *
 * **Overdue from the day after they signed.** Acceptance is the one moment in
 * a job where the client has finished and the business has not, and a day is
 * as long as that should sit. The day itself reads `today`, because somebody
 * may already be on it.
 */
export function acceptedProposalAttention(
  rows: readonly AcceptedProposal[],
  today: string,
): JobsAttentionItem[] {
  return rows.map((r) => ({
    key: `jobs:estimate-signed:${r.estimateId}`,
    title: r.movedSince
      ? `${r.signedName} accepted ${r.number}, and it has changed since`
      : `${r.signedName} accepted ${r.number} — ${r.amount}`,
    detail: [
      `${r.projectNumber} · ${r.projectName}`,
      r.title,
      r.movedSince ? `Accepted at ${r.amount} on ${r.signedOn}` : null,
    ]
      .filter((s): s is string => s !== null && s !== "")
      .join(" · "),
    urgency: daysBetween(r.signedOn, today) >= 1 ? "overdue" : "today",
    dueOn: r.signedOn,
    href: `${BASE}/${r.projectId}/estimates/${r.estimateId}`,
  }));
}

/* ------------------------------------------------------ 2. open selections */

export interface OverdueSelections {
  projectId: string;
  projectNumber: string;
  projectName: string;
  overdue: number;
}

/**
 * Selections the client was asked for by a date that has passed. One line per
 * job rather than per selection: they are chased in one conversation, and
 * eleven lines for one kitchen is how a digest stops being read.
 */
export function overdueSelectionAttention(
  jobs: readonly OverdueSelections[],
): JobsAttentionItem[] {
  return jobs
    .filter((j) => j.overdue > 0)
    .map((j) => ({
      key: `jobs:selections-overdue:${j.projectId}`,
      title: `${count(j.overdue, "selection")} still to choose on ${j.projectNumber}`,
      detail: `${j.projectName} · past the date the client was asked for`,
      urgency: "overdue" as const,
      // The dates are per selection and this line is per job, so it carries
      // none rather than picking one of them to speak for the rest.
      dueOn: null,
      href: `${BASE}/${j.projectId}/selections`,
    }));
}

/* ----------------------------------------------------- 3. who is covered */

export interface SubcontractorCover {
  partyId: string;
  partyName: string;
  /** The live jobs this party has an issued or closed order on. */
  projectNumbers: readonly string[];
  /** Required kinds with nothing on file, or a document that has run out. */
  lapsed: readonly string[];
  /** Required kinds running out within the month. */
  expiring: readonly string[];
  /** The soonest date among `expiring`, for the `soon` line. */
  soonestExpiry: string | null;
}

/**
 * A subcontractor with an order on a live job whose paperwork does not stand
 * up. Two lines at most per party, because they are two different asks:
 * **lapsed is overdue** (somebody uninsured may be on site today) and
 * **expiring is `soon`** (a phone call this week).
 */
export function subcontractorCoverAttention(
  parties: readonly SubcontractorCover[],
): JobsAttentionItem[] {
  const out: JobsAttentionItem[] = [];
  for (const p of parties) {
    const on = p.projectNumbers.length > 0 ? ` · on ${p.projectNumbers.join(", ")}` : "";
    if (p.lapsed.length > 0) {
      out.push({
        key: `jobs:cover-lapsed:${p.partyId}`,
        title: `${p.partyName} is not covered`,
        detail: `${p.lapsed.join(", ")} expired or never on file${on}`,
        urgency: "overdue",
        dueOn: null,
        href: `${BASE}/subcontractors`,
      });
    }
    if (p.expiring.length > 0) {
      out.push({
        key: `jobs:cover-expiring:${p.partyId}`,
        title: `${p.partyName}'s ${p.expiring.join(" and ")} runs out soon`,
        detail: `${p.soonestExpiry ?? "within the month"}${on}`,
        urgency: "soon",
        dueOn: p.soonestExpiry,
        href: `${BASE}/subcontractors`,
      });
    }
  }
  return out;
}
