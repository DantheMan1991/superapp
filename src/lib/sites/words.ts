import { SectionSchema, type Section, type SectionType } from "./schema";

/**
 * The WORDS of a section, by path — pure, shared by the assistant (slice
 * 12) and the site templates (slice 15). Every kind of section has a fixed
 * list of text slots; a writer is handed those and nothing else, and its
 * answer goes back into the same slots and nothing else, so a photo, a
 * link, a rule or the look can never change by way of words.
 */
const TEXT_PATHS: Record<SectionType, string[]> = {
  hero: ["eyebrow", "headline", "subheadline", "cta.label", "secondary.label"],
  about: ["heading", "body[]"],
  offer: ["heading", "items[].name", "items[].blurb"],
  hours: ["heading", "note"],
  contact: ["heading", "note"],
  form: ["heading", "note", "buttonLabel", "thanks"],
  booking: ["heading", "note", "title", "buttonLabel", "thanks"],
  events: ["heading", "note", "emptyText"],
  map: ["heading", "note"],
  text: ["heading", "body[]"],
  cta: ["headline", "cta.label"],
  image: ["caption"],
  gallery: ["heading", "items[].caption"],
  slideshow: ["heading"],
  columns: ["heading", "intro", "cards[].heading", "cards[].body[]", "cards[].cta.label"],
  block: ["heading", "note", "emptyText"],
  quotes: ["heading", "items[].quote", "items[].name", "items[].detail"],
  faq: ["heading", "note", "items[].question", "items[].answer"],
};

/** How long each slot may be, by its last name; the schema is the law, this is what a writer is told. */
const LIMITS: Record<string, number> = {
  eyebrow: 60,
  quote: 400,
  detail: 80,
  question: 120,
  answer: 600,
  headline: 120,
  subheadline: 240,
  heading: 80,
  intro: 300,
  note: 300,
  body: 800,
  name: 60,
  blurb: 240,
  label: 40,
  buttonLabel: 40,
  thanks: 240,
  title: 60,
  caption: 240,
  emptyText: 160,
};

const TIGHTER: Partial<Record<SectionType, Record<string, number>>> = {
  hours: { note: 200 },
  gallery: { caption: 120 },
  columns: { body: 400 },
};

export function limitFor(kind: SectionType, path: string): number {
  const leaf = path.replace(/\[\d+\]/g, "").split(".").pop() ?? "";
  return TIGHTER[kind]?.[leaf] ?? LIMITS[leaf] ?? 200;
}

type Step = { key: string } | { index: number };

function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) return steps;
    steps.push({ key: match[1] });
    for (const idx of match[2].matchAll(/\[(\d+)\]/g)) steps.push({ index: Number(idx[1]) });
  }
  return steps;
}

function getAt(value: unknown, steps: Step[]): unknown {
  let cursor: unknown = value;
  for (const step of steps) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = "key" in step ? (cursor as Record<string, unknown>)[step.key] : (cursor as unknown[])[step.index];
  }
  return cursor;
}

function setAt(value: unknown, steps: Step[], next: unknown): void {
  const parent = getAt(value, steps.slice(0, -1));
  const last = steps[steps.length - 1];
  if (parent === null || typeof parent !== "object" || !last) return;
  if ("key" in last) (parent as Record<string, unknown>)[last.key] = next;
  else (parent as unknown[])[last.index] = next;
}

/** Every concrete path a pattern names on this section: `items[].name` over three items is three paths. */
function expand(section: unknown, pattern: string): string[] {
  const parts = pattern.split(".");
  let paths = [""];
  for (const part of parts) {
    const isList = part.endsWith("[]");
    const key = isList ? part.slice(0, -2) : part;
    const next: string[] = [];
    for (const prefix of paths) {
      const base = prefix ? `${prefix}.${key}` : key;
      if (!isList) {
        next.push(base);
        continue;
      }
      const list = getAt(section, parsePath(base));
      if (Array.isArray(list)) for (let i = 0; i < list.length; i++) next.push(`${base}[${i}]`);
    }
    paths = next;
  }
  return paths;
}

/** The section's words, keyed by path. Only strings that are there: a missing button has no label to write. */
export function sectionWords(section: Section): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pattern of TEXT_PATHS[section.type]) {
    for (const path of expand(section, pattern)) {
      const value = getAt(section, parsePath(path));
      if (typeof value === "string") out[path] = value;
    }
  }
  return out;
}

/**
 * The section with new words in the slots that were sent, and nothing else
 * touched. Over-long words are cut to the slot's length rather than refused;
 * a result the content model will not take is null.
 */
export function applyWords(section: Section, words: Record<string, unknown>): Section | null {
  const draft = JSON.parse(JSON.stringify(section)) as Section;
  const allowed = sectionWords(section);
  for (const [path, value] of Object.entries(words)) {
    if (!(path in allowed) || typeof value !== "string") continue;
    const limit = limitFor(section.type, path);
    setAt(draft, parsePath(path), value.trim().slice(0, limit));
  }
  const parsed = SectionSchema.safeParse(draft);
  return parsed.success && parsed.data.type === section.type ? parsed.data : null;
}

/** Every word slot rewritten by a function: how a template's `{name}` becomes the business's. */
export function mapWords(section: Section, fn: (text: string) => string): Section {
  const words = sectionWords(section);
  const next: Record<string, string> = {};
  for (const [path, text] of Object.entries(words)) next[path] = fn(text);
  return applyWords(section, next) ?? section;
}
