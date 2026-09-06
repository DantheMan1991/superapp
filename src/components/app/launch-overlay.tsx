"use client";

import { useEffect, useState } from "react";
import { LAUNCH_COOKIE } from "@/lib/launch";

/**
 * The launch animation, played once per app launch (src/lib/launch.ts):
 * the Yosher mark zooms in on a cool blue, holds a beat, then the whole
 * overlay lifts away to reveal the sign-in card or the business beneath —
 * which has been loading behind it the whole time.
 *
 * Rendered by the server (so it is on screen from the first byte, with no
 * flash of the page under it) and removed by the client when the animation
 * ends. Styles are inline: the overlay must look right before any stylesheet
 * has arrived, and it is the one piece of the site that is not the design
 * system's business.
 *
 * Timing: 650ms in, 450ms hold, 400ms out — about a second and a half.
 * A reader who asked their phone for less motion gets a plain fade.
 */

const IN_MS = 650;
const HOLD_MS = 450;
const OUT_MS = 400;
const TOTAL_MS = IN_MS + HOLD_MS + OUT_MS;

const BACKGROUND =
  "linear-gradient(160deg, #13203e 0%, #17346e 52%, #2457c5 100%)";

export function LaunchOverlay() {
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), IN_MS + HOLD_MS);
    const end = window.setTimeout(() => {
      // A session cookie: gone when the app is closed, which is the next time
      // the launch should play. The server reads it and renders no overlay.
      document.cookie = `${LAUNCH_COOKIE}=1; path=/; SameSite=Lax`;
      setDone(true);
    }, TOTAL_MS);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(end);
    };
  }, []);

  if (done) return null;

  return (
    <div
      aria-hidden="true"
      data-launch-overlay=""
      className={leaving ? "yl-out" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BACKGROUND,
        pointerEvents: "none",
      }}
    >
      <style>{`
        @keyframes yl-in {
          from { transform: scale(0.55); opacity: 0; }
          60%  { opacity: 1; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes yl-lift {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(1.06); }
        }
        [data-launch-overlay] .yl-mark {
          width: 132px; height: 132px; border-radius: 30px; overflow: hidden;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08);
          animation: yl-in ${IN_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
        }
        [data-launch-overlay] .yl-mark img { width: 100%; height: 100%; display: block; }
        [data-launch-overlay].yl-out { animation: yl-lift ${OUT_MS}ms ease-in both; }
        @media (prefers-reduced-motion: reduce) {
          [data-launch-overlay] .yl-mark { animation: none; }
          [data-launch-overlay].yl-out { animation-name: yl-lift; transform: none; }
        }
      `}</style>
      <div className="yl-mark">
        {/* A plain img, not next/image: it must not wait for a loader or a layout pass. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/yosher-mark.png" alt="" width={132} height={132} decoding="sync" />
      </div>
    </div>
  );
}
