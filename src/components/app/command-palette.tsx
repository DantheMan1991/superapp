"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { getIcon } from "@/components/app/icon-registry";
import { cn } from "@/lib/utils";

export interface CommandItem {
  href: string;
  label: string;
  /** Section caption in the list, e.g. "Modules". */
  group?: string;
  /** Icon name — a string, because the shell builds this list on the server. */
  icon?: string;
  /** Extra words that should match, beyond the label. */
  keywords?: string;
}

interface CommandPaletteProps {
  items: readonly CommandItem[];
  className?: string;
}

/**
 * Search, as a pill; the palette behind it, as Notion's.
 *
 * The two references disagree about what this should be, and the split is the
 * whole design: Airbnb's search is a wide rounded pill that is the most
 * prominent thing on the page, Notion's is a quiet row that you never click
 * because you press a key instead. So the trigger is Airbnb's — it advertises
 * that search exists, which a keyboard shortcut alone does not — and everything
 * that happens after you hit it is Notion's.
 *
 * Scope note: this indexes *navigation* only, which is what the shell can hand
 * it as static data. Searching records means a server action per keystroke and
 * per-module scoping, so it is deliberately not here yet — a palette that
 * returns nothing for a customer's name would train people not to use it, so
 * the placeholder does not promise records either.
 */
export function CommandPalette({ items, className }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.group ?? ""} ${item.keywords ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  // Clamped during render rather than reset in an effect: after a keystroke
  // narrows the list, a cursor left pointing past the end would highlight
  // nothing and Enter would do nothing. Same reasoning as the drawer in
  // app-shell.tsx — comparing against the current value resolves in this pass.
  const active = matches.length === 0 ? 0 : Math.min(cursor, matches.length - 1);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    setCursor(0);
    router.push(href);
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? Math.min(active + 1, matches.length - 1)
          : Math.max(active - 1, 0);
      setCursor(next);
      listRef.current
        ?.querySelectorAll("[data-command-item]")
        [next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = matches[active];
      if (item) go(item.href);
    }
  };

  let lastGroup: string | undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-full bg-card px-3.5 text-sm text-subtle-foreground shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          className,
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">Jump to…</span>
        <kbd className="ml-auto hidden shrink-0 rounded-sm border border-border px-1.5 text-[11px] leading-4 font-medium sm:block">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          // Higher than centre and wider than the default `sm:max-w-sm`: a
          // palette that grows downwards should not jump as the list resizes.
          className="top-[12%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 shadow-elevation-3 ring-0 sm:max-w-lg"
          onKeyDown={onListKeyDown}
        >
          <DialogTitle className="sr-only">Jump to</DialogTitle>
          <div className="flex items-center gap-2.5 border-b border-divider px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              placeholder="Jump to a page"
              aria-label="Jump to a page"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
            />
          </div>

          <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
            {matches.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              matches.map((item, index) => {
                const Icon = getIcon(item.icon);
                const caption = item.group !== lastGroup ? item.group : undefined;
                lastGroup = item.group;
                return (
                  <div key={item.href}>
                    {caption && (
                      <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-subtle-foreground">
                        {caption}
                      </p>
                    )}
                    <button
                      type="button"
                      data-command-item
                      onClick={() => go(item.href)}
                      onMouseEnter={() => setCursor(index)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        index === active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
