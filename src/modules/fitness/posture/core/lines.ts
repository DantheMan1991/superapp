import { STICKERS, type Sticker, type View } from "./sticker-map";
import type { FramingAdvice } from "./views";

/**
 * EVERYTHING THE POSTURE CHECK SAYS (docs/modules/posture.md, "The voice").
 *
 * The phone's screen faces away from the person being measured (the rear
 * camera faces them), so everything they need to hear is said, in the
 * coach's recorded voice (ADR 0115) through the one voice queue (ADR 0114).
 * A recording is fetched ahead or not at all for a line that cannot wait, so
 * every line is fixed text, listed here, and fetched when the check starts
 * (`allSetupLines`). No line carries a number or a name that is not in this
 * file: a line built on the fly would be said in the device's voice.
 */

export const SETUP_LINES = {
  walkIn: "Walk to your foot outline and face the phone.",
  seeYou: "I can see you, head to toe.",
  stepBack: "Step back a little.",
  stepCloser: "Step a little closer.",
  noFeet: "I can't see your feet.",
  noHead: "I can't see the top of your head.",
  lostYou: "I've lost you. Come back into the picture.",
  twoPeople: "I can see more than one person. Only you in the picture.",
  holdStill: "Hold still.",
  turnFront: "Now face the phone.",
  turnRight: "Now turn so your right side faces the phone.",
  turnBack: "Now turn so your back faces the phone.",
  turnLeft: "Now turn so your left side faces the phone.",
  wrongWay: "Not quite. Check which way you're facing.",
  viewDone: "Got it.",
  allStickers: "Every sticker I looked for is there.",
  timing: "Stay there while I time the pose model. It takes about half a minute.",
  done: "Setup check done. You can come back to the phone.",
} as const;

const MOVE = {
  left: "Move a little to your left.",
  right: "Move a little to your right.",
  forward: "Move a little forward.",
  back: "Move a little back.",
} as const;

export function moveLine(toward: "left" | "right" | "forward" | "back"): string {
  return MOVE[toward];
}

export function framingLine(advice: FramingAdvice): string | null {
  switch (advice) {
    case "step-back":
      return SETUP_LINES.stepBack;
    case "step-closer":
      return SETUP_LINES.stepCloser;
    case "no-feet":
      return SETUP_LINES.noFeet;
    case "no-head":
      return SETUP_LINES.noHead;
    default:
      return null; // sideways moves need the view: `moveLine`
  }
}

export function turnLine(view: View): string {
  return view === "front"
    ? SETUP_LINES.turnFront
    : view === "right"
      ? SETUP_LINES.turnRight
      : view === "back"
        ? SETUP_LINES.turnBack
        : SETUP_LINES.turnLeft;
}

export function missingLine(sticker: Sticker): string {
  return `I can't find the ${sticker.name.toLowerCase()} sticker.`;
}

/** Every line the setup check can say, for fetching the recordings ahead. */
export function allSetupLines(): string[] {
  return [
    ...Object.values(SETUP_LINES),
    ...Object.values(MOVE),
    ...STICKERS.map(missingLine),
  ];
}

/**
 * What the check itself adds (slice 2). The person starts it at the phone,
 * so it readies itself while they are there, then sends them to their
 * outline; the second round starts from a fresh stance, so the gap between
 * the rounds is the check's own noise, not one frozen stance measured twice.
 */
export const CHECK_LINES = {
  stayByPhone: "Stay by the phone for a moment while I get ready.",
  levelPhone: "The phone isn't level. Turn it on its tripod until the screen says it is.",
  noPlumb: "I can't find the plumb line, so I'll use the phone's own level.",
  phoneMoved: "The phone has moved. Hold on while I find the plumb line again.",
  roundTwo: "Round two. Step off your outline and shake out, then step back on and face the phone.",
  done: "That's the check done. You can come back to the phone.",
  // A sticker that slipped since last time (slice 3b): named by `slippedLine`, then these.
  fixSticker: "If it slipped, put it back, then face the phone again.",
  stickerBack: "Thanks. That matches last time.",
} as const;

/** Said by name for a sticker that is not where it was on the last check (3b). */
export function slippedLine(sticker: Sticker): string {
  return `Your ${sticker.name.toLowerCase()} sticker isn't where it was last time.`;
}

/** Every line the check can say, for fetching the recordings ahead. */
export function allCheckLines(): string[] {
  const setupOnly: string[] = [SETUP_LINES.timing, SETUP_LINES.done, SETUP_LINES.allStickers, SETUP_LINES.seeYou];
  return [
    ...Object.values(CHECK_LINES),
    ...STICKERS.map(slippedLine),
    ...allSetupLines().filter((line) => !setupOnly.includes(line)),
  ];
}
