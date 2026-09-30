/**
 * THE STICKERS (docs/modules/posture.md, "Where the stickers go"): twenty dots
 * on bony landmarks, the points a clinic's posture photos are measured from
 * (the SAPO protocol's measured subset, cut to what a person can place with a
 * helper). The pose model only finds a person to within a few centimeters; a
 * sticker is found to under a millimetre, so every measure that can be taken
 * from stickers is.
 *
 * Colour says the side: BLUE on the person's LEFT, GREEN on their RIGHT, and
 * either on the midline. That is also what lets a back view, where a pose
 * model can swap left and right, never swap a sticker.
 *
 * Where a sticker is looked for comes from the pose model's points
 * (MediaPipe's 33) plus an offset in torso lengths, per view. The offsets are
 * starting guesses from anatomy, loose on purpose (the search radius is wide);
 * the setup check's readout reports where each sticker was actually found
 * relative to its anchor, so they can be tightened from real checks.
 *
 * Placement words come from the research behind the plan (docs/modules/
 * posture.md cites them): the flexion-extension way to find C7 is right about
 * twice as often as "the most prominent bump".
 */

export const VIEWS = ["front", "right", "back", "left"] as const;
export type View = (typeof VIEWS)[number];

export type Side = "left" | "right" | "mid";
export type StickerColour = "blue" | "green";

/** MediaPipe Pose Landmarker's point numbers (the person's own left/right). */
export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/**
 * Where to look, in one view: the anchor is a pose point (or the midpoint of
 * two); the offset is in torso lengths, `up` along true up and `out` along
 * the body's own direction for that view (see `Anchor.out`).
 */
export type Anchor = {
  points: readonly number[];
  up: number;
  /**
   * Front and back views: away from the body's midline, toward the sticker's
   * side. Side views: toward the FRONT of the body (negative: toward the back).
   */
  out: number;
};

export type Sticker = {
  id: string;
  side: Side;
  /** The name said and shown, e.g. "Right front hip bone". */
  name: string;
  /** Plain words for finding the spot on yourself. */
  find: string;
  /** Hard to place well on yourself: someone else should. */
  helper: boolean;
  /** The views it can be seen in, and where to look in each. */
  anchors: Partial<Record<View, Anchor>>;
};

export function colourOf(side: Side): StickerColour | null {
  return side === "left" ? "blue" : side === "right" ? "green" : null;
}

type Pair = {
  key: string;
  name: string;
  find: string;
  helper: boolean;
  anchors: (side: "left" | "right") => Partial<Record<View, Anchor>>;
};

const own = (side: "left" | "right", left: number, right: number) => (side === "left" ? left : right);

