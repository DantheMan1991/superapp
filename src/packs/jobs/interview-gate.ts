/**
 * WHETHER THE ESTIMATE INTERVIEW IS THERE, for one tenant (X1, ADR 0098).
 *
 * The interview is a LAYER over estimating, not a replacement for it: the
 * estimate editor is unchanged and works exactly as it did whether this is on
 * or off, and turning it off leaves ordinary estimates behind with nothing
 * orphaned. That is the founder's requirement — *"a layer that should be able
 * to be turned off"* — and it is also what makes the layer safe to pilot.
 *
 * ── TWO FLAGS, BECAUSE THERE ARE TWO DECISIONS ──────────────────────────────
 *
 * `estimateInterviewGranted` is OURS: which businesses have the layer at all,
 * written only by a superadmin. It starts as one pilot tenant and becomes
 * everybody when it has earned it, and until then the feature costs nothing
 * to a client who has not been given it.
 *
 * `estimateInterviewOff` is THEIRS: an owner who has it and does not want it.
 *
 * Collapsing them into one switch was the obvious move and the wrong one:
 * "we are piloting this with one client" and "any client may switch on a
 * feature we have not priced" are different statements, and a single flag can
 * only make one of them.
 *
 * ── STORED AS WHAT IS OFF, and for `tabsOff`'s reason ───────────────────────
 *
 * A granted tenant has it ON without anybody clicking anything, because a
 * pilot that arrives invisible is a pilot nobody runs. The stored key is
 * therefore the refusal, which also means a tenant who has never touched the
 * setting gets whatever the grant says rather than a stale `false`.
 *
 * ── TOTAL BY CONSTRUCTION ───────────────────────────────────────────────────
 *
 * The config is jsonb with no shape constraint and almost every tenant has
 * never touched it, so anything unreadable means "not granted" — never a
 * crash, and never a feature appearing because a value was the wrong type.
 */

export interface InterviewGate {
  /** We have given this business the layer. */
  granted: boolean;
  /** Their owner has switched it off. Meaningless without the grant. */
  off: boolean;
  /** Both answers together: whether to draw anything at all. */
  available: boolean;
}

function flag(config: unknown, key: string): boolean {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return (config as Record<string, unknown>)[key] === true;
  }
  return false;
}

export function interviewGateFrom(config: unknown): InterviewGate {
  const granted = flag(config, "estimateInterviewGranted");
  const off = flag(config, "estimateInterviewOff");
  return { granted, off, available: granted && !off };
}

/** The config keys, named once so the action and the console cannot disagree. */
export const INTERVIEW_GRANT_KEY = "estimateInterviewGranted";
export const INTERVIEW_OFF_KEY = "estimateInterviewOff";
