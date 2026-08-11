"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Scopes `--module-accent` to whichever module you are inside.
 *
 * Every shared primitive reads that variable — `PageHeader`'s chip,
 * `EmptyState`'s circle, `CategoryStrip`'s active underline — so setting it once
 * here is what lets those components take on a module's colour without ever
 * learning a module's name. Adding a module means adding one `--accent-<slug>`
 * token in globals.css and nothing else.
 *
 * A client component because a server layout cannot see the pathname, and the
 * slug is the third segment of `/dashboard/m/<slug>/…`. Its children are still
 * server components; they are passed through untouched.
 *
 * Two details are load-bearing:
 *
 * - **`display: contents`.** A normal wrapper div would generate a box, and the
 *   full-width modules underneath this (Mail) size themselves against their
 *   parent — an extra box silently breaks a `h-full` chain. An element with
 *   `display: contents` generates no box at all, while custom properties still
 *   inherit straight through it.
 * - **The `var()` fallback.** An unknown slug would otherwise resolve
 *   `--module-accent` to an invalid value, and `text-module-accent` would stop
 *   rendering a colour anywhere on the page rather than looking slightly wrong.
 */
export default function ModuleLayout({ children }: { children: ReactNode }) {
  const slug = usePathname().split("/")[3] ?? "";
  return (
    <div
      style={
        {
          display: "contents",
          "--module-accent": `var(--accent-${slug}, var(--accent-brand))`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