const PAIRS: readonly Pair[] = [
  {
    key: "ear",
    name: "ear",
    find: "On the small flap of skin in front of your ear canal. Tie long hair back so it stays in view.",
    helper: false,
    anchors: (side) => ({
      [side]: { points: [own(side, LM.leftEar, LM.rightEar)], up: 0, out: 0.04 },
    }),
  },
  {
    key: "shoulder",
    name: "shoulder tip",
    find: "Follow your collarbone out to the flat bony shelf on top of your shoulder and put it on the outer edge. Turn your arm with the elbow bent: if the bump under your finger moves, you are on the arm bone, so go higher.",
    helper: false,
    anchors: (side) => ({
      front: { points: [own(side, LM.leftShoulder, LM.rightShoulder)], up: 0.06, out: 0.02 },
      back: { points: [own(side, LM.leftShoulder, LM.rightShoulder)], up: 0.06, out: 0.02 },
      [side]: { points: [own(side, LM.leftShoulder, LM.rightShoulder)], up: 0.06, out: 0 },
    }),
  },
  {
    key: "front-hip",
    name: "front hip bone",
    find: "Hands on your hips, slide forward and down along the rim of your pelvis to the bony knob at the front. Put it on the most prominent point.",
    helper: false,
    anchors: (side) => ({
      front: { points: [own(side, LM.leftHip, LM.rightHip)], up: 0.14, out: 0.06 },
      [side]: { points: [own(side, LM.leftHip, LM.rightHip)], up: 0.12, out: 0.2 },
    }),
  },
  {
    key: "back-hip",
    name: "low back dimple",
    find: "The bony knob at, or just under, each of the two dimples above your buttocks. Easiest placed by someone else.",
    helper: true,
    anchors: (side) => ({
      back: { points: [own(side, LM.leftHip, LM.rightHip)], up: 0.2, out: -0.06 },
      [side]: { points: [own(side, LM.leftHip, LM.rightHip)], up: 0.18, out: -0.22 },
    }),
  },
  {
    key: "hip-side",
    name: "side hip bone",
    find: "Palm on the side of your hip below the waist, lift that heel a little and turn the foot in and out: the knob that rolls under your hand is the spot. Put it on its most outward point.",
    helper: false,
    anchors: (side) => ({
      [side]: { points: [own(side, LM.leftHip, LM.rightHip)], up: -0.02, out: 0 },
    }),
  },
  {
    key: "knee-side",
    name: "outer knee",
    find: "Sit with the knee bent to a right angle and find the round bump below the outside of the knee. The soft groove one to one and a half centimeters above it is the spot. Stand up and check it.",
    helper: false,
    anchors: (side) => ({
      [side]: { points: [own(side, LM.leftKnee, LM.rightKnee)], up: 0, out: 0 },
    }),
  },
  {
    key: "kneecap",
    name: "kneecap",
    find: "The middle of the kneecap, with the leg straight and relaxed.",
    helper: false,
    anchors: (side) => ({
      front: { points: [own(side, LM.leftKnee, LM.rightKnee)], up: 0.02, out: 0 },
    }),
  },
  {
    key: "ankle-front",
    name: "front of the ankle",
    find: "On the front of the ankle, halfway between the inner and outer ankle bones.",
    helper: false,
    anchors: (side) => ({
      front: { points: [own(side, LM.leftAnkle, LM.rightAnkle)], up: 0.02, out: 0 },
    }),
  },
  {
    key: "ankle-side",
    name: "outer ankle bone",
    find: "On the most prominent point of the outer ankle bone.",
    helper: false,
    anchors: (side) => ({
      [side]: { points: [own(side, LM.leftAnkle, LM.rightAnkle)], up: 0, out: 0 },
    }),
  },
];

function capitalised(side: "left" | "right", name: string): string {
  return `${side === "left" ? "Left" : "Right"} ${name}`;
}

export const STICKERS: readonly Sticker[] = [
  {
    id: "neck",
    side: "mid",
    name: "Base of the neck",
    find: "Tip your head forward and find the lowest bump at the base of your neck. Keep a finger on it and tip your head back: if it slides forward and fades, that was the one above, so go one lower. The bump that stays put is the spot. Best placed by someone else.",
    helper: true,
    anchors: {
      back: { points: [LM.leftShoulder, LM.rightShoulder], up: 0.24, out: 0 },
      right: { points: [LM.rightShoulder], up: 0.24, out: -0.14 },
      left: { points: [LM.leftShoulder], up: 0.24, out: -0.14 },
    },
  },
  {
    id: "breastbone",
    side: "mid",
    name: "Top of the breastbone",
    find: "The notch at the top of the breastbone, between the inner ends of the collarbones.",
    helper: false,
    anchors: {
      front: { points: [LM.leftShoulder, LM.rightShoulder], up: 0.04, out: 0 },
    },
  },
  ...PAIRS.flatMap((pair) =>
    (["right", "left"] as const).map(
      (side): Sticker => ({
        id: `${side}-${pair.key}`,
        side,
        name: capitalised(side, pair.name),
        find: pair.find,
        helper: pair.helper,
        anchors: pair.anchors(side),
      }),
    ),
  ),
];

export function stickerById(id: string): Sticker | undefined {
  return STICKERS.find((s) => s.id === id);
}

/** The stickers a view can see, in the catalogue's order. */
export function stickersIn(view: View): Sticker[] {
  return STICKERS.filter((s) => s.anchors[view]);
}
