import {
  programProblems,
  type FitnessUnitValue,
  type ItemInput,
  type PhaseInput,
  type ProgramInput,
  type VideoInput,
} from "./program";
import { formatTimestamp, parseTimestamp, parseYouTubeUrl } from "./youtube";

/**
 * THE EDITOR'S OWN SHAPE, and the two conversions to and from a program.
 *
 * A form holds what a person is typing, which is not yet a program: a count
 * field can be empty mid-edit, a video is a link being pasted, the checks are
 * lines in a box. So the editor keeps text where people type text, and
 * `fromEditor` turns it into a `ProgramInput` — or into the list of what to
 * fix, the same sentences the server would send back. Pure, and tested.
 */

let counter = 0;
/** A key for a row that lives only in the browser, so React can track it as rows move. */
export function newKey(): string {
  counter += 1;
  return `k${Date.now().toString(36)}${counter.toString(36)}`;
}

export interface EditorVideo {
  key: string;
  /** What the person pasted, or the link for a video already saved. */
  url: string;
  label: string;
  /** "m:ss" as typed; empty for none. */
  start: string;
  end: string;
  /** The video this row held when it was loaded — null for a row added here. */
  loadedId: string | null;
  /** YouTube's answer about THAT video; it follows the row only while the link still names it. */
  embeddable: boolean | null;
}

export interface EditorItem {
  key: string;
  itemId: string | null;
  exerciseId: string | null;
  name: string;
  purpose: string;
  unit: FitnessUnitValue;
  setsMin: string;
  setsMax: string;
  targetMin: string;
  targetMax: string;
  perSide: boolean;
  optional: boolean;
  /** "How to know you're doing it right", one per line. */
  cues: string;
  notes: string;
  videos: EditorVideo[];
}

export interface EditorPhase {
  key: string;
  phaseId: string | null;
  name: string;
  minDoneDays: string;
  notes: string;
  items: EditorItem[];
}

export interface EditorProgram {
  name: string;
  author: string;
  notes: string;
  sessionsPerWeekMin: string;
  sessionsPerWeekMax: string;
  effortMin: string;
  effortMax: string;
  breathOutS: string;
  breathInS: string;
  phases: EditorPhase[];
}

const numberText = (n: number | null) => (n == null ? "" : String(n));

/** The link shown for a saved video: short, and carrying its start if it has one. */
export function videoLink(video: { id: string; startS: number | null }): string {
  return `https://youtu.be/${video.id}${video.startS != null ? `?t=${video.startS}` : ""}`;
}

export function toEditorVideo(video: VideoInput): EditorVideo {
  return {
    key: newKey(),
    url: videoLink({ id: video.id, startS: null }),
    label: video.label ?? "",
    start: video.startS != null ? formatTimestamp(video.startS) : "",
    end: video.endS != null ? formatTimestamp(video.endS) : "",
    loadedId: video.id,
    embeddable: video.embeddable,
  };
}

/** A new, empty video row. */
export function emptyEditorVideo(): EditorVideo {
  return { key: newKey(), url: "", label: "", start: "", end: "", loadedId: null, embeddable: null };
}

export function toEditorItem(item: ItemInput): EditorItem {
  return {
    key: newKey(),
    itemId: item.itemId,
    exerciseId: item.exerciseId,
    name: item.name,
    purpose: item.purpose,
    unit: item.unit,
    setsMin: numberText(item.setsMin),
    setsMax: numberText(item.setsMax),
    targetMin: numberText(item.targetMin),
    targetMax: numberText(item.targetMax),
    perSide: item.perSide,
    optional: item.optional,
    cues: item.cues.join("\n"),
    notes: item.notes,
    videos: item.videos.map(toEditorVideo),
  };
}

export function toEditorPhase(phase: PhaseInput): EditorPhase {
  return {
    key: newKey(),
    phaseId: phase.phaseId,
    name: phase.name,
    minDoneDays: numberText(phase.minDoneDays),
    notes: phase.notes,
    items: phase.items.map(toEditorItem),
  };
}

export function toEditor(program: ProgramInput): EditorProgram {
  return {
    name: program.name,
    author: program.author,
    notes: program.notes,
    sessionsPerWeekMin: numberText(program.sessionsPerWeekMin),
    sessionsPerWeekMax: numberText(program.sessionsPerWeekMax),
    effortMin: numberText(program.effortMin),
    effortMax: numberText(program.effortMax),
    breathOutS: numberText(program.breathOutS),
    breathInS: numberText(program.breathInS),
    phases: program.phases.map(toEditorPhase),
  };
}

/** A whole number from a field, or null when the field is empty. NaN when it is not a number. */
function readInt(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : Number.NaN;
}

/**
 * What a video row says: the video it names, or why it names none. The
 * editor shows this beside the field as the person types, and the save
 * refuses on the same answer.
 */
