"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** What the composer needs to insert one. The body is already sanitized. */
export interface PickableTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
}

/**
 * Choose a canned response and drop it into the message being written.
 *
 * A plain button and list rather than a popover component, matching the
 * composer's other panels. The list closes on an OUTSIDE CLICK rather than on
 * blur, for the reason the recipient autocomplete records: blur fires before
 * the click that picked a row, so closing on blur means the list disappears
 * before it can be used.
 */
export function TemplatePicker({
  templates,
  disabled,
  onPick,
}: {
  templates: PickableTemplate[];
  disabled: boolean;
  onPick: (template: PickableTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Absent rather than disabled when the business has none. A control that can
  // only ever say "nothing here" is noise in a toolbar somebody uses every day
  // — the same call the composer makes for the picture button in a signature.
  if (templates.length === 0) return null;

  return (
    <div ref={wrap} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Insert a saved reply"
      >
        <FileText className="size-4" />
        <span className="hidden sm:inline">Template</span>
      </Button>

      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-72 overflow-auto rounded-md border bg-popover py-1 shadow-md"
        >
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPick(template);
                  setOpen(false);
                }}
              >
                <span className="block truncate font-medium">{template.name}</span>
                {template.subject && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {template.subject}
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
