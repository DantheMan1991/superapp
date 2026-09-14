/**
 * The SHAPE of what a profile may seed into this pack, with no server imports —
 * so a profile's constant can be typed against it and a pure test can check a
 * manifest without opening a database. The applier that writes rows is
 * `./seed.ts`; this file is what it parses with.
 *
 * **THE PACK OWNS THE SHAPE, THE PROFILE OWNS THE DATA.** A profile's
 * `seed.packs.jobs` is `unknown` to the profile type — Layer 0 must not know
 * what a pack's seed looks like — and is parsed here with the same tolerance
 * `deliveryMethodsFrom` has for its config: anything unreadable is nothing,
 * never a crash, because the applier runs inside a superadmin's install and a
 * thrown shape error there would leave a tenant half-installed.
 */
export interface CostCodeSetSeed {
  name: string;
  notes?: string;
  codes: Array<{ code: string; name: string }>;
}

export interface JobsSeed {
  costCodeSets: CostCodeSetSeed[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Total by construction: unreadable means no lists, never a throw. */
export function costCodeSetsFrom(seed: unknown): CostCodeSetSeed[] {
  const sets = asRecord(seed)?.costCodeSets;
  if (!Array.isArray(sets)) return [];
  const out: CostCodeSetSeed[] = [];
  for (const raw of sets) {
    const set = asRecord(raw);
    if (!set || typeof set.name !== "string" || set.name.trim() === "") continue;
    if (!Array.isArray(set.codes)) continue;
    const codes: CostCodeSetSeed["codes"] = [];
    for (const c of set.codes) {
      const code = asRecord(c);
      if (
        code &&
        typeof code.code === "string" &&
        code.code.trim() !== "" &&
        typeof code.name === "string" &&
        code.name.trim() !== ""
      ) {
        codes.push({ code: code.code.trim(), name: code.name.trim() });
      }
    }
    out.push({
      name: set.name.trim(),
      notes: typeof set.notes === "string" ? set.notes : undefined,
      codes,
    });
  }
  return out;
}

/** One line for the console, before the button: what this seed would bring. */
export function summarizeJobsSeed(seed: unknown): string | null {
  const sets = costCodeSetsFrom(seed);
  if (sets.length === 0) return null;
  const codes = sets.reduce((n, s) => n + s.codes.length, 0);
  return `${sets.length} cost code ${sets.length === 1 ? "list" : "lists"} (${codes} codes)`;
}
