/**
 * WHAT ONE PERSON MAY REACH. PURE — no imports, no database (ADR 0093).
 *
 * The whole model in four sentences:
 *
 * - **A key is a module slug** (`marketing`), **or an area inside one**
 *   (`accounting:reports`). Nothing else is a key, and the separator is the one
 *   character a module slug may not contain.
 * - **A level stores what it may NOT reach.** Empty denies nothing.
 * - **Denying a module denies every area in it**, because an area you could
 *   reach inside a tool you could not is a contradiction, not a configuration.
 * - **No level is no restriction.** That is what lets this ship into live
 *   workspaces without changing anybody's access on the day it deploys.
 *
 * ── WHY "WHAT IS OFF" RATHER THAN "WHAT IS ON" ───────────────────────────────
 *
 * The other direction is the one a security textbook asks for, and it is wrong
 * here for a reason that is about people rather than principle: a screen built
 * next year would be missing for every level in every workspace, silently, and
 * the client would find it before we did. Stored this way a new screen is
 * reachable and an owner takes it away if they want to — visible, correctable,
 * and never a support incident.
 *
 * An area sensitive enough to want the other direction says so **in code**,
 * where the area is declared, so the decision is made once by whoever builds it
 * rather than by every tenant's rows. See `AccessArea.deniedByDefault`.
 *
 * ── NOT THE ONLY THING STANDING BETWEEN A PERSON AND A ROW ───────────────────
 *
 * This decides which SCREENS somebody may open. It is deliberately not the
 * mechanism for which COMPANY's books they may see: that is a question about
 * rows, Postgres answers it, and the difference is the whole of ADR 0093's
 * second half. A gate that hid a screen while its rows stayed readable would be
 * tidiness wearing a security badge.
 */

/** The character that separates a module from an area inside it. */
export const AREA_SEPARATOR = ":";

/** `accounting:reports` → `accounting`. A bare module key returns itself. */
export function moduleOf(key: string): string {
  const at = key.indexOf(AREA_SEPARATOR);
  return at === -1 ? key : key.slice(0, at);
}

/**
 * May somebody holding `denied` reach `key`?
 *
 * **WRONG IN THE STRICT DIRECTION, unlike every other predicate in the rail.**
 * An unrecognised key is reachable — it has no screen to protect — but a denial
 * that names a module closes everything beneath it, so a level written before
 * an area existed does not spring a leak the day that area ships.
 */
export function reaches(denied: readonly string[], key: string): boolean {
  if (denied.length === 0) return true;
  if (denied.includes(key)) return false;
  const mod = moduleOf(key);
  return mod === key ? true : !denied.includes(mod);
}

/**
 * The keys a level would deny, once a module is denied whole.
 *
 * The screen ticks areas, and unticking a tool has to mean unticking its areas
 * — otherwise a level reads as "no Accounting, but no Reports either", which is
 * two ways of saying one thing and the second one goes stale. Normalising here
 * rather than in the form is what keeps the stored list the same however it was
 * edited.
 */
export function normaliseDenied(denied: readonly string[]): string[] {
  const modules = new Set(denied.filter((k) => moduleOf(k) === k));
  const kept = denied.filter((k) => moduleOf(k) === k || !modules.has(moduleOf(k)));
  return [...new Set(kept)].sort();
}
