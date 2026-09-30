import { jitter, median, medianPoint, type Point } from "./geometry";
import { MEASURE_ORDER, MEASURES, readView, wordsFor, type MeasureDef, type MeasureKey, type Reading, type Tier, type ViewCapture } from "./measures";
import type { View } from "./sticker-map";
import type { PosePoint } from "./views";

/**
 * FROM HELD VIEWS TO A REPORT (docs/modules/posture.md, slice 2; ADR 0119).
 * Pure.
 *
 * - `captureFrom`: one hold's frames down to one place per sticker and per
 *   pose point (medians), with how still the person was.
 * - `buildReport`: every view of every round read (`readView`), the readings
 *   of a measure averaged within a round and then across rounds, and the gap
 *   between the rounds kept: it is this check's own noise. A measure whose
 *   rounds disagree by more than a real change would is flagged, not hidden.
 */

type HeldFrame = { found: { id: string; blob: { centre: Point } }[] };

export function captureFrom(input: {
  view: View;
  round: number;
  frames: readonly HeldFrame[];
  poses: readonly (readonly PosePoint[])[];
  up: Point;
  upFrom: ViewCapture["upFrom"];
  pxPerMetre: number | null;
  width: number;
  height: number;
  stillPx: number;
}): ViewCapture {
  const places = new Map<string, Point[]>();
  for (const f of input.frames) {
    for (const hit of f.found) {
      const list = places.get(hit.id) ?? [];
      list.push(hit.blob.centre);
      places.set(hit.id, list);
    }
  }
  const stickers: Record<string, Point> = {};
  // A sticker seen in fewer than half the frames of a hold is not trusted.
  for (const [id, list] of places) {
    if (list.length >= Math.max(1, input.frames.length / 2)) stickers[id] = medianPoint(list);
  }
  let pose: PosePoint[] | null = null;
  if (input.poses.length > 0) {
    const n = input.poses[0].length;
    pose = Array.from({ length: n }, (_, i) => {
      const at = input.poses.map((p) => p[i]).filter(Boolean);
      return {
        x: median(at.map((p) => p.x)),
        y: median(at.map((p) => p.y)),
        visibility: median(at.map((p) => p.visibility)),
      };
    });
  }
  return {
    view: input.view,
    round: input.round,
    up: input.up,
    upFrom: input.upFrom,
    pxPerMetre: input.pxPerMetre,
    width: input.width,
    height: input.height,
    stickers,
    pose,
    frames: input.frames.length,
    // Kept as a number or nothing: a NaN does not survive the trip to the account.
    stillPx: Number.isFinite(input.stillPx) ? input.stillPx : null,
  };
}

/** How much a sticker wandered over a hold, in pixels (for the readout of a check). */
export function stickerJitter(frames: readonly HeldFrame[], id: string): number {
  return jitter(frames.flatMap((f) => f.found.filter((h) => h.id === id).map((h) => h.blob.centre)));
}

export type MeasureResult = {
  key: MeasureKey;
  name: string;
  /** Reliable, unless a reading had to use the pose model's points: then trend-only. */
  tier: Tier;
  unit: MeasureDef["unit"];
  deg: number;
  mm: number | null;
  words: string;
  /** Each round's value, in the lead unit. */
  rounds: number[];
  /** Between the rounds, in the lead unit: this check's own noise. */
  spread: number | null;
  /** Smallest real change between checks, in the lead unit. */
  mdc: number;
  /** The rounds disagreed by more than a real change would. */
  unsteady: boolean;
  context: string | null;
  from: "stickers" | "model" | "mixed";
  views: View[];
  readings: Reading[];
};

export type Missing = { key: MeasureKey; name: string; why: string };

export type Report = {
  measures: MeasureResult[];
  missing: Missing[];
  /**
   * Where true vertical came from, the weakest of any view: the plumb line in
   * every view, the phone's sensor in at least one, or (no sensor either) the
   * picture's own edges.
   */
  vertical: "plumb" | "sensor" | "picture";
  /** Millimetres were possible (the plumb line's tape marks were seen). */
  scale: boolean;
  rounds: number;
  views: View[];
};

export const VERTICAL_WORDS: Record<Report["vertical"], string> = {
  plumb: "the plumb line",
  sensor: "the phone's own level",
  picture: "the picture's edges",
};

const NEEDS_VIEW: Record<MeasureKey, View[]> = {
  "shoulder-level": ["front", "back"],
  "front-hip-level": ["front"],
  "back-hip-level": ["back"],
  "head-tilt": ["front"],
  "trunk-lean": ["front", "back"],
  "knee-in-right": ["front"],
  "knee-in-left": ["front"],
  "head-forward": ["right", "left"],
  "body-line": ["right", "left"],
  "pelvic-tilt": ["right", "left"],
  "shoulder-forward-right": ["right"],
  "shoulder-forward-left": ["left"],
  "knee-back-right": ["right"],
  "knee-back-left": ["left"],
};

