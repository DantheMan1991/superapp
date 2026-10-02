import { useEffect } from "react";

/**
 * A KITCHEN TIMER'S ALARM (D1b): three rising chimes and a buzz, every second
 * and a half, until the person stops it. Web Audio, because a phone only lets
 * a page make sound after a tap, and starting a timer is that tap
 * (`unlockAlarm`). The buzz is the phone's own (`navigator.vibrate`): Android
 * in Chrome and in the app (1.0.8 declares VIBRATE); an iPhone has none.
 *
 * It rings only while cook mode is on the screen. The screen is kept on for
 * it, but a phone put away, or another app in front, hears nothing until cook
 * mode comes back, when a timer that ended meanwhile is ringing at once.
 */

let context: AudioContext | null = null;

/** Call from a tap: the one moment a phone lets the page start sound. */
export function unlockAlarm(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {
    context = null;
  }
}

function chime(): void {
  try {
    navigator.vibrate?.([250, 120, 250]);
  } catch {
    // No buzz on this phone; the sound still plays.
  }
  if (!context || context.state !== "running") return;
  const start = context.currentTime;
  [880, 1175, 1568].forEach((frequency, i) => {
    const at = start + i * 0.22;
    const tone = context!.createOscillator();
    const gain = context!.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.45, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    tone.connect(gain).connect(context!.destination);
    tone.start(at);
    tone.stop(at + 0.21);
  });
}

/** Ring while `ringing` holds: at once, then every 1.5 s. */
export function useAlarm(ringing: boolean): void {
  useEffect(() => {
    if (!ringing) return;
    chime();
    const every = window.setInterval(chime, 1500);
    return () => window.clearInterval(every);
  }, [ringing]);
}