export function readEditorVideo(
  video: EditorVideo,
): { ok: true; video: VideoInput } | { ok: false; problem: string } {
  const ref = parseYouTubeUrl(video.url);
  if (!ref) return { ok: false, problem: "That is not a link to one YouTube video." };
  const start = video.start.trim() === "" ? ref.startS : parseTimestamp(video.start);
  const end = video.end.trim() === "" ? null : parseTimestamp(video.end);
  if (video.start.trim() !== "" && start == null) {
    return { ok: false, problem: "Write the start as minutes and seconds, like 0:42." };
  }
  if (video.end.trim() !== "" && end == null) {
    return { ok: false, problem: "Write the end as minutes and seconds, like 1:10." };
  }
  // A row still naming the video it was loaded with keeps YouTube's answer
  // about it; a different video pasted in is asked again when the program is
  // saved (`markVideos`).
  return {
    ok: true,
    video: {
      id: ref.id,
      startS: start,
      endS: end,
      label: video.label.trim() === "" ? null : video.label.trim().slice(0, 60),
      embeddable: ref.id === video.loadedId ? video.embeddable : null,
    },
  };
}

/**
 * The editor's form → a program, or everything to fix first.
 *
 * Field problems name where they are ("Weeks 1–2, exercise 3: sets needs a
 * number"); the program's own rules come from `programProblems`, the function
 * the server runs again before it writes.
 */
export function fromEditor(
  editor: EditorProgram,
): { program: ProgramInput; problems: [] } | { program: null; problems: string[] } {
  const problems: string[] = [];
  const need = (label: string, text: string, required: boolean): number | null => {
    const value = readInt(text);
    if (value === null) {
      if (required) problems.push(`${label} needs a number.`);
      return null;
    }
    if (Number.isNaN(value)) {
      problems.push(`${label} must be a whole number.`);
      return null;
    }
    return value;
  };

  const phases: PhaseInput[] = editor.phases.map((phase, p) => {
    const phaseName = phase.name.trim() || `Phase ${p + 1}`;
    return {
      phaseId: phase.phaseId,
      name: phase.name.trim(),
      minDoneDays: need(`${phaseName}: days before moving on`, phase.minDoneDays, false),
      notes: phase.notes.trim(),
      items: phase.items.map((item, i) => {
        const where = `${phaseName}, exercise ${i + 1}`;
        const videos: VideoInput[] = [];
        for (const row of item.videos) {
          if (row.url.trim() === "") continue;
          const read = readEditorVideo(row);
          if (read.ok) videos.push(read.video);
          else problems.push(`${where}: ${read.problem}`);
        }
        return {
          itemId: item.itemId,
          exerciseId: item.exerciseId,
          name: item.name.trim(),
          purpose: item.purpose.trim(),
          cues: item.cues
            .split("\n")
            .map((line) => line.replace(/^\s*[-•*·]\s*/, "").trim())
            .filter((line) => line !== ""),
          unit: item.unit,
          videos,
          setsMin: need(`${where}: sets`, item.setsMin, true) ?? 1,
          setsMax: need(`${where}: sets (to)`, item.setsMax, false),
          targetMin: need(`${where}: count`, item.targetMin, true) ?? 1,
          targetMax: need(`${where}: count (to)`, item.targetMax, false),
          perSide: item.perSide,
          optional: item.optional,
          notes: item.notes.trim(),
        };
      }),
    };
  });

  const program: ProgramInput = {
    name: editor.name.trim(),
    author: editor.author.trim(),
    notes: editor.notes.trim(),
    sessionsPerWeekMin: need("Sessions a week", editor.sessionsPerWeekMin, false),
    sessionsPerWeekMax: need("Sessions a week (to)", editor.sessionsPerWeekMax, false),
    effortMin: need("Effort", editor.effortMin, false),
    effortMax: need("Effort (to)", editor.effortMax, false),
    breathOutS: need("Breathing out", editor.breathOutS, false),
    breathInS: need("Breathing in", editor.breathInS, false),
    phases,
  };
  problems.push(...programProblems(program));
  outOfRange(problems, "Sessions a week", [program.sessionsPerWeekMin, program.sessionsPerWeekMax], 14);
  outOfRange(problems, "Effort", [program.effortMin, program.effortMax], 10);
  outOfRange(problems, "Breathing pace", [program.breathOutS, program.breathInS], 30);
  program.phases.forEach((phase, p) => {
    const phaseName = phase.name || `Phase ${p + 1}`;
    outOfRange(problems, `${phaseName}: days before moving on`, [phase.minDoneDays], 365);
    phase.items.forEach((item, i) => {
      const where = `${phaseName}, exercise ${i + 1}`;
      outOfRange(problems, `${where}: sets`, [item.setsMin, item.setsMax], 20);
      outOfRange(problems, `${where}: count`, [item.targetMin, item.targetMax], 1000);
    });
  });
  if (problems.length > 0) return { program: null, problems: [...new Set(problems)] };
  return { program, problems: [] };
}

function outOfRange(problems: string[], label: string, values: (number | null)[], max: number) {
  if (values.some((v) => v != null && (v < 1 || v > max))) {
    problems.push(`${label} must be between 1 and ${max}.`);
  }
}
