"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { splitRecipients } from "../compose/addresses";
import { searchRecipientsAction } from "../contacts/actions";
import type { ContactSuggestion } from "../contacts/rank";

/**
 * A recipient field that suggests people.
 *
 * IT STAYS A TEXT FIELD, and that is the load-bearing decision. Every other
 * composer turns recipients into chips, which means the value lives in a
 * component's state and pasting six addresses out of a spreadsheet becomes a
 * fight. This is still the same comma-separated string `parseRecipients` has
 * always handled — the suggestions only ever REPLACE THE LAST FRAGMENT, so
 * everything already typed is untouched and somebody who ignores the dropdown
 * entirely gets exactly the behaviour they had before.
 *
 * The consequence worth knowing: a suggestion is a shortcut, never a
 * commitment. Nothing here validates, nothing rejects, and the send path's
 * existing parser is still the only thing that decides what an address is.
 */

/** Long enough that a typist does not fire a query per keystroke. */
const DEBOUNCE_MS = 200;
/** Below this, everybody matches and the list is noise. */
const MIN_QUERY = 2;

export function RecipientInput({
  id,
  value,
  onChange,
  mailboxId,
  placeholder,
  autoComplete = "off",
  /** Addresses already in the OTHER recipient fields, so nobody is offered twice. */
  otherFields,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  mailboxId: string;
  placeholder?: string;
  autoComplete?: string;
  otherFields: string;
}) {
  /**
   * Results kept WITH the query that produced them.
   *
   * Not two pieces of state, because they are one fact. Storing the list alone
   * meant the effect had to clear it whenever the query got too short — a
   * setState inside an effect, which React 19 correctly refuses, and which is
   * also how a list from a previous fragment briefly renders against a new one.
   * Pairing them makes "are these results still about what is being typed?" a
   * comparison rather than a cleanup.
   */
  const [results, setResults] = useState<{ query: string; items: ContactSuggestion[] }>({
    query: "",
    items: [],
  });
  const [dismissed, setDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  /**
   * Guards against an older query's answer landing after a newer one's.
   *
   * Server actions do not cancel, so a slow request for "da" can resolve after
   * a fast one for "dank" and repopulate the list with stale rows. Comparing
   * against the latest issued query is what stops the dropdown flickering
   * backwards while somebody types.
   */
  const latest = useRef("");

  /** What is being typed right now: everything after the last comma. */
  const fragment = lastFragment(value);

  useEffect(() => {
    const query = fragment.trim();
    latest.current = query;
    // Nothing is CLEARED here — a short query simply fetches nothing, and the
    // render below ignores results that do not belong to the current fragment.
    if (query.length < MIN_QUERY) return;

    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await searchRecipientsAction({
          mailboxId,
          query,
          // Both fields, so somebody already in Cc is not offered for To.
          chosen: [
            ...splitRecipients(value).map(addressOf),
            ...splitRecipients(otherFields).map(addressOf),
          ].filter(Boolean),
        });
        // See `latest`: a stale answer is dropped rather than rendered.
        if (latest.current !== query) return;
        setResults({ query, items: "error" in result ? [] : result.data });
        setCursor(0);
        setDismissed(false);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fragment, mailboxId, otherFields, value]);

  /**
   * The list is shown when the results are ABOUT the current fragment.
   *
   * Derived rather than stored, which is what removes the effect that used to
   * clear it — and it means a list can never linger over a query it does not
   * answer, however the two fell out of step.
   */
  const suggestions = results.query === fragment.trim() ? results.items : [];
  const open = !dismissed && suggestions.length > 0;

  // Closing on an outside click rather than on blur: blur fires before the
  // click that picked a row, which would dismiss the list before it was used.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setDismissed(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = useCallback(
    (suggestion: ContactSuggestion) => {
      const before = value.slice(0, value.length - lastFragment(value).length);
      const formatted = formatRecipient(suggestion);
      // A trailing ", " so the next name can be typed straight away — the whole
      // point of an autocomplete is not having to reach for punctuation.
      onChange(`${before}${formatted}, `);
      // The fragment is now empty, so `suggestions` derives to [] on the next
      // render and the list closes on its own.
      setDismissed(true);
    },
    [onChange, value],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    // Enter and Tab both commit, because both are what people press. Enter is
    // NOT allowed to fall through to the form while the list is open, or
    // picking a recipient would send the message.
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(suggestions[cursor]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
    }
  }

  return (
    <div ref={box} className="relative flex-1">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setDismissed(false)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-suggestions`}
      />
      {open && (
        <ul
          id={`${id}-suggestions`}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border bg-background py-1 shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.email}-${index}`} role="option" aria-selected={index === cursor}>
              <button
                type="button"
                // Same reason the toolbar buttons do it: mousedown would move
                // focus out of the input before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(suggestion)}
                className={cn(
                  "flex w-full min-w-0 items-baseline gap-2 px-2.5 py-1.5 text-left",
                  index === cursor ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                {/* min-w-0 on the flex child, or `truncate` has nothing to
                    truncate against and a long address widens the dropdown. */}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {suggestion.name || suggestion.email}
                </span>
                {suggestion.name && (
                  <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
                    {suggestion.email}
                  </span>
                )}
                {suggestion.sublabel && (
                  <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                    {suggestion.sublabel}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Everything after the last comma — what is being typed right now. */
export function lastFragment(value: string): string {
  const comma = value.lastIndexOf(",");
  return comma < 0 ? value : value.slice(comma + 1);
}

/**
 * `Aoife Ó Braonáin <aoife@example.com>`, or the bare address.
 *
 * Quoted when the name carries a comma, or the recipient parser on the way back
 * would split one person into two — the same rule `composer.tsx` follows when it
 * prefills a reply.
 */
export function formatRecipient(suggestion: {
  name: string;
  email: string;
}): string {
  const name = suggestion.name.trim();
  if (name.length === 0) return suggestion.email;
  const safe = name.includes(",") ? `"${name.replace(/"/g, "")}"` : name;
  return `${safe} <${suggestion.email}>`;
}

/** The address out of `Name <addr>`, for the already-chosen list. */
function addressOf(entry: string): string {
  const match = /<([^>]*)>/.exec(entry);
  return (match ? match[1] : entry).trim();
}