const VIEW_WORDS: Record<View, string> = { front: "front", right: "right side", back: "back", left: "left side" };

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function buildReport(captures: readonly ViewCapture[]): Report {
  const readings = captures.flatMap(readView);
  const views = [...new Set(captures.map((c) => c.view))];
  const rounds = new Set(captures.map((c) => c.round)).size;
  const measures: MeasureResult[] = [];
  const missing: Missing[] = [];

  for (const key of MEASURE_ORDER) {
    const def = MEASURES[key];
    const mine = readings.filter((r) => r.key === key);
    if (mine.length === 0) {
      const seen = NEEDS_VIEW[key].filter((v) => views.includes(v));
      missing.push({
        key,
        name: def.name,
        why: seen.length === 0 ? `The ${NEEDS_VIEW[key].map((v) => VIEW_WORDS[v]).join(" or ")} view was not captured.` : def.needs,
      });
      continue;
    }
    const byRound = new Map<number, Reading[]>();
    for (const r of mine) byRound.set(r.round, [...(byRound.get(r.round) ?? []), r]);
    const roundDeg = [...byRound.values()].map((rs) => mean(rs.map((r) => r.deg)));
    const roundMm = [...byRound.values()].map((rs) => {
      const mms = rs.map((r) => r.mm).filter((m): m is number => m !== null && Number.isFinite(m));
      return mms.length === rs.length ? mean(mms) : null;
    });
    const deg = mean(roundDeg);
    const mm = roundMm.every((m) => m !== null) ? mean(roundMm as number[]) : null;
    const lead = def.unit === "mm" && mm !== null ? (roundMm as number[]) : roundDeg;
    const spread = lead.length >= 2 ? Math.max(...lead) - Math.min(...lead) : null;
    const fromSet = new Set(mine.map((r) => r.from));
    const from = fromSet.size > 1 ? "mixed" : (mine[0].from as "stickers" | "model");
    measures.push({
      key,
      name: def.name,
      tier: def.tier === "reliable" && fromSet.has("model") ? "trend" : def.tier,
      unit: def.unit,
      deg,
      mm,
      words: wordsFor(key, deg, mm),
      rounds: lead,
      spread,
      mdc: def.mdc,
      unsteady: spread !== null && spread > def.mdc,
      context: def.context,
      from,
      views: [...new Set(mine.map((r) => r.view))],
      readings: mine,
    });
  }

  return {
    measures,
    missing,
    vertical:
      captures.length > 0 && captures.every((c) => c.upFrom === "plumb")
        ? "plumb"
        : captures.some((c) => c.upFrom === "none")
          ? "picture"
          : "sensor",
    scale: captures.some((c) => c.pxPerMetre !== null),
    rounds,
    views,
  };
}

/** Every line the measures of one hold were taken along, frame pixels: for drawing over its figure or photo. */
export function linesOf(report: Report, view: View, round: number): [Point, Point][] {
  return report.measures.flatMap((m) => m.readings.filter((r) => r.view === view && r.round === round).flatMap((r) => r.lines));
}

function fmt(value: number, unit: MeasureDef["unit"]): string {
  return unit === "mm" ? `${Math.round(value)} mm` : `${value.toFixed(1)}°`;
}

/**
 * What the report says about a measure's noise, in one line. `real` is the
 * change a later check must beat: the published figure, or the person's own
 * once their checks show it is bigger (core/history.ts `noiseFor`).
 */
export function noiseWords(m: MeasureResult, realChange: { value: number; yours: boolean } = { value: m.mdc, yours: false }): string {
  const real = `A change of more than ${fmt(realChange.value, m.unit)} between checks would be real${realChange.yours ? " (your own figure, from your checks)" : ""}.`;
  if (m.spread === null) return real;
  if (m.unsteady) {
    return `Your two rounds differed by ${fmt(m.spread, m.unit)}, more than a real change: stand the same way each round. ${real}`;
  }
  return `Your two rounds agreed within ${fmt(m.spread, m.unit)}. ${real}`;
}

/** The report as plain text: numbers and words, for sending to a trainer or a physiotherapist. */
export function reportText(report: Report, when: Date, notes: readonly string[] = []): string {
  const lines = [
    `Posture check, ${when.toISOString().slice(0, 10)}`,
    `${report.views.length} views, ${report.rounds} ${report.rounds === 1 ? "round" : "rounds"}, vertical from ${VERTICAL_WORDS[report.vertical]}`,
    "",
  ];
  for (const m of report.measures) {
    const rounds = m.rounds.length > 1 ? ` [rounds: ${m.rounds.map((r) => fmt(r, m.unit)).join(", ")}]` : "";
    lines.push(`${m.name}: ${m.words}${rounds}${m.tier === "trend" ? " (trend only)" : ""}`);
  }
  if (report.missing.length > 0) {
    lines.push("", "Not measured:");
    for (const x of report.missing) lines.push(`${x.name}: ${x.why}`);
  }
  if (notes.length > 0) {
    lines.push("", "Along the way:");
    for (const n of notes) lines.push(n);
  }
  lines.push("", "Describes how the person stood that day, for fitness and body awareness. Not a medical assessment.");
  return lines.join("\n");
}

/**
 * Each hold's own numbers, for tuning the check from a copy: which stickers
 * were found, which were not, how still the person was, where vertical came
 * from. Sticker ids and pixels only.
 */
export function detailsText(captures: readonly ViewCapture[], expected: (view: View) => readonly string[]): string {
  const lines = ["Details (for tuning):"];
  for (const c of captures) {
    const want = expected(c.view);
    const missing = want.filter((id) => !c.stickers[id]);
    lines.push(
      [
        `round ${c.round} ${c.view}`,
        `${want.length - missing.length}/${want.length} stickers`,
        missing.length > 0 ? `missing ${missing.join(", ")}` : null,
        `${c.frames} frames`,
        `still ${c.stillPx !== null && Number.isFinite(c.stillPx) ? c.stillPx.toFixed(1) : "?"} px`,
        `up ${c.upFrom} (${c.up.x.toFixed(4)}, ${c.up.y.toFixed(4)})`,
        c.pxPerMetre ? `${Math.round(c.pxPerMetre)} px/m` : "no scale",
        `${c.width}x${c.height}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  return lines.join("\n");
}
