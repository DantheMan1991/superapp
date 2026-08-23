/**
 * Who may write what, inside a capability pack. PURE — no imports, no database.
 *
 * THE RULE, settled 2026-08-15: **is this a decision, or is it a chore?**
 *
 * Declaring that North Pasture is hay ground this year is a decision. Recording
 * that four birds died is a chore, and the person doing it is standing in the
 * pen. Every pack write is one or the other, and it says which.
 *
 * WHY IT MATTERED ENOUGH TO CHANGE. Every pack shipped owner-only, copied four
 * times as a private `requireOwner`. That was survivable while the packs were
 * registers of things — but the next slice is the daily log, and a
 * daily-entry surface only the owner can use is built for the wrong person. At
 * ten times the pilot's size there are two or three people doing chores and
 * none of them is the owner.
 *
 * WHAT FORCES THE OWNER LINE, rather than taste: `upsertDimensionMember` in
 * accounting core calls `requireOwnerRole`. Anything that CREATES a cost object
 * — a parcel, a zone, an asset, a batch — must therefore be owner-only, or the
 * write would succeed and its cost object would not, leaving an entity no
 * report can group by. That constraint happens to fall exactly on the
 * decision/chore line, which is why this is a small change rather than a
 * negotiation with the ledger.
 *
 * NOT A SECURITY BOUNDARY. RLS is member-wide by design: what the business owns
 * and where its animals are is not private correspondence, and whoever is sent
 * to fetch something has to be able to find it. So the DATABASE decides whose
 * rows these are, and this decides who may change them. Weakening this cannot
 * leak another tenant's data; it can only let a colleague record something.
 */

/** The roles `requireTenant()` resolves. Inlined to keep this file import-free. */
export type WriteRole = "owner" | "staff" | "expert";

/**
 * `owner` — decisions: creating, renaming or retiring the things the business
 * is made of, and anything with a money or tax consequence.
 *
 * `member` — chores: recording that something happened to a thing that already
 * exists. Anyone with a tenant context, which is the point.
 */
export type WriteLevel = "owner" | "member";

/**
 * `expert` — the platform's own bookkeeper working inside a client workspace —
 * deliberately does NOT clear the owner level. They review and reconcile books;
 * they do not decide that the farm has bought a parcel. Accounting gives them
 * `requireReviewRole` for the things that are genuinely theirs.
 */
export function allowsWrite(role: WriteRole, level: WriteLevel): boolean {
  if (level === "member") return true;
  return role === "owner";
}
