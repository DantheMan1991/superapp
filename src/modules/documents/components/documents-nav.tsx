"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Search,
  Share2,
  Tags,
  Trash2,
  FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

const TABS: CategoryItem[] = [
  {
    href: "/dashboard/m/documents",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  { href: "/dashboard/m/documents/browse", label: "Browse", icon: FolderOpen },
  { href: "/dashboard/m/documents/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/m/documents/search", label: "Search", icon: Search },
  { href: "/dashboard/m/documents/tags", label: "Tags", icon: Tags },
  {
    href: "/dashboard/m/documents/templates",
    label: "Templates",
    icon: FileText,
  },
  {
    href: "/dashboard/m/documents/shares",
    label: "Shared links",
    icon: Share2,
  },
  { href: "/dashboard/m/documents/trash", label: "Trash", icon: Trash2 },
];

/**
 * Module sub-nav plus the search box, so search is reachable from anywhere in
 * the cabinet rather than only from its own page.
 *
 * Search is a plain GET form: the query belongs in the URL so a result set can
 * be linked, bookmarked and reloaded. No server action, no client state to
 * lose.
 *
 * Eight text tabs became a `CategoryStrip` — one row that scrolls rather than
 * wrapping, with an icon over each label. The search box rides in the strip's
 * `trailing` slot, which is what keeps it on the same hairline as the sections
 * and out of the scroller, so it cannot scroll out of reach. Its old active
 * state was `border-brand`, and `--brand` measures 2.81:1 on white; the strip
 * uses `--module-accent`, which here is Documents' amber.
 */
export function DocumentsNav() {
  const params = useSearchParams();
  const router = useRouter();
  // The URL is the single source of truth for the query. The input is
  // uncontrolled and keyed on it, so navigating between result pages resets
  // the box for free — no state to hold, and no setState-in-an-effect to keep
  // the two in step.
  const urlQuery = params.get("q") ?? "";

  return (
    <CategoryStrip
      items={TABS}
      trailing={
        <form
          className="relative"
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
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            key={urlQuery}
            type="search"
            name="q"
            defaultValue={urlQuery}
            placeholder="Search files…"
            maxLength={200}
            aria-label="Search documents"
            // Pill, matching the command trigger in the rail: both are search.
            className="h-9 w-56 rounded-full pl-9"
          />
        </form>
      }
    />
  );
}
