"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Mic } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TellBox } from "@/components/app/tell-box";
import { cn } from "@/lib/utils";
import { readNativeBridge, urlWantsToTell } from "@/lib/native-bridge";

/**
 * SAY IT FROM ANYWHERE. The floating control, on every page of the dashboard.
 *
 * ── WHY IT IS NOT ON A PAGE, AND NOT IN THE RAIL ─────────────────────────────
 *
 * ADR 0039 put the box on the livestock daily round and said that a second
 * filler would move it to What needs you. That answered "where can it be
 * reached from" and the founder asked the better question: *"shouldn't this be
 * prominent... and probably every page?"* If the whole point is saying it
 * instead of finding the screen, then having to reach a particular screen
 * first is the same cost in a different shape. ADR 0051.
 *
 * **Not the nav rail**, which was the founder's own first suggestion and is
 * wrong for one specific reason: on a phone the rail is a DRAWER
 * (`app-shell.tsx`). Putting the fastest way in behind a hamburger, on the
 * device this exists for, would make it three taps again.
 *
 * Bottom right because that is where a thumb is. The rail is left, the header
 * is top, and neither is reachable one-handed on a phone with the other hand
 * holding a bucket.
 *
 * ── THE PRESS IS THE TAP ─────────────────────────────────────────────────────
 *
 * Opening the sheet STARTS THE LISTENING (`autoListen`). Somebody who pressed
 * a microphone has said what they want; a second press to begin would be the
 * tap ADR 0050 just removed. The sheet is what shows that it is listening —
 * a microphone that gives no sign of being on is worse than a button.
 *
 * It closes itself once something is recorded, so the whole interaction for
 * "clock me in" is: press, speak, done.
 */
export function TellLauncher({
  speechConfigured,
}: {
  speechConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const opened = useRef(false);

  /*
   * ONE TAP FROM THE HOME SCREEN.
   *
   * Long-pressing the app icon fires `yosher://tell`, which Capacitor hands
   * to the page — on a cold start through `getLaunchUrl`, on a warm one
   * through `appUrlOpen` — and the WEB is what decides it means "open already
   * listening" (ADR 0032). Not a line of Java: the shortcut is declarative in
   * the manifest and every decision about it is here.
   *
   * `?tell=1` on any dashboard url does the same, because a second door is
   * coming (a Siri intent handing over to the site) and it should not need a
   * second mechanism.
   *
   * `opened` guards it so a re-render, or an `appUrlOpen` arriving while the
   * sheet is already up, cannot restart a recording over the top of one.
   */
  /*
   * `?tell=1` IS ANSWERED DURING RENDER, not in an effect.
   *
   * React's documented way to react to a changed prop, and the pattern
   * `app-shell.tsx` already uses to close its drawer on navigation: comparing
   * against the previous value during render resolves in the SAME pass, where
   * an effect would paint a closed sheet and then open it.
   * `react-hooks/set-state-in-effect` refuses the effect form, and is right to.
   */
  const askedByUrl = params.get("tell") === "1";
  const [answeredUrl, setAnsweredUrl] = useState(false);
  if (askedByUrl && !answeredUrl) {
    setAnsweredUrl(true);
    setOpen(true);
    // NOT `opened.current = true` — a ref may not be written during render,
    // and it would be redundant anyway: `answeredUrl` is this path's own
    // guard, and the ref below guards a different thing entirely (the
    // cold-start url being read twice). The two doors do not need to know
    // about each other; opening an open sheet is a no-op.
  }

  // Taking it back out of the url is a navigation, not state, so it belongs
  // here: a refresh or a back button must not open the microphone again.
  // `replace` rather than `push` — this was never a place in the history.
  useEffect(() => {
    if (answeredUrl && askedByUrl) router.replace(pathname);
  }, [answeredUrl, askedByUrl, pathname, router]);

  /*
   * ONE TAP FROM THE HOME SCREEN.
   *
   * Long-pressing the app icon fires `yosher://tell`, which Capacitor hands to
   * the page — on a cold start through `getLaunchUrl`, on a warm one through
   * `appUrlOpen` — and the WEB decides it means "open already listening"
   * (ADR 0032). Not a line of Java: the shell declares the door, every
   * decision about it is here, and changing what a long-press DOES is a web
   * deploy rather than a store release.
   *
   * Setting state from inside the async callback is fine and the lint rule
   * agrees: it is not synchronous in the effect body, and it genuinely is a
   * response to something that arrived from outside React.
   */
  useEffect(() => {
    const bridge = readNativeBridge(window);
    const app = bridge?.app;
    if (!app) return;

    let handle: { remove(): void | Promise<void> } | null = null;
    let dropped = false;

    void (async () => {
      try {
        const launch = await app.getLaunchUrl();
        if (!dropped && !opened.current && urlWantsToTell(launch?.url)) {
          opened.current = true;
          setOpen(true);
        }
        const listener = await app.addListener("appUrlOpen", (payload) => {
          const url =
            typeof payload === "object" && payload !== null
              ? (payload as { url?: unknown }).url
              : null;
          // A warm open can arrive at any time. Not guarded by `opened`,
          // because a SECOND long-press after a recording finished should
          // work — that guard is only about the cold-start url being read
          // twice.
          if (urlWantsToTell(url)) setOpen(true);
        });
        if (dropped) void listener.remove();
        else handle = listener;
      } catch {
        // A shell without the plugin, or a phone that refuses. The floating
        // button is untouched; only the shortcut is missing.
      }
    })();

    return () => {
      dropped = true;
      void handle?.remove();
    };
  }, []);

  // NOT on the guides shelf or a guide page. Those are the one place somebody
  // is reading rather than doing, and a button that covers the last line of a
  // paragraph is the kind of thing that makes people stop reading the manual.
  if (pathname.startsWith("/dashboard/guides")) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Tell Yosher what happened"
        className={cn(
          // `fixed` so it stays put while the page scrolls, and clear of the
          // phone's home indicator via the safe-area inset — without it this
          // sits under the swipe bar on an iPhone and takes two tries to hit.
          "fixed right-4 z-40 flex size-14 items-center justify-center rounded-full",
          "bottom-[calc(1rem+env(safe-area-inset-bottom))]",
          "bg-primary text-primary-foreground shadow-lg",
          "transition-transform hover:scale-105 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          // Out of the way of a mouse on a desktop, where there is room and
          // nobody is holding anything.
          "lg:size-12",
          "print:hidden",
        )}
      >
        <Mic className="size-6 lg:size-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          // UP FROM THE BOTTOM, not in from the side: it is anchored to the
          // button that opened it, and the thumb is already down there.
          side="bottom"
          className="max-h-[85svh] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>Tell it what happened</SheetTitle>
            <SheetDescription>
              Say it or type it. Nothing that moves animals, stock or money is
              recorded until you have read it back.
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-6">
            {/* Remounted per opening by the `key`, so every press starts a
                fresh sentence and a fresh listen rather than reviving whatever
                was left on screen last time. */}
            <TellBox
              key={open ? "open" : "closed"}
              autoListen={open}
              labelHidden
              speechConfigured={speechConfigured}
              onRecorded={() => setOpen(false)}
              placeholder="Clock me in, and three chicks dead in pen two"
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
