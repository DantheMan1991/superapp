"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Long enough to finish a word, short enough that the list feels live. */
const DEBOUNCE_MS = 350;

/**
 * The search box above a list.
 *
 * It owns exactly one thing: the `q` parameter of the current URL. The page
 * reads that parameter and searches on the server, so the term survives a
 * refresh, can be sent to somebody, and applies to every row rather than to
 * the fifty on screen. Typing replaces the URL after a short pause (Enter
 * replaces it at once), and every commit drops `page`, because a new
 * question starts on its first page.
 *
 * `router.replace`, not `push`: each keystroke would otherwise be a history
 * entry and Back would walk through the search letter by letter.
 *
 * The box tracks the URL, not only the other way round: a pill that carries
 * the term through, or Back, changes `q` under it, and the box has to show
 * what the list is showing. That is the render-time compare below — the
 * pattern conventions.md prescribes instead of setting state in an effect.
 */
export function ListSearch({
  placeholder,
  className,
}: {
  placeholder: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("q") ?? "";
  const [value, setValue] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setValue(current);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    const p = new URLSearchParams(params.toString());
    const term = next.trim();
    if (term) p.set("q", term);
    else p.delete("q");
    p.delete("page");
    router.replace(p.size > 0 ? `${pathname}?${p}` : pathname);
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  }

  return (
    <div className={cn("relative w-full sm:w-60", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(value);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="h-9 pl-8"
      />
    </div>
  );
}
