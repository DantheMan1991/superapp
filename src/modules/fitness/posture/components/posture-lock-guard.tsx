"use client";

import { PageLockGuard } from "@/components/app/page-lock-guard";

/**
 * KEEPS THE POSTURE PAGES' LOCK WHERE IT BELONGS (src/lib/posture-lock.ts,
 * ADR 0122): the shared guard (`PageLockGuard`, which Health's progress photos
 * use too, ADR 0128) for the posture area. A page load that began outside the
 * posture pages reloads so the proxy locks it; leaving them reloads where the
 * person went, so the lock stays behind.
 */
export function PostureLockGuard() {
  return <PageLockGuard area="posture" />;
}
