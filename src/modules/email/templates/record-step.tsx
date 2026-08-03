"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchTemplateEntitiesAction } from "./entity-actions";
import type { LinkableEntity } from "@/lib/mail-extensions/types";

/**
 * "Which invoice?" — the step between choosing a template and inserting it.
 *
 * Only shown when the template actually names a business-object placeholder,
 * so the ordinary case stays one click. A template that says
 * `{{invoice.number}}` cannot be filled without somebody answering this, and
 * asking is the honest alternative to guessing.
 *
 * Search rather than a list, and the same reasoning the recipient autocomplete
 * records: a business has thousands of invoices, and the one somebody wants is
 * the one they can already name.
 */
export function RecordStep({
  entityType,
  label,
  onChoose,
  onCancel,
}: {
  entityType: string;
  /** "invoice" — used in the prompt, so it reads as the thing being asked for. */
  label: string;
  onChoose: (entity: LinkableEntity) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  /**
   * Results stored WITH the query that produced them.
   *
   * Two things fall out of that, both learned by the recipient autocomplete.
   * Server actions do not cancel, so a slow answer for "acme" can land after a
   * fast one for "acme builders" and repopulate the list backwards — holding
   * the query alongside makes "are these still about what is being typed?" a
   * comparison at render rather than a cleanup. And it means the effect never
   * calls `setState` synchronously, which React 19's lint rule correctly
   * refuses; clearing on an empty box is derived below instead.
   */
  const [answer, setAnswer] = useState<{ query: string; results: LinkableEntity[] }>(
    { query: "", results: [] },
  );
  const [busy, setBusy] = useState(false);

  const term = query.trim();
  const results = answer.query === term ? answer.results : [];

  useEffect(() => {
    if (term.length === 0) return;
    let live = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      const result = await searchTemplateEntitiesAction({ entityType, query: term });
      if (!live) return;
      setBusy(false);
      if ("error" in result) return;
      setAnswer({ query: term, results: result.data });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, entityType]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-80 rounded-md border bg-popover p-2 shadow-md">
      <p className="px-1 pb-2 text-xs text-muted-foreground">
        This template needs {article(label)}{" "}
        <span className="font-medium text-foreground">{label}</span>. Search for
        the one this message is about.
      </p>
      <div className="relative">
        <Search className="absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          placeholder={`Search ${label}s…`}
          className="h-8 pl-7 text-sm"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
        />
      </div>

      <ul className="mt-1 max-h-56 overflow-auto">
        {busy && results.length === 0 && (
          <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Searching…
          </li>
        )}
        {!busy && term.length > 0 && results.length === 0 && (
          <li className="px-2 py-2 text-xs text-muted-foreground">
            Nothing matching. You can insert the template anyway and fill it in
            by hand.
          </li>
        )}
        {results.map((entity) => (
          <li key={`${entity.entityType}:${entity.entityId}`}>
            <button
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => onChoose(entity)}
            >
              <span className="block truncate">{entity.label}</span>
              {entity.sublabel && (
                <span className="block truncate text-xs text-muted-foreground">
                  {entity.sublabel}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
        onClick={onCancel}
      >
        Insert without filling it in
      </button>
    </div>
  );
}

/** "an invoice", "a customer" — the prompt reads as a sentence or it grates. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
