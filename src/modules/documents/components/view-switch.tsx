"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VIEW_MODES,
  VIEW_MODE_COOKIE,
  VIEW_MODE_LABELS,
  type ViewMode,
} from "../lib/view-mode";

const ICONS: Record<ViewMode, typeof List> = {
  list: List,
  icons: LayoutGrid,
  thumbs: ImageIcon,
};

/**
 * List / Icons / Thumbnails.
 *
 * Plain links rather than buttons with state: the mode is a URL parameter, so
 * a particular view is linkable, survives a reload and works with the back
 * button — the same rule search and saved views follow. It also means no
 * client state to get out of step with what is on screen.
 *
 * Every other parameter is preserved, so switching view never silently drops
 * the folder cursor a colleague sent you.
 */
export function ViewSwitch({ current }: { current: ViewMode }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefFor = (mode: ViewMode) => {
    const next = new URLSearchParams(params.toString());
    next.set("view", mode);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div
      className="inline-flex rounded-md border"
      role="group"
      aria-label="Layout"
    >
      {VIEW_MODES.map((mode) => {
        const Icon = ICONS[mode];
        const active = mode === current;
        return (
          <Link
            key={mode}
            href={hrefFor(mode)}
            aria-label={VIEW_MODE_LABELS[mode]}
            aria-current={active ? "true" : undefined}
            title={VIEW_MODE_LABELS[mode]}
            // Remember the choice so it survives navigating to another folder,
            // where the URL carries no ?view= at all. Written before the
            // navigation so the server already sees it on the next request.
            onClick={() => {
              document.cookie = `${VIEW_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
            }}
            className={cn(
              "px-2.5 py-2 text-muted-foreground transition-colors first:rounded-l-md last:rounded-r-md hover:text-foreground",
              active && "bg-secondary text-foreground",
            )}
          >
            <Icon className="size-4" />
          </Link>
        );
      })}
    </div>
  );
}
