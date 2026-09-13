"use client";

import { useEffect, useState } from "react";
import { LAUNCH_COOKIE } from "@/lib/launch";
import { readNativeBridge, toldFrom, urlWantsToTell } from "@/lib/native-bridge";

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
    let out = 0;
    let end = 0;

    /** Remember the launch has had its animation, however it ended. */
    const remember = () => {
      // A session cookie: gone when the app is closed, which is the next time
      // the launch should play. The server reads it and renders no overlay.
      document.cookie = `${LAUNCH_COOKIE}=1; path=/; SameSite=Lax`;
    };

    /*
     * NOT ON A LAUNCH THAT IS ABOUT SPEED.
     *
     * Long-pressing the icon and picking "Say it" means somebody wants to
     * record something NOW; a second and a half of logo is a second and a half
     * of them talking to a mark. The founder counted it twice.
     *
     * The shell also sets the cookie natively before the page loads, which
     * skips this on the SERVER and is the version with no flash at all. It is
     * kept as well as this, not instead: `CookieManager` before a WebView
     * exists is exactly the sort of thing that works on one Android version
     * and silently does nothing on another — and when it does nothing, this is
     * what keeps the promise. One frame instead of fifteen hundred
     * milliseconds.
     */
    const bridge = readNativeBridge(window);
    const tell = bridge?.tell;
    const app = bridge?.app;
    if (tell || app) {
      void (async () => {
        const skip = () => {
          window.clearTimeout(out);
          window.clearTimeout(end);
          remember();
          setDone(true);
        };
        try {
          /*
           * THE SHELL'S OWN ANSWER FIRST, and it is the one that is trusted.
           *
           * `TellPlugin.wasTold()` is a boolean this app sets in Java and
           * reads here, with nothing in between. The two cleverer versions
           * both failed silently on a real phone — a cookie set before any
           * WebView exists, and Capacitor's `getLaunchUrl()`, which depends on
           * how Capacitor chooses to record an intent it did not define. Both
           * were guesses about somebody else's code, and the founder counted
           * the same second and a half three times.
           */
          if (tell && toldFrom(await tell.wasTold())) return skip();
          // An older build has `App` but no `wasTold`. Still worth asking:
          // being wrong here only means the animation plays.
          if (app && urlWantsToTell((await app.getLaunchUrl())?.url)) skip();
        } catch {
          // No answer: the ordinary animation plays, which is never wrong,
          // only slow.
        }
      })();
    }

    out = window.setTimeout(() => setLeaving(true), IN_MS + HOLD_MS);
    end = window.setTimeout(() => {
      remember();
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
