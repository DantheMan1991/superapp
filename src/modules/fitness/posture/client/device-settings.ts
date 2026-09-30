import type { Delegate } from "../worker/protocol";

/**
 * WHAT THIS PHONE LEARNED ABOUT ITSELF (docs/modules/posture.md): the camera
 * that is the main lens, whether its graphics chip can run the pose model, how
 * far its tilt sensor is off true, and the last setup readout (numbers only).
 * Kept on the phone, per browser, in localStorage: none of it is about the
 * person, and all of it is about this device. Never a picture (ADR 0118).
 */

const KEY = "yosher.posture.device.v1";

export type DeviceSettings = {
  cameraId?: string;
  cameraLabel?: string;
  /** The pose model's delegate this phone should use: the GPU only once it has agreed with the CPU. */
  delegate?: Delegate;
  /** Sensor roll minus the plumb line's roll, degrees: what to take off the sensor's reading. */
  sensorRollOffset?: number;
  /** The last setup readout, as copied (numbers and words only). */
  lastReadout?: string;
  lastReadoutAt?: string;
  /** "Keep a photo of each view on this phone", as last set on this phone. Off until turned on. */
  keepPhotos?: boolean;
};

export function readDeviceSettings(): DeviceSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeviceSettings) : {};
  } catch {
    return {};
  }
}

export function writeDeviceSettings(change: Partial<DeviceSettings>): DeviceSettings {
  const next = { ...readDeviceSettings(), ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A private window: this page only.
  }
  return next;
}
