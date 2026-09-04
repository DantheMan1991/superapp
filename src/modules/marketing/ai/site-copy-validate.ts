import { z } from "zod";
import type { SiteCopy } from "@/lib/sites/copy";

/**
 * The assistant's words are untrusted input. **Each slot is parsed on its
 * own**, and a missing, malformed or over-long slot falls back to the
 * standard copy for that slot alone — one bad slot never costs the site.
 * (The first version parsed the whole answer as one object, which threw the
 * lot away for one empty paragraph; the test caught it.)
 */
const short = (max: number) => z.string().trim().max(max);
const body = (max: number) => z.array(short(800)).min(1).max(max);

const SLOTS = {
  description: short(200).min(1),
  hero: z.object({
    headline: short(120).min(1),
    subheadline: short(240).default(""),
    ctaLabel: short(40).default(""),
  }),
  offer: z.object({
    heading: short(80).min(1),
    items: z
      .array(z.object({ name: short(60).min(1), blurb: short(240).default("") }))
      .min(1)
      .max(8),
  }),
  about: z.object({ heading: short(80).min(1), body: body(6) }),
  closing: z.object({ headline: short(120).min(1), ctaLabel: short(40).default("") }),
  aboutPage: z.object({ heading: short(80).min(1), body: body(8) }),
  contactPage: z.object({ heading: short(80).min(1), note: short(300).default("") }),
  hoursHeading: short(80).min(1),
} as const;

export const SITE_COPY_SLOTS = Object.keys(SLOTS).length;

/**
 * Merge what the model wrote over the standard copy, slot by slot. Returns
 * how many slots the model filled, so the caller can say honestly whether
 * the assistant wrote the site.
 */
export function mergeSiteCopy(
  raw: unknown,
  fallback: SiteCopy,
): { copy: SiteCopy; filled: number } {
  if (!raw || typeof raw !== "object") return { copy: fallback, filled: 0 };
  const obj = raw as Record<string, unknown>;
  let filled = 0;
  const take = <K extends keyof SiteCopy>(key: K): SiteCopy[K] => {
    const parsed = (SLOTS[key] as unknown as z.ZodType<SiteCopy[K]>).safeParse(obj[key]);
    if (!parsed.success) return fallback[key];
    filled += 1;
    return parsed.data;
  };
  return {
    copy: {
      description: take("description"),
      hero: take("hero"),
      offer: take("offer"),
      about: take("about"),
      closing: take("closing"),
      aboutPage: take("aboutPage"),
      contactPage: take("contactPage"),
      hoursHeading: take("hoursHeading"),
    },
    filled,
  };
}
