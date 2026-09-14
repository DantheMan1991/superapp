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
import {
  listeningFrom,
  toldFrom,
  readNativeBridge,
  urlWantsToTell,
  utteranceFrom,
} from "@/lib/native-bridge";

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
  /**
   * A sentence the PHONE heard before this page existed.
   *
   * When it is set, the sheet opens with the words already in it and reads
   * them immediately — and, critically, does NOT start the web's own
   * recorder. The phone already listened. Two microphones for one sentence is
   * the bug that would replace the slow one.
   */
  const [heard, setHeard] = useState<string | null>(null);
  /**
   * The PHONE is recording right now, and this page is the only thing that can
   * say so — `SpeechRecognizer` draws nothing, which is exactly why it is
   * fast. Without this the sheet would paint an idle box over a live
   * microphone, which is worse than the slow version it replaced.
   */
  const [phoneListening, setPhoneListening] = useState(false);

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
    const tell = bridge?.tell;

    let handles: Array<{ remove(): void | Promise<void> }> = [];
    let dropped = false;

    /** Open with the words already in hand, whichever way they arrived. */
    const take = (said: string) => {
      if (dropped) return;
      setPhoneListening(false);
      setHeard(said);
      setOpen(true);
    };

    void (async () => {
      try {
        if (tell) {
          // WAS THIS A LONG-PRESS? Asked first and answered by the shell, and
          // the sheet opens on a yes WHATEVER the microphone did. Everything
          // below decides what it opens WITH, never whether.
          const told = toldFrom(await tell.wasTold());
          if (told && !dropped) {
            opened.current = true;
            setOpen(true);
          }

          // THE COLD-START CASE, and the usual one: somebody finished speaking
          // while the site was still downloading, so the words were waiting
          // before this component existed.
          const pending = await tell.takePending();
          const said = utteranceFrom(pending);
          if (said) {
            opened.current = true;
            take(said);
          } else if (listeningFrom(pending)) {
            // STILL TALKING. The page won the race, which is the good problem:
            // show that the phone is recording rather than sitting idle until
            // the words land.
            opened.current = true;
            setPhoneListening(true);
            setOpen(true);
          }
          /*
           * THE SHELL TRIED AND CAME BACK WITH NOTHING has no branch any more,
           * and that is the point rather than an omission.
           *
           * A LONG-PRESS MUST NEVER END IN AN EMPTY SCREEN — a recogniser that
           * dies early (busy service, no speech, started before the activity was
           * ready) used to leave the sheet shut and the press wasted, which the
           * founder found. The sheet now opens on `told` WHATEVER the microphone
           * did, a few lines above, and the box listens whenever the phone is
           * neither recording nor holding words. Both halves fall out of the
           * general rule, so the special case that used to carry them is gone.
           */
          const whileListening = await tell.addListener("listening", (payload) => {
            const on = listeningFrom(payload);
            setPhoneListening(on);
            // The phone taking over means this page must not also record —
            // which `phoneListening` now says on its own.
            if (on) setOpen(true);
          });
          if (dropped) void whileListening.remove();
          else handles.push(whileListening);
          // And the other way round — a second long-press while the app is
          // already open, or a slow talker on a fast connection.
          const listener = await tell.addListener("utterance", (payload) => {
            const now = utteranceFrom(payload);
            if (now) take(now);
          });
          if (dropped) void listener.remove();
          else handles.push(listener);
        }

        if (!app) return;
        const launch = await app.getLaunchUrl();
        // Only open ourselves when the shell did NOT already listen. On a
        // build with native capture the recogniser is what opens; jumping in
        // here would put a second microphone on top of it.
        if (!dropped && !tell && !opened.current && urlWantsToTell(launch?.url)) {
          opened.current = true;
          setOpen(true);
        }
        const urlListener = await app.addListener("appUrlOpen", (payload) => {
          const url =
            typeof payload === "object" && payload !== null
              ? (payload as { url?: unknown }).url
              : null;
          if (!tell && urlWantsToTell(url)) setOpen(true);
        });
        if (dropped) void urlListener.remove();
        else handles.push(urlListener);
      } catch {
        // A shell without the plugins, or a phone that refuses. The floating
        // button is untouched; only the shortcut is missing.
      }
    })();

    return () => {
      dropped = true;
      for (const handle of handles) void handle.remove();
      handles = [];
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
              key={heard ?? (open ? "open" : "closed")}
              /*
               * **THE WEB LISTENS UNLESS THE PHONE IS HANDLING THIS ONE.**
               *
               * This used to ask whether the shell CAN listen (`nativeEars`)
               * and treat that as whether it IS. Those differ in exactly one
               * place, and it is the ordinary one: **tapping the floating
               * button inside a running app.** Nothing ever told the shell to
               * listen on that path, so the web did not either, and the founder
               * had to press Say it a second time — *"it's the phone that i
               * have to click the mike and then the say something button"*.
               *
               * The question that is actually being asked is whether this
               * utterance is the phone's. Two facts answer it, and both are
               * only ever set by the launch-url path: `phoneListening` while
               * the shell records, `heard` once it has delivered words.
               *
               * That subsumes `webShouldListen`, which existed for the case
               * where the shell tried and came back with nothing — with the
               * phone neither listening nor having heard, this now says yes on
               * its own. One rule, stated once, instead of a capability
               * standing in for a state.
               */
              autoListen={open && !phoneListening && heard === null}
              said={heard ?? undefined}
              phoneListening={phoneListening}
              labelHidden
              speechConfigured={speechConfigured}
              onRecorded={() => {
                setHeard(null);
                setPhoneListening(false);
                setOpen(false);
              }}
              placeholder="Clock me in, and three chicks dead in pen two"
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
