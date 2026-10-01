import type { ReactNode } from "react";
import { PostureLockGuard } from "@/modules/fitness/posture/components/posture-lock-guard";

/**
 * THE POSTURE PAGES (docs/modules/posture.md). Every one of them is locked:
 * the proxy gives a page load the content security policy that lets it reach
 * this site and Clerk and nothing else, and the guard keeps a page from
 * running without it, or the lock from following the person out (ADR 0122,
 * src/lib/posture-lock.ts).
 */
export default function PostureLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PostureLockGuard />
      {children}
    </>
  );
}
