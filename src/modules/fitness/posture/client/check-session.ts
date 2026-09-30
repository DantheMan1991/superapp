import { MEASURING_MODEL } from "../core/assets";
import type { ViewCapture } from "../core/measures";
import { CHECK_LINES, allCheckLines, missingLine, slippedLine, SETUP_LINES, turnLine } from "../core/lines";
import { placesOf, shiftsBetween, SLIPPED_MM, type Place, type Shift } from "../core/placement";
import { captureFrom } from "../core/report";
import { stickerById, stickersIn, VIEWS, type View } from "../core/sticker-map";
import { torsoLength, type PosePoint } from "../core/views";
import type { FromWorker, PhotoResult } from "../worker/protocol";
import { deleteCheck, holdCheckLock, saveCheck } from "../store/checks";
import { sendCheckNow, sendPendingChecksWithin } from "../store/sync";
import type { StoredCheck } from "../store/db";
import { CaptureBase, sleep, type CaptureCallbacks, type Held } from "./capture-base";
import { startPostureVoice } from "./voice";

/**
 * THE POSTURE CHECK, STEP BY STEP (docs/modules/posture.md, slice 2;
 * docs/help/fitness/posture-check.md). Plain TypeScript so the screen only
 * draws; the camera, worker, level and plumb line are the shared machinery
 * (`capture-base.ts`).
 *
 * The person taps Start at the phone and stays there while it readies itself
 * (the main lens, its locks, the level, the plumb line), then is sent to their
 * outline. Four views, front, right, back, left, each captured when they are
 * framed, facing the right way and still; then the same again from a fresh
 * stance, so the gap between the rounds is the check's own noise. The numbers
 * are saved on this phone (`store/`), and a photo of each view of the first
 * round too if the person turned that on (the worker writes it, ADR 0118).
 */

export const ROUNDS = 2;
export const HOLD_FRAMES = 12;
const VIEW_TIMEOUT_MS = 90_000;
const PLUMB_TIMEOUT_MS = 20_000;
const REFIND_TIMEOUT_MS = 15_000;
const PHOTO_LONG_SIDE = 2400;
const PHOTO_QUALITY = 0.85;
/** The sensor saying the phone turned more than this since the plumb line was found: the tripod was knocked. */
const MOVED_DEG = 1;

export const VIEW_LABEL: Record<View, string> = { front: "Front", right: "Right side", back: "Back", left: "Left side" };

export type CheckStep =
  | { kind: "starting"; message: string }
  | { kind: "level"; roll: number | null; pitch: number | null }
  | { kind: "plumb" }
  | { kind: "view"; view: View; round: number; read: number }
  /** A sticker is not where it was last time (3b): the person is asked to fix it, then face the phone again. */
  | { kind: "slipped"; view: View; round: number; shifts: Shift[] }
  | { kind: "between" }
  | { kind: "saving" };

export type ViewMark = "waiting" | "now" | "done" | "skipped";
export type Marks = Record<View, ViewMark>[];

export type CheckResult = {
  checkId: string;
  /** Saved on the phone: the report can be opened from the list. */
  saved: boolean;
  saveError: string | null;
  captures: ViewCapture[];
  notes: string[];
  at: string;
};

export type CheckCallbacks = CaptureCallbacks & {
  step(step: CheckStep): void;
  marks(marks: Marks): void;
  vertical(from: "plumb" | "sensor" | "none", pxPerMetre: number | null): void;
  modelReady(ready: boolean): void;
  done(result: CheckResult): void;
  failed(message: string): void;
};

function emptyMarks(): Marks {
  return Array.from({ length: ROUNDS }, () => ({ front: "waiting", right: "waiting", back: "waiting", left: "waiting" }) as Record<View, ViewMark>);
}

export class CheckSession extends CaptureBase<CheckCallbacks> {
  private readonly captures: ViewCapture[] = [];
  private readonly notes: string[] = [];
  private readonly marks = emptyMarks();
  private readonly at = new Date().toISOString();
  private photoWaiter: ((m: PhotoResult) => void) | null = null;
  private photosKept = 0;
  /** Views with a kept photo: the first round's, or the second's when the first was skipped. */
  private readonly photographed = new Set<View>();
  /** The sensor's roll when the plumb line was found: how a knocked tripod is noticed. */
  private rollAtPlumb: number | null = null;
  private finishing = false;
  private saved = false;
  private lastPose: PosePoint[] | null = null;
  /** The person's "keep a photo" switch, until the phone's storage turns out not to open. */
  private photosOn: boolean;
  /** The measuring model is loaded (30 MB the first time on a phone). */
  private modelLoaded = false;
  /** Lets go of this check's lock (`holdCheckLock`): the browser does it too when the page goes. */
  private releaseLock: () => void = () => undefined;
  /** Views already asked to fix a slipped sticker: once each, never a loop. */
  private readonly askedToFix = new Set<View>();

