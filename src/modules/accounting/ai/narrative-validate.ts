/**
 * Close-narrative validation — the pure, testable seam between the model
 * and persistence (bill-validate.ts mirror). Never throws; a malformed
 * payload degrades to an empty narrative, which the orchestrator turns
 * into AI_UNAVAILABLE.
 */

export interface CloseNarrativeHighlight {
  title: string;
  detail?: string;
}

export interface CloseNarrative {
  narrative: string;
  highlights: CloseNarrativeHighlight[];
  model: string;
  at: string;
}

const MAX_NARRATIVE_CHARS = 4000;
const MAX_HIGHLIGHTS = 5;
const MAX_TITLE_CHARS = 80;
const MAX_DETAIL_CHARS = 300;

/** Strip markdown heading lines — the prompt forbids them, the validator enforces. */
function stripHeadings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^#{1,6}\s/.test(line.trim()))
    .join("\n")
    .trim();
}

export function validateCloseNarrative(
  raw: unknown,
  model: string,
  nowIso: string,
): CloseNarrative {
  const empty: CloseNarrative = { narrative: "", highlights: [], model, at: nowIso };
  if (typeof raw !== "object" || raw === null) return empty;
  const obj = raw as Record<string, unknown>;

  const narrative =
    typeof obj.narrative === "string"
      ? stripHeadings(obj.narrative).slice(0, MAX_NARRATIVE_CHARS).trim()
      : "";

  const highlights: CloseNarrativeHighlight[] = [];
  if (Array.isArray(obj.highlights)) {
    for (const h of obj.highlights) {
      if (highlights.length >= MAX_HIGHLIGHTS) break;
      if (typeof h !== "object" || h === null) continue;
      const hh = h as Record<string, unknown>;
      if (typeof hh.title !== "string" || hh.title.trim() === "") continue;
      const item: CloseNarrativeHighlight = {
        title: hh.title.trim().slice(0, MAX_TITLE_CHARS),
      };
      if (typeof hh.detail === "string" && hh.detail.trim() !== "") {
        item.detail = hh.detail.trim().slice(0, MAX_DETAIL_CHARS);
      }
      highlights.push(item);
    }
  }

  return { narrative, highlights, model, at: nowIso };
}
