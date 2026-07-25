"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const TABS = [
  { href: "/dashboard/m/documents", label: "Overview", exact: true },
  { href: "/dashboard/m/documents/browse", label: "Browse" },
  { href: "/dashboard/m/documents/inbox", label: "Inbox" },
  { href: "/dashboard/m/documents/search", label: "Search" },
  { href: "/dashboard/m/documents/shares", label: "Shared links" },
  { href: "/dashboard/m/documents/trash", label: "Trash" },
];

/**
 * Module sub-nav plus the search box, so search is reachable from anywhere in
 * the cabinet rather than only from its own page.
 *
 * Search is a plain GET form: the query belongs in the URL so a result set can
 * be linked, bookmarked and reloaded. No server action, no client state to
 * lose.
 */
export function DocumentsNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  // The URL is the single source of truth for the query. The input is
  // uncontrolled and keyed on it, so navigating between result pages resets
  // the box for free — no state to hold, and no setState-in-an-effect to keep
  // the two in step.
  const urlQuery = params.get("q") ?? "";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-px">
      <nav className="flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <form
        className="relative pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("q");
          const trimmed = String(value ?? "").trim();
          if (trimmed.length === 0) return;
          router.push(
            `/dashboard/m/documents/search?q=${encodeURIComponent(trimmed)}`,
          );
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          key={urlQuery}
          type="search"
          name="q"
          defaultValue={urlQuery}
          placeholder="Search files…"
          maxLength={200}
          aria-label="Search documents"
          className="w-56 pl-8"
        />
      </form>
    </div>
  );
}
