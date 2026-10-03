import type { ReactNode } from "react";
import { PageLockGuard } from "@/components/app/page-lock-guard";

/**
 * HEALTH'S PROGRESS PHOTOS (docs/modules/health.md, H2b; ADR 0128). Every page
 * here is locked as the posture check's are (ADR 0122): the proxy gives a page
 * load the content security policy that lets it reach this site and Clerk and
 * nothing else, so no script on it can send a photo anywhere, and the guard
 * keeps a page from running without it, or the lock from following the person
 * out.
 */
export default function PhotosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageLockGuard area="health-photos" />
      {children}
    </>
  );
}
