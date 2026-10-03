/**
 * WHICH CAMERA IS WHICH, FROM WHAT THE BROWSER CALLS IT. Pure; shared by the
 * posture check (docs/modules/posture.md, "The camera") and Health's progress
 * photos (docs/modules/health.md, H2b).
 *
 * Chrome on Android lists one camera per Camera2 id with a label like
 * "camera2 0, facing back" (older) or "camera 0, facing back". It never says
 * which lens is which, and `facingMode: "environment"` picks the HIGHEST-
 * numbered back camera, which on a Samsung is the ultrawide: a body in it is
 * bent at the edges. The main lens is Camera2 id 0 on every Android phone we
 * know of. Labels are empty until the person has allowed the camera once.
 */

export type CameraFacing = "back" | "front" | "unknown";

export function parseCameraLabel(label: string): { index: number | null; facing: CameraFacing } {
  const index = /camera2?\s+(\d+)/i.exec(label);
  const facing = /facing back|back|rear|environment/i.test(label)
    ? "back"
    : /facing front|front|user/i.test(label)
      ? "front"
      : "unknown";
  return { index: index ? Number(index[1]) : null, facing };
}

/**
 * The main back lens among the cameras the browser lists: a back camera, the
 * lowest Camera2 id first (0 is the main lens). Null when no label says
 * "back" (no permission yet, or a laptop), and the caller asks for
 * `facingMode: "environment"` instead.
 */
export function mainBackCamera(devices: readonly { deviceId: string; label: string }[]): string | null {
  const backs = devices
    .map((d) => ({ deviceId: d.deviceId, ...parseCameraLabel(d.label) }))
    .filter((d) => d.facing === "back")
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  return backs[0]?.deviceId ?? null;
}
