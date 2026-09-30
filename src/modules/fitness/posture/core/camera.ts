/**
 * CHOOSING THE CAMERA (docs/modules/posture.md, "The camera"). Pure over what
 * the browser reports, so the choice is tested without a phone.
 *
 * Chrome on Android lists one camera per Camera2 id with a label like
 * "camera2 0, facing back" (older) or "camera 0, facing back". It never says
 * which lens is which, and `facingMode: "environment"` picks the HIGHEST-
 * numbered back camera, which on a Samsung is the ultrawide: every picture
 * would be bent by it. The main lens is Camera2 id 0 on every Android phone
 * we know of, and the one with the flash, so those two decide, and the choice
 * is kept per phone (device-settings.ts). Samsung does not show Chrome its
 * zoom lenses at all.
 */

export type CameraFacing = "back" | "front" | "unknown";

export type CameraInfo = {
  deviceId: string;
  label: string;
  facing: CameraFacing;
  /** The number in the label, when there is one. */
  index: number | null;
  maxWidth: number;
  maxHeight: number;
  torch: boolean;
  zoomMax: number | null;
  focusModes: readonly string[];
  exposureModes: readonly string[];
  whiteBalanceModes: readonly string[];
};

export function parseCameraLabel(label: string): { index: number | null; facing: CameraFacing } {
  const index = /camera2?\s+(\d+)/i.exec(label);
  const facing = /facing back|back|rear|environment/i.test(label)
    ? "back"
    : /facing front|front|user/i.test(label)
      ? "front"
      : "unknown";
  return { index: index ? Number(index[1]) : null, facing };
}

export type RankedCamera = CameraInfo & { score: number; why: string[] };

/** Back cameras, best first for measuring a person three metres away. */
export function rankCameras(cameras: readonly CameraInfo[]): RankedCamera[] {
  const ranked = cameras
    .filter((c) => c.facing !== "front")
    .map((c): RankedCamera => {
      const why: string[] = [];
      let score = 0;
      if (c.facing === "back") {
        score += 100;
        why.push("faces back");
      }
      if (c.index === 0) {
        score += 50;
        why.push("Android's first camera, the main lens");
      }
      if (c.torch) {
        score += 20;
        why.push("has the flash");
      }
      const pixels = c.maxWidth * c.maxHeight;
      score += Math.min(10, pixels / 1_500_000);
      return { ...c, score, why };
    });
  return ranked.sort((a, b) => b.score - a.score || (a.index ?? 99) - (b.index ?? 99));
}

/**
 * What to ask for once the camera is chosen: its full picture, 4K when it has
 * it, at 30 frames a second, unscaled. Portrait phones swap width and height,
 * so the settings are read back rather than assumed.
 */
export function streamConstraints(deviceId: string): {
  audio: false;
  video: Record<string, unknown>;
} {
  return {
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30 },
      resizeMode: "none",
    },
  };
}

/** The locks a check wants, in the order to try them, from what the camera says it can do. */
export type LockPlan = {
  whiteBalance: boolean;
  focus: { distance: number | null } | null;
  exposure: { iso: number; exposureTime: number } | null;
};

export function lockPlan(
  caps: { whiteBalanceMode?: readonly string[]; focusMode?: readonly string[]; exposureMode?: readonly string[] },
  settings: { focusDistance?: number; iso?: number; exposureTime?: number },
): LockPlan {
  return {
    // "manual" is Chrome's AWB lock: the colour gains stay where they are.
    whiteBalance: (caps.whiteBalanceMode ?? []).includes("manual"),
    focus: (caps.focusMode ?? []).includes("manual")
      ? { distance: Number.isFinite(settings.focusDistance) ? settings.focusDistance! : null }
      : null,
    // Chrome's manual exposure keeps the exposure time but not the ISO, so a
    // lock needs both read back first, or the picture jumps.
    exposure:
      (caps.exposureMode ?? []).includes("manual") && Number.isFinite(settings.iso) && Number.isFinite(settings.exposureTime)
        ? { iso: settings.iso!, exposureTime: settings.exposureTime! }
        : null,
  };
}
