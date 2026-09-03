"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CircleQuestionMark } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { GUIDES_HREF, type HelpPayload } from "@/lib/guides-core";
import { cn } from "@/lib/utils";

/**
 * Loaded when the panel first opens, not with the page. `PageHeader` puts this
 * button on every screen in the product, and a markdown parser in every
 * screen's bundle is the wrong price for a button most visits never press.
 * The first `next/dynamic` in the codebase; `ssr: false` is allowed because
 * this file is a client component.
 */
const Markdown = dynamic(() => import("./markdown").then((mod) => mod.Markdown), {
  ssr: false,
  loading: () => <Skeleton className="h-24 w-full" />,
});

type Entry =
  | { status: "loading" }
  | { status: "ready"; payload: HelpPayload }
  | { status: "error" };

/**
 * The "?" beside a page's actions, and the panel it opens with the guide for
 * the screen the reader is on.
 *
 * It knows where it is from the pathname alone, so `PageHeader` can render it
 * without learning which page it is inside. Outside `/dashboard` — the admin
 * pages and the public share page use the same header — it renders nothing,
 * and on the Guides pages themselves it would only point at itself.
 *
 * The query string is read at click time from `window.location`, not from
 * `useSearchParams`: that hook demands a Suspense boundary on any statically
 * rendered page, and this button sits on every page there is.
 */
export function HelpButton({ className }: { className?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  // Close on navigation — adjusted during render, the shell's device for its
  // drawer, rather than in an effect (`react-hooks/set-state-in-effect`).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  if (!pathname.startsWith("/dashboard") || pathname.startsWith(GUIDES_HREF)) {
    return null;
  }

  const show = () => {
    const search = window.location.search;
    const key = `${pathname}${search}`;
    setActiveKey(key);
    setOpen(true);
    if (entries[key]) return;
    setEntries((prev) => ({ ...prev, [key]: { status: "loading" } }));
    const url = `/api/help?path=${encodeURIComponent(pathname)}&search=${encodeURIComponent(search)}`;
    fetch(url, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`help ${response.status}`);
        return (await response.json()) as HelpPayload;
      })
      .then((payload) =>
        setEntries((prev) => ({ ...prev, [key]: { status: "ready", payload } })),
      )
      .catch(() => setEntries((prev) => ({ ...prev, [key]: { status: "error" } })));
  };

  const entry = activeKey ? entries[activeKey] : undefined;
  const guide = entry?.status === "ready" ? entry.payload.guide : null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("text-muted-foreground", className)}
        aria-label="Help for this page"
        onClick={show}
      >
        <CircleQuestionMark />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        {/* Nothing body-portalled goes inside: a popover or a select inside a
            modal sheet paints but cannot be clicked (see app-shell.tsx). */}
        <SheetContent
          side="right"
          className="flex flex-col gap-0 p-0 data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{guide?.title ?? "Help"}</SheetTitle>
            <SheetDescription>
              {guide?.summary ??
                (entry?.status === "loading"
                  ? "Finding the guide for this screen."
                  : "The guide for the screen you are on.")}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {entry?.status === "loading" && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            )}
            {entry?.status === "error" && (
              <EmptyState
                title="The guide could not be loaded"
                description="Try again in a moment."
              />
            )}
            {entry?.status === "ready" && !guide && (
              <EmptyState
                title="No guide for this screen yet"
                description="Guides are being written screen by screen. Everything written so far is on the Guides page."
              />
            )}
            {guide && (
              <Markdown
                source={guide.content}
                linkBase={{ root: GUIDES_HREF, slug: guide.slug }}
              />
            )}
          </div>
          <SheetFooter className="flex-row items-center justify-between border-t">
            <Link
              href={GUIDES_HREF}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              All guides
            </Link>
            {guide && (
              <Button asChild size="sm" variant="outline">
                <Link href={`${GUIDES_HREF}/${guide.slug}`}>Open full guide</Link>
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
