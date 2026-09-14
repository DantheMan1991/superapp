import { saidWords } from "@/lib/tell-sources/shape";
import type { TellCandidate } from "@/lib/tell-sources/types";
import { slugLabel } from "../vocabulary";

/**
 * WHICH JOB THOSE WORDS MEAN — pure, so the pure suite can pin it.
 *
 * Searched, never listed ([ADR 0052](../../../../docs/decisions/0052-the-model-says-the-words-and-the-pack-goes-looking.md)):
 * a builder with forty open jobs cannot have them written into every
 * sentence. Four passes, loosest last:
 *
 *  1. **The number.** "24-108" is the one thing a builder says exactly, and
 *     an exact or contained number wins outright.
 *  2. **The name**, whole or contained either way.
 *  3. **The street.** "at Oak Row" is how a job is said on a site.
 *  4. **A word in common** with the name or the street (three letters or
 *     more, so "at" and "the" do not match everything), then everything
 *     open — a shortlist is a question and an empty result is the dead end
 *     0052 exists to end.
 *
 * Never edit distance: "Lot 12" is one character from "Lot 13", and choosing
 * between them on distance is how a day gets logged on the wrong house.
 */
export interface OpenProject {
  value: string;
  number: string;
  name: string;
  address: string;
  deliveryMethod: string | null;
}

/** "24-108 · Luxury custom · 118 Oak Row" — what tells one job from the next. */
export function describeProject(p: OpenProject): string {
  return [p.number, p.deliveryMethod ? slugLabel(p.deliveryMethod) : null, p.address || null]
    .filter((s): s is string => !!s)
    .join(" · ");
}

function toCandidate(p: OpenProject): TellCandidate {
  return { value: p.value, label: p.name, detail: describeProject(p) };
}

export function findProjects(projects: OpenProject[], said: string): TellCandidate[] {
  const asked = saidWords(said);
  if (asked.length === 0) return projects.map(toCandidate);
  const phrase = asked.join(" ");
  const spoken = new Set(asked);

  const byNumber = projects.filter((p) => {
    const n = saidWords(p.number).join(" ");
    return n !== "" && (n === phrase || phrase.includes(n));
  });
  if (byNumber.length > 0) return byNumber.map(toCandidate);

  const byName = projects.filter((p) => {
    const n = saidWords(p.name).join(" ");
    return n !== "" && (n === phrase || phrase.includes(n) || n.includes(phrase));
  });
  if (byName.length > 0) return byName.map(toCandidate);

  const byAddress = projects.filter((p) => {
    const a = saidWords(p.address).join(" ");
    return a !== "" && (phrase.includes(a) || a.includes(phrase));
  });
  if (byAddress.length > 0) return byAddress.map(toCandidate);

  const overlapping = projects.filter((p) =>
    [...saidWords(p.name), ...saidWords(p.address)].some((w) => w.length > 2 && spoken.has(w)),
  );
  if (overlapping.length > 0) return overlapping.map(toCandidate);

  return projects.map(toCandidate);
}
