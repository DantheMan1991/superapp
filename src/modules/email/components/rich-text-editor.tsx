"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The composer's editing surface.
 *
 * A `contenteditable` driven by `document.execCommand`. That API is formally
 * deprecated and has no replacement — every browser still implements it, and the
 * alternatives are a 300 KB editor framework or reimplementing selection and
 * undo by hand, neither of which is proportionate for bold, italic, lists and
 * links. The deprecation is recorded here rather than discovered later.
 *
 * WHAT MAKES THAT CHOICE SAFE, given execCommand emits different markup in every
 * browser — `<b>` here, `<span style="font-weight:bold">` there, `<div>` versus
 * `<p>` for a new line: **nothing this component produces is trusted.** The
 * server runs `sanitizeOutboundHtml` over the submitted body and normalizes it
 * down to a dozen tags. So browser variance is absorbed rather than fought, and
 * this file can stay a thin wrapper over the platform.
 *
 * TWO RULES HERE ARE SECURITY RATHER THAN STYLE.
 *
 * **Paste is plain text, always.** The default paste inserts the source
 * document's markup straight into the editable — stylesheets, tracking pixels,
 * hidden text, whatever the page or the other email carried. That content would
 * then leave under our user's own From header, which is the exact threat
 * `compose/html.ts` is written against. Intercepting the paste and inserting
 * `text/plain` means hostile markup never enters the document, so the server
 * sanitizer is defence in depth rather than the only guard. The cost is real and
 * accepted: pasting from Word or another email loses its formatting.
 *
 * **`createLink` is never given the raw input.** execCommand will happily build
 * `href="javascript:…"` from whatever string it is handed, so the URL is checked
 * and defaulted to `https://` here before the command sees it. The sanitizer
 * would drop it later regardless; this is what stops it looking like a working
 * link in the editor first.
 */

export interface RichTextEditorHandle {
  /** Current markup. Read on submit — never mirrored into React state. */
  html: () => string;
}

/** Schemes a composed link may use. The sanitizer enforces the same list. */
const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;

