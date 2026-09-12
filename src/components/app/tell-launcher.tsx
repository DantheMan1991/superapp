"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
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
