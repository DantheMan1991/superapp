"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * How `/` finds this box.
 *
 * An id rather than a ref because the keymap lives in the thread list, which is
 * a sibling several levels away — threading a ref up through the pane layout
 * and back down would be a lot of plumbing to serve one keystroke.
 */
export const MAIL_SEARCH_INPUT_ID = "mail-search-input";

/**
 * Search, as a plain form that pushes a URL.
 *
 * Same doctrine as the Documents search box: the query belongs in the URL so a
 * result set can be linked, bookmarked and reloaded. No server action, no client
 * state to lose, and the input is uncontrolled and keyed on the URL so
 * navigating away resets it for free.
 *
 * The search itself runs on the MAIL SERVER — `Email/query` with a text filter.
 * Nothing is mirrored locally to search against, which is why results are as
 * good as the server's index rather than as good as our last sync.
 */
export function MailSearch({
  initial,
  params,
}: {
  initial: string;
  params: Record<string, string | undefined>;
}) {
  const router = useRouter();

  return (
    <form
      className="relative ml-auto"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("q");
        const trimmed = String(value ?? "").trim();
        const next = new URLSearchParams();
        // A search spans folders, so the folder falls away; an open message
        // from the previous view would be unrelated to the results.
        if (params.mailbox) next.set("mailbox", params.mailbox);
        if (trimmed) next.set("q", trimmed);
        router.push(
          next.toString()
            ? `/dashboard/m/email?${next}`
            : "/dashboard/m/email",
        );
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        key={initial}
        id={MAIL_SEARCH_INPUT_ID}
        type="search"
        name="q"
        defaultValue={initial}
        placeholder="Search mail…"
        maxLength={200}
        aria-label="Search mail"
        className="h-8 w-44 pl-8 sm:w-64"
      />
    </form>
  );
}