  constructor(
    video: HTMLVideoElement,
    cb: CheckCallbacks,
    naturalVoice: boolean,
    private readonly check: {
      id: string;
      owner: string;
      keepPhotos: boolean;
      /** The check this one repeats, stickers taken off and put back on (3b). */
      repeatOf: string | null;
      /** Where each sticker sat on the last check (3b), to notice one that slipped; null for a first check. */
      lastPlaces: Record<string, Place> | null;
    },
    testSource: MediaStream | null = null,
  ) {
    super(video, cb, naturalVoice, testSource);
    this.photosOn = check.keepPhotos;
  }

  /**
   * Leaving mid-check keeps nothing: the numbers so far and any photo are
   * deleted. Leaving a finished one (the report opening) lets the coach's
   * last line play out.
   */
  override close(): void {
    if (this.closed) return;
    if (this.saved) {
      this.closed = true;
      this.act("closed");
      this.releaseCamera();
      this.releaseLock();
      return;
    }
    super.close();
    void deleteCheck(this.check.owner, this.check.id)
      .catch(() => undefined)
      .finally(() => this.releaseLock());
  }

  /** A line for the report's "Along the way": in the person's words, twelve at most. */
  protected override note(text: string): void {
    // The shared machinery notes the worker's errors in the setup readout's terms.
    const words = text.startsWith("worker ") ? `Something went wrong reading the pictures: ${text.slice("worker ".length)}` : text;
    if (this.notes.length < 12) this.notes.push(words.slice(0, 200));
  }

  /** What the coach says is also what the screen says, for whoever looks at it. */
  protected override say(text: string, repeatAfterMs?: number): void {
    super.say(text, repeatAfterMs);
    this.cb.instruction(text);
  }

  protected override onMessage(m: FromWorker): void {
    if (m.type === "photo") this.photoWaiter?.(m);
    else if (m.type === "status") {
      if (m.message === "Pose model ready") {
        this.modelLoaded = true;
        this.cb.modelReady(true);
      } else if (m.message === "Loading the pose model") {
        this.cb.modelReady(false);
      }
    }
  }

  /**
   * The first time on a phone the model is still downloading when the phone
   * is ready: the person waits by it, rather than standing in their outline
   * while a view's time runs out. Gives up after five minutes, or at once when
   * the worker has failed (its warning is on the screen).
   */
  private async untilModelLoaded(): Promise<void> {
    if (this.modelLoaded) return;
    this.cb.step({ kind: "starting", message: "Loading the pose model: about 30 MB, the first time on this phone" });
    await this.wait<true>({ poll: () => (this.modelLoaded || this.workerError ? true : null), timeoutMs: 300_000 });
  }

  private record(status: StoredCheck["status"]): StoredCheck {
    return {
      id: this.check.id,
      owner: this.check.owner,
      at: this.at,
      status,
      keepPhotos: this.photosOn && this.photosKept > 0,
      captures: this.captures,
      notes: this.notes,
      version: 1,
      repeatOf: this.check.repeatOf,
    };
  }

  private mark(round: number, view: View, mark: ViewMark): void {
    this.marks[round - 1][view] = mark;
    this.cb.marks(this.marks.map((m) => ({ ...m })));
  }

