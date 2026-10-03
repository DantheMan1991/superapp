"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { todayInTimezone } from "@/lib/timezone";

/**
 * TODAY STAYS TODAY (Health H1; Food's Today, D4a). A phone keeps a page open
 * for days; a Today drawn yesterday would mark yesterday's habits, show
 * yesterday's night, and log a meal against yesterday. So when the page is
 * looked at again, and once a minute while it is, it asks the space's own
 * day, and fetches the page afresh when that has moved on. Health's actions
 * refuse a day that is not today as well (`NEW_DAY`): this is the page
 * keeping up, that is the backstop. Render it only on a page showing today.
 *
 * Once per day the phone reaches: a phone whose clock is wrong would otherwise
 * fetch the page every minute, since the server's day never catches it up.
 */
export function DayWatch({ today, timeZone }: { today: string; timeZone: string }) {
  const router = useRouter();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    function check() {
      if (document.visibilityState !== "visible") return;
      const now = todayInTimezone(timeZone);
      if (now === today || now === asked.current) return;
      asked.current = now;
      router.refresh();
    }
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [today, timeZone, router]);
  return null;
}