function normalizeLinkInput(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  if (SAFE_SCHEME.test(value)) return value;
  // A scheme we do not allow is refused rather than repaired — prefixing
  // `https://` onto `javascript:alert(1)` would produce a link to a host called
  // "javascript". Anything else is assumed to be a bare host or an address.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

/**
 * The toolbar, as DATA at module scope rather than an array built during render.
 *
 * Not a style preference: building it inside the component means each entry
 * closes over `run`, which reads a ref, and React's `react-hooks/refs` rule
 * correctly refuses an array assembled during render that reaches a ref through
 * its members. Describing what each button DOES and resolving it in the click
 * handler keeps ref access where it belongs — in an event handler.
 */
type Action =
  | { kind: "exec"; command: string; arg?: string }
  | { kind: "link" };

interface ToolbarButton {
  key: string;
  label: string;
  Icon: typeof Bold;
  /** Shown in the tooltip when the shortcut is the browser's own. */
  shortcut?: string;
  action: Action;
}

const TOOLBAR: ToolbarButton[] = [
  { key: "bold", label: "Bold", Icon: Bold, shortcut: "Ctrl+B", action: { kind: "exec", command: "bold" } },
  { key: "italic", label: "Italic", Icon: Italic, shortcut: "Ctrl+I", action: { kind: "exec", command: "italic" } },
  { key: "underline", label: "Underline", Icon: Underline, shortcut: "Ctrl+U", action: { kind: "exec", command: "underline" } },
  { key: "ul", label: "Bulleted list", Icon: List, action: { kind: "exec", command: "insertUnorderedList" } },
  { key: "ol", label: "Numbered list", Icon: ListOrdered, action: { kind: "exec", command: "insertOrderedList" } },
  { key: "quote", label: "Quote", Icon: Quote, action: { kind: "exec", command: "formatBlock", arg: "blockquote" } },
  { key: "link", label: "Insert link", Icon: Link2, action: { kind: "link" } },
  { key: "unlink", label: "Remove link", Icon: Link2Off, action: { kind: "exec", command: "unlink" } },
  { key: "clear", label: "Clear formatting", Icon: RemoveFormatting, action: { kind: "exec", command: "removeFormat" } },
];

export function RichTextEditor({
  initialHtml,
  editorRef,
  disabled,
  ariaLabel = "Message body",
}: {
  /**
   * The starting document — signature and quote, built and sanitized on the
   * server. Applied ONCE, on mount: React must never re-render the editable's
   * children or it would fight the browser for the caret on every keystroke.
   */
  initialHtml: string;
  editorRef: React.RefObject<RichTextEditorHandle | null>;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  /** The selection the link dialog was opened over, restored before applying. */
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.innerHTML = initialHtml;
    // `styleWithCSS` off asks the browser for `<b>` rather than
    // `<span style="font-weight:bold">`. Not load-bearing — the sanitizer drops
    // the style attribute either way and the text survives — but it means the
    // common case produces markup that survives sanitizing intact.
    try {
      document.execCommand("styleWithCSS", false, "false");
    } catch {
      // Some browsers throw on an unsupported command name rather than
      // returning false. The editor works without it.
    }
    // The caret starts at the very top, above the signature and the quote,
    // which is where a person is about to type.
    const selection = window.getSelection();
    if (selection && node.firstChild) {
      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    // Deliberately not depending on initialHtml: a change to it after mount
    // would blow away what somebody has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editorRef.current = { html: () => host.current?.innerHTML ?? "" };
    return () => {
      editorRef.current = null;
    };
  }, [editorRef]);

  const run = useCallback((command: string, value?: string) => {
    // Focus first: execCommand acts on the document's selection, and a toolbar
    // button steals focus on mousedown unless that is prevented — which it is,
    // below — but a click that arrives with the editor unfocused would otherwise
    // silently do nothing.
    host.current?.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      // An unsupported command is a missing button, not a broken composer.
    }
  }, []);

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    // See the file header: this is the control, not a convenience.
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    // insertText keeps the browser's own undo stack, which manual DOM surgery
    // would break — and an editor where Ctrl-Z does not undo a paste is one
    // people stop trusting with anything long.
    run("insertText", text);
  }, [run]);

  const openLink = useCallback(() => {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkValue("");
    setLinkOpen(true);
  }, []);

  const applyLink = useCallback(() => {
    const href = normalizeLinkInput(linkValue);
    setLinkOpen(false);
    if (!href) return;
    host.current?.focus();
    // Restoring the range matters: focusing the editable after the input had it
    // collapses the selection to wherever the browser feels like, and
    // `createLink` with a collapsed selection links nothing at all.
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    const collapsed = selection?.isCollapsed ?? true;
    if (collapsed) {
      // Nothing selected: insert the URL as its own link rather than doing
      // nothing, which is what `createLink` would do and what reads as a
      // button that missed.
      run("insertHTML", `<a href="${escapeAttr(href)}">${escapeText(href)}</a>`);
      return;
    }
    run("createLink", href);
  }, [linkValue, run]);

  return (
    <div className="rounded-md border">
      <div
        className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
        role="toolbar"
        aria-label="Formatting"
      >
        {TOOLBAR.map(({ key, label, Icon, action, shortcut }) => (
          <button
            key={key}
            type="button"
            title={shortcut ? `${label} (${shortcut})` : label}
            aria-label={label}
            disabled={disabled}
            // The whole reason the toolbar works: a button takes focus on
            // mousedown, which collapses the selection in the editable before
            // the click ever fires. Preventing the default keeps the selection
            // the command is about to act on.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              action.kind === "link" ? openLink() : run(action.command, action.arg)
            }
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground",
              "hover:bg-secondary hover:text-foreground disabled:opacity-40",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>

      {linkOpen && (
        <div className="flex items-center gap-2 border-b bg-secondary/40 px-2 py-1.5">
          <input
            autoFocus
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setLinkOpen(false);
              }
            }}
            placeholder="example.com or name@example.com"
            aria-label="Link address"
            className="h-7 flex-1 rounded-sm border bg-background px-2 text-xs outline-none"
          />
          <button
            type="button"
            onClick={applyLink}
            className="rounded-sm px-2 py-1 text-xs font-medium hover:bg-secondary"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      <div
        ref={host}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        onPaste={onPaste}
        // `plaintext-only` is NOT used: it is what would make paste safe for
        // free, but it also disables every formatting command in the toolbar.
        className={cn(
          "y-compose min-h-[18rem] w-full overflow-auto px-3 py-2 text-sm outline-none",
          "focus-visible:ring-0",
        )}
      />
      {/*
        Scoped to the editable so it cannot leak into the app's own chrome. The
        list styles are the ones that matter: Tailwind's preflight strips list
        markers globally, so `insertUnorderedList` would appear to do nothing at
        all — a bullet list with no bullets reads as a broken button.
      */}
      <style>{`
.y-compose blockquote { margin: 0 0 0 0.8em; padding-left: 0.8em;
  border-left: 2px solid #ccc; color: inherit; }
.y-compose ul { list-style: disc; padding-left: 1.5em; margin: 0.4em 0; }
.y-compose ol { list-style: decimal; padding-left: 1.5em; margin: 0.4em 0; }
.y-compose li { display: list-item; }
.y-compose a { text-decoration: underline; }
.y-compose:empty::before { content: attr(data-placeholder); opacity: 0.5; }
`}</style>
    </div>
  );
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
