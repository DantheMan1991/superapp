"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { matchOptions, type ComboboxOption } from "./combobox-filter";

export type { ComboboxOption } from "./combobox-filter";

interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** The chosen option's `value`; `undefined` shows the placeholder. */
  value: string | undefined;
  onValueChange: (value: string) => void;
  /** What the trigger reads when nothing is chosen. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** What the list reads when nothing matches. */
  emptyText?: string;
  disabled?: boolean;
  /** Trigger classes — height and width, the way a `SelectTrigger` takes them. */
  className?: string;
  id?: string;
  "aria-label"?: string;
}

/**
 * A select you can type into.
 *
 * `ui/select` is Radix's `Select`: a closed list you scroll. That is right for
 * five payment methods and wrong for a chart of accounts — the bank review
 * queue offered forty-nine accounts in one popover, and on a phone finding
 * `6300 · Insurance` in it meant thumbing past the whole asset section. This
 * opens a popover with a search box at the top and narrows the list on every
 * keystroke (`combobox-filter.ts` says how), so the account is two or three
 * characters away wherever it sits in the chart.
 *
 * Hand-rolled on `ui/popover` rather than pulling in `cmdk`, for the reason the
 * command palette gives: the list is small, the matching is one function, and a
 * dependency for it would be the only one of its kind in the tree. The trigger
 * copies `SelectTrigger`'s face so a form can mix the two without the reader
 * noticing which is which.
 *
 * Two touch details the desktop never hits. The search box is `text-base` below
 * `md`, because iOS zooms the page into any input smaller than 16px the moment
 * it is focused. And an option handles `onMouseDown` by preventing default, so
 * choosing one does not blur the search box first and close the popover under
 * the tap.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Pick one",
  searchPlaceholder = "Type to search…",
  emptyText = "Nothing matches.",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => matchOptions(options, query), [options, query]);

  // Clamped during render rather than reset in an effect, the way the command
  // palette does it: a keystroke that narrows the list must not leave the
  // cursor pointing past the end.
  const active = matches.length === 0 ? 0 : Math.min(cursor, matches.length - 1);

  function choose(option: ComboboxOption) {
    onValueChange(option.value);
    setOpen(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Start on what is already chosen, so Enter with no typing keeps it.
      const at = options.findIndex((o) => o.value === value);
      setCursor(at < 0 ? 0 : at);
    } else {
      setQuery("");
      setCursor(0);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? Math.min(active + 1, matches.length - 1)
          : Math.max(active - 1, 0);
      setCursor(next);
      listRef.current
        ?.querySelectorAll("[data-combobox-item]")
        [next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = matches[active];
      if (option) choose(option);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            // `SelectTrigger`'s face, so the two read as one control.
            "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-divider px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            role="searchbox"
            aria-autocomplete="list"
            aria-controls={listId}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:h-9 md:text-sm"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="max-h-64 overflow-y-auto p-1"
        >
          {matches.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            matches.map((option, index) => {
              const chosen = option.value === value;
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={chosen}
                  data-combobox-item=""
                  onMouseMove={() => setCursor(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm md:py-1.5",
                    index === active && "bg-muted",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                  {chosen && (
                    <Check className="size-4 shrink-0 text-module-accent" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
