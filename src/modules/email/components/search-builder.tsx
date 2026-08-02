"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import { mailHref } from "./mail-panes";
import type { MailViewQuery } from "../organise/filters";

/**
 * The advanced search.
 *
 * EVERY FIELD HERE WAS VERIFIED AGAINST THE LIVE SERVER before it was offered —
 * `npm run mail:probe-search` runs each JMAP condition against a message built
 * to match and a decoy built not to. The check that matters is the second one:
 * a condition the server ACCEPTS AND IGNORES turns a narrow search into "here is
 * everything", which reads as a bad search rather than a bug and never gets
 * reported. `header` is absent because it is the one condition the probe could
 * not make behave.
 *
 * IT WRITES TO THE URL, like every other piece of state in this module. That is
 * what makes an advanced search linkable, reloadable, survivable by the back
 * button — and saveable, because a saved search is just these parameters
 * written down. There is no second query language and no client state to keep in
 * step; submitting is a navigation.
 */
export function SearchBuilder({
  query,
  params,
  folders,
}: {
  query: MailViewQuery;
  params: Record<string, string | undefined>;
  folders: JmapMailbox[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    from: query.from ?? "",
    to: query.to ?? "",
    subject: query.subject ?? "",
    body: query.body ?? "",
    after: query.after ?? "",
    before: query.before ?? "",
    mailbox: query.mailbox ?? "",
  });

  function set(key: keyof typeof draft, value: string) {
    setDraft((prior) => ({ ...prior, [key]: value }));
  }

  function search() {
    setOpen(false);
    router.push(
      mailHref(params, {
        ...Object.fromEntries(
          Object.entries(draft).map(([key, value]) => [key, value.trim() || undefined]),
        ),
        // A new search starts at the top. Carrying the old offset is how
        // somebody lands on page 4 of a result set with three pages.
        pos: undefined,
        message: undefined,
      }),
    );
  }

  const active =
    query.from || query.to || query.subject || query.body || query.after || query.before;

  return (
    <div className="relative">
      <Button
        size="sm"
        variant={active ? "secondary" : "ghost"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden sm:inline">Advanced</span>
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-30 mt-1 w-[22rem] max-w-[90vw] rounded-md border bg-background p-3 shadow-md">
            <div className="space-y-2">
              <Field label="From" value={draft.from} onChange={(v) => set("from", v)} onSubmit={search} placeholder="name or address" />
              <Field label="To" value={draft.to} onChange={(v) => set("to", v)} onSubmit={search} placeholder="name or address" />
              <Field label="Subject" value={draft.subject} onChange={(v) => set("subject", v)} onSubmit={search} />
              <Field label="Body" value={draft.body} onChange={(v) => set("body", v)} onSubmit={search} placeholder="words in the message" />

              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">Folder</span>
                <select
                  value={draft.mailbox}
                  onChange={(e) => set("mailbox", e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                >
                  {/* Anywhere is the DEFAULT, because the common failure of a
                      mail search is being told "no results" when the message
                      exists in a folder you were not standing in. */}
                  <option value="">Anywhere</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">Between</span>
                <input
                  type="date"
                  aria-label="After"
                  value={draft.after}
                  onChange={(e) => set("after", e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                />
                <input
                  type="date"
                  aria-label="Before"
                  value={draft.before}
                  onChange={(e) => set("before", e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                />
              </div>
              {/* Said plainly, because "before" is genuinely ambiguous and the
                  filter resolves it to the END of that day. */}
              <p className="text-[0.65rem] text-muted-foreground">
                Both dates are included.
              </p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={search}>
                Search
              </Button>
              {active && (
                <Button size="sm" variant="ghost" asChild>
                  <Link
                    href={mailHref(params, {
                      from: undefined,
                      to: undefined,
                      subject: undefined,
                      body: undefined,
                      after: undefined,
                      before: undefined,
                      pos: undefined,
                    })}
                    onClick={() => setOpen(false)}
                  >
                    Clear
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-16 shrink-0 text-xs text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-8"
        // Enter searches, which is what a field in a search panel is for. Wired
        // through a callback rather than by walking the DOM for a button — that
        // finds whichever one happens to come first, which is exactly the kind
        // of thing that keeps working until the markup moves.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