  async run(): Promise<void> {
    try {
      startPostureVoice(this.naturalVoice, allCheckLines());
      // With photos on, the check is on the phone from the start, so a photo
      // is never kept for a check that does not exist (and an abandoned one
      // is swept up, `sweepAbandoned`). Storage that will not open means no
      // photos, not no check.
      if (this.photosOn) {
        // The lock first, so no sweep ever sees this check without it.
        this.releaseLock = holdCheckLock(this.check.id);
        try {
          await saveCheck(this.record("running"));
        } catch (error) {
          this.photosOn = false;
          this.note(`Photos could not be kept on this phone: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.cb.marks(this.marks.map((m) => ({ ...m })));
      this.cb.step({ kind: "starting", message: "Starting the camera" });
      this.say(CHECK_LINES.stayByPhone, 0);
      await this.openMainLens(false);
      if (this.closed) return;
      await this.startPipeline();
      if (this.closed) return;
      this.cb.step({ kind: "starting", message: "Letting the color settle" });
      await this.settleAndLock();
      if (this.closed) return;
      await this.levelStep();
      if (this.closed) return;
      await this.plumbStep();
      if (this.closed) return;
      await this.untilModelLoaded();
      for (let round = 1; round <= ROUNDS && !this.finishing; round++) {
        if (round > 1) await this.betweenRounds();
        for (const view of VIEWS) {
          if (this.closed) return;
          if (this.finishing) break;
          await this.viewStep(view, round);
        }
      }
      if (this.closed) return;
      await this.finish();
    } catch (error) {
      if (this.closed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.releaseCamera();
      this.saved = true; // nothing to keep, and nothing for close() to undo
      void deleteCheck(this.check.owner, this.check.id)
        .catch(() => undefined)
        .finally(() => this.releaseLock());
      this.cb.failed(message);
    }
  }

  /* ---- ready at the phone ------------------------------------------------ */

  private async levelStep(): Promise<void> {
    this.startLevel();
    // The first readings take a moment to arrive.
    let a = this.sensorAttitude();
    for (let i = 0; i < 10 && !a; i++) {
      await sleep(100);
      a = this.sensorAttitude();
    }
    if (!a) {
      this.note("This phone reports no tilt, so the level was not checked.");
      return;
    }
    const ok = (x: { roll: number; pitch: number }) => Math.abs(x.roll) <= 1 && Math.abs(x.pitch) <= 2;
    if (!ok(a)) {
      this.say(CHECK_LINES.levelPhone, 0);
      let steadySince = 0;
      const outcome = await this.wait({
        poll: () => {
          const now = this.sensorAttitude();
          this.cb.step({ kind: "level", roll: now?.roll ?? null, pitch: now?.pitch ?? null });
          if (!now || !ok(now)) {
            steadySince = 0;
            return null;
          }
          steadySince ||= performance.now();
          return performance.now() - steadySince >= 1500 ? true : null;
        },
        actions: [{ id: "continue", label: "Continue anyway" }],
        timeoutMs: 120_000,
      });
      const last = this.sensorAttitude();
      if (outcome.kind !== "value" && last) {
        this.note(`The phone was not level: turned ${last.roll.toFixed(1)}°, tipped ${last.pitch.toFixed(1)}°.`);
      }
    }
    this.useSensorUp();
  }

  private async plumbStep(): Promise<void> {
    this.cb.step({ kind: "plumb" });
    this.cb.instruction("Finding the plumb line.");
    const { found } = await this.findPlumb({
      actions: [{ id: "skip", label: "Go on without it" }],
      timeoutMs: PLUMB_TIMEOUT_MS,
    });
    if (this.closed) return;
    if (found) {
      this.rollAtPlumb = this.sensorAttitude()?.roll ?? null;
      if (!found.pxPerMetre) this.note("The plumb line's tape marks were not seen, so there are no millimeters.");
    } else {
      this.say(CHECK_LINES.noPlumb, 0);
      this.note("No plumb line: true vertical came from the phone's own level, and there are no millimeters.");
      this.useSensorUp();
    }
    this.cb.vertical(this.upFrom, this.pxPerMetre);
  }

  /** The tripod knocked since the plumb line was found: find it again before measuring on. */
  private async checkNotMoved(): Promise<void> {
    if (this.upFrom !== "plumb" || this.rollAtPlumb === null) return;
    const now = this.sensorAttitude();
    if (!now || Math.abs(now.roll - this.rollAtPlumb) <= MOVED_DEG) return;
    this.say(CHECK_LINES.phoneMoved, 0);
    this.cb.step({ kind: "plumb" });
    const { found } = await this.findPlumb({ timeoutMs: REFIND_TIMEOUT_MS });
    if (found) {
      this.rollAtPlumb = this.sensorAttitude()?.roll ?? null;
      this.note("The phone moved during the check; the plumb line was found again.");
    } else {
      this.useSensorUp();
      this.rollAtPlumb = null;
      this.note("The phone moved during the check and the plumb line was not found again: later views use the phone's own level.");
    }
    this.cb.vertical(this.upFrom, this.pxPerMetre);
  }

  /* ---- the views ------------------------------------------------------- */

  private async viewStep(view: View, round: number): Promise<void> {
    await this.checkNotMoved();
    if (this.closed) return;
    this.mark(round, view, "now");
    const first = view === VIEWS[0];
    // Round two's front view was asked for by the round's own line.
    const cue = first && round === 1 ? SETUP_LINES.walkIn : first ? null : turnLine(view);
    if (cue) this.say(cue, 0);
    this.cb.step({ kind: "view", view, round, read: 0 });
    const held = await this.holdView(view, {
      holdFrames: HOLD_FRAMES,
      timeoutMs: VIEW_TIMEOUT_MS,
      actions: [
        { id: "skip", label: `Skip the ${VIEW_LABEL[view].toLowerCase()}` },
        ...(this.captures.length > 0 ? [{ id: "finish", label: "Finish with what's done" }] : []),
      ],
      progress: (read, _framing, pts) => {
        this.lastPose = pts;
        this.cb.step({ kind: "view", view, round, read });
      },
    });
    if (this.closed) return;
    if (held.outcome.kind !== "value" || !held.size) {
      if (held.outcome.kind === "action" && held.outcome.id === "finish") this.finishing = true;
      this.mark(round, view, "skipped");
      this.note(
        `${VIEW_LABEL[view]}, round ${round}: ${
          held.outcome.kind === "action" ? (held.outcome.id === "finish" ? "not taken, the check was finished early" : "skipped") : "no steady picture in time"
        }.`,
      );
      return;
    }
    let capture = this.captureOf(view, round, { ...held, size: held.size });
    // A sticker that slipped since last time is fixed before it is measured
    // (3b, the founder's call): once a view, in the first round.
    if (round === 1 && this.check.lastPlaces && !this.askedToFix.has(view)) {
      const slipped = shiftsBetween(placesOf([capture]), this.check.lastPlaces).filter((s) => s.mm >= SLIPPED_MM);
      if (slipped.length > 0) {
        this.askedToFix.add(view);
        capture = await this.fixStickers(view, round, capture, slipped);
        if (this.closed) return;
      }
    }
    this.captures.push(capture);
    if (this.photosOn && !this.photographed.has(view)) await this.keepViewPhoto(view, round);
    this.mark(round, view, "done");
    // A sticker missing in the first round can be put back before the second.
    if (round === 1) {
      for (const s of stickersIn(view).filter((x) => !capture.stickers[x.id]).slice(0, 2)) this.say(missingLine(s), 0);
    }
    this.say(SETUP_LINES.viewDone, 0);
    await sleep(1200);
  }

  private captureOf(view: View, round: number, held: Held & { size: NonNullable<Held["size"]> }): ViewCapture {
    return captureFrom({
      view,
      round,
      frames: held.frames,
      poses: held.poses,
      up: this.up ?? { x: 0, y: -1 },
      upFrom: this.up ? this.upFrom : "none",
      pxPerMetre: this.pxPerMetre,
      width: held.size.width,
      height: held.size.height,
      stillPx: held.stillPx,
    });
  }

  /**
   * A sticker is not where it was last time: the coach names it (two at most)
   * and asks the person to put it back, then waits for them to move to it and
   * reads the view again. "It's where it should be" keeps it as it is; so does
   * no move in half a minute. Either way the report says so.
   */
  private async fixStickers(view: View, round: number, capture: ViewCapture, slipped: Shift[]): Promise<ViewCapture> {
    const names = (shifts: Shift[]) => shifts.map((s) => `${s.name} (${s.words})`).join(", ");
    this.cb.step({ kind: "slipped", view, round, shifts: slipped });
    for (const s of slipped.slice(0, 2)) {
      const sticker = stickerById(s.id);
      if (sticker) this.say(slippedLine(sticker), 0);
    }
    this.say(CHECK_LINES.fixSticker, 0);
    const keep = [{ id: "keep", label: "It's where it should be" }];
    const kept = (why: string) => {
      this.note(`Not where last time's were: ${names(slipped)}. ${why}`);
      return capture;
    };

    // Hands on a sticker move the wrists, and bending moves the hips.
    const before = this.lastPose;
    const moved = (pts: PosePoint[]) => {
      if (!before) return true;
      const torso = torsoLength(before);
      return [15, 16, 23, 24].some((i) => Math.hypot(pts[i].x - before[i].x, pts[i].y - before[i].y) > 0.2 * torso);
    };
    this.setTask({ kind: "pose", model: MEASURING_MODEL, delegate: this.delegate });
    const move = await this.wait<true>({
      check: (r) => (!r.pose || r.pose.people === 0 || !r.pose.points ? true : moved(r.pose.points) ? true : null),
      actions: keep,
      timeoutMs: 30_000,
    });
    if (this.closed) return capture;
    if (move.kind === "action") return kept("Kept as they were, as you said.");
    if (move.kind === "timeout") return kept("Nobody moved to them, so they were kept as they were.");

    this.cb.step({ kind: "view", view, round, read: 0 });
    const again = await this.holdView(view, {
      holdFrames: HOLD_FRAMES,
      timeoutMs: VIEW_TIMEOUT_MS,
      actions: keep,
      progress: (read, _framing, pts) => {
        this.lastPose = pts;
        this.cb.step({ kind: "view", view, round, read });
      },
    });
    if (this.closed) return capture;
    if (again.outcome.kind !== "value" || !again.size) return kept("Kept as they were.");
    const next = this.captureOf(view, round, { ...again, size: again.size });
    const still = shiftsBetween(placesOf([next]), this.check.lastPlaces ?? {}).filter((s) => s.mm >= SLIPPED_MM);
    if (still.length > 0) this.note(`Still not where last time's were after a second look: ${names(still)}.`);
    else this.say(CHECK_LINES.stickerBack, 0);
    return next;
  }

  /** The photo of this view, kept by the worker; the check waits for it, briefly. */
  private keepViewPhoto(view: View, round: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.photoWaiter = null;
        this.note(`The ${VIEW_LABEL[view].toLowerCase()} photo was not kept: the phone took too long.`);
        resolve();
      }, 8000);
      this.photoWaiter = (m) => {
        if (m.view !== view || m.round !== round) return;
        window.clearTimeout(timer);
        this.photoWaiter = null;
        if (m.ok) {
          this.photosKept++;
          this.photographed.add(view);
        } else {
          this.note(`The ${VIEW_LABEL[view].toLowerCase()} photo was not kept: ${m.message ?? "no reason given"}.`);
        }
        resolve();
      };
      this.post({
        type: "photo",
        request: { checkId: this.check.id, view, round, longSide: PHOTO_LONG_SIDE, quality: PHOTO_QUALITY },
      });
    });
  }

  /**
   * Round two starts from a fresh stance: the person steps off and back on.
   * Waits for them to move off (or leave the picture), up to ten seconds, so
   * the second round is not the first stance read twice.
   */
  private async betweenRounds(): Promise<void> {
    this.cb.step({ kind: "between" });
    this.say(CHECK_LINES.roundTwo, 0);
    const before = this.lastPose;
    const hips = (p: PosePoint[]) => ({ x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 });
    this.setTask({ kind: "pose", model: MEASURING_MODEL, delegate: this.delegate });
    await this.wait<true>({
      check: (r) => {
        const pts = r.pose?.points;
        if (!r.pose || r.pose.people === 0 || !pts) return true;
        if (!before) return null;
        const a = hips(before);
        const b = hips(pts);
        return Math.hypot(a.x - b.x, a.y - b.y) > 0.3 * torsoLength(before) ? true : null;
      },
      timeoutMs: 10_000,
    });
  }

  private async finish(): Promise<void> {
    this.setTask({ kind: "idle" });
    this.cb.hideCamera(true);
    this.releaseCamera();
    if (this.captures.length === 0) {
      void deleteCheck(this.check.owner, this.check.id)
        .catch(() => undefined)
        .finally(() => this.releaseLock());
      this.saved = true; // nothing to keep, and nothing for close() to undo
      this.cb.failed("No view was held still long enough, so there is nothing to report. Check your setup, then try again.");
      return;
    }
    this.cb.step({ kind: "saving" });
    let saveError: string | null = null;
    try {
      await saveCheck(this.record("done"));
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
    this.saved = true;
    this.releaseLock();
    this.say(CHECK_LINES.done, 0);
    if (saveError === null) {
      // The numbers to the account (slice 3), so the report opens from there
      // with the history beside it; a slow or missing connection is left to
      // send later, and the report opens from this phone meanwhile.
      await sendPendingChecksWithin(this.check.owner, 4000);
    } else {
      // This phone could not keep it (a private window): straight to the
      // account instead, so the check is not lost with the page.
      const sent = await sendCheckNow({
        id: this.check.id,
        at: this.at,
        captures: this.captures,
        notes: this.notes,
        repeatOf: this.check.repeatOf,
      });
      saveError = "ok" in sent ? null : `${saveError}; ${sent.error}`;
    }
    this.cb.done({
      checkId: this.check.id,
      saved: saveError === null,
      saveError,
      captures: this.captures,
      notes: this.notes,
      at: this.at,
    });
  }
}
