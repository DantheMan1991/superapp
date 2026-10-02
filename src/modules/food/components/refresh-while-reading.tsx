"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

/**
 * A draft still being read asks the server again every few seconds, so its
 * page turns into the editor (or the reason it failed) without a reload.
 * It stops by itself once the page no longer renders it.
 */
export function RefreshWhileReading({ every = 4_000 }: { every?: number }) {
  const router = useRouter();
  const refresh = useEffectEvent(() => router.refresh());
  useEffect(() => {
    const timer = window.setInterval(() => refresh(), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return null;
}
