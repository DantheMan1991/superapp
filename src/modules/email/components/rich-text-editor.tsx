"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Indent,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Outdent,
  Quote,
  Redo2,
  RemoveFormatting,
  Smile,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FONTS, PALETTE, SIZES } from "../compose/formatting";
import { EMOJI_GROUPS, searchEmoji, type EmojiEntry } from "../compose/emoji";
import { normalizeLinkInput } from "../compose/link-url";

/**
 * The composer's editing surface.
 *
 * A `contenteditable` driven by `document.execCommand`. That API is formally
 * deprecated and has no replacement — every browser still implements it, and the
 * alternatives are a 300 KB editor framework or reimplementing selection and
 * undo by hand, neither of which is proportionate. The deprecation is recorded
 * here rather than discovered later.
 *
 * WHAT MAKES THAT CHOICE SAFE, given execCommand emits different markup in every
 * browser — `<b>` here, `<span style="font-weight:bold">` there, `<font
 * color=…>` for a colour: **nothing this component produces is trusted.** The
 * server runs `sanitizeOutboundHtml` over the submitted body and normalizes it.
 * Browser variance is absorbed rather than fought.
 *
 * `styleWithCSS` is left OFF, which is why the sanitizer has a `<font>`
 * transform. Turning it on would emit spans full of CSS for bold and italic too,
 * and then every emphasis tag would depend on the style allowlist instead of
 * being a plain `<b>`.
 *
 * THE MENUS ARE BUILT FROM `compose/formatting.ts`, THE SAME FILE THE SANITIZER
 * VALIDATES AGAINST. That is what makes "the toolbar can only emit what the
 * sanitizer accepts" true by construction rather than by review. Adding a
 * swatch or a font is one edit to one table.
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

/**
 * The toolbar, as DATA at module scope rather than an array built during render.
 *
 * Not a style preference: building it inside the component means each entry
 * closes over `run`, which reads a ref, and React's `react-hooks/refs` rule
 * correctly refuses an array assembled during render that reaches a ref through
 * its members. Describing what each button DOES and resolving it in the click
 * handler keeps ref access where it belongs — in an event handler.
 */
type Panel = "font" | "size" | "colour" | "align" | "emoji" | "link";

type Action =
  | { kind: "exec"; command: string; arg?: string }
  | { kind: "panel"; panel: Panel };

interface ToolbarButton {
  key: string;
  label: string;
  Icon: typeof Bold;
  shortcut?: string;
  action: Action;
}

/** Divider positions, so the bar reads as groups rather than a run of icons. */
const TOOLBAR: readonly (ToolbarButton | "divider")[] = [
  { key: "undo", label: "Undo", Icon: Undo2, shortcut: "Ctrl+Z", action: { kind: "exec", command: "undo" } },
  { key: "redo", label: "Redo", Icon: Redo2, shortcut: "Ctrl+Y", action: { kind: "exec", command: "redo" } },
  "divider",
  { key: "bold", label: "Bold", Icon: Bold, shortcut: "Ctrl+B", action: { kind: "exec", command: "bold" } },
  { key: "italic", label: "Italic", Icon: Italic, shortcut: "Ctrl+I", action: { kind: "exec", command: "italic" } },
  { key: "underline", label: "Underline", Icon: Underline, shortcut: "Ctrl+U", action: { kind: "exec", command: "underline" } },
  { key: "strike", label: "Strikethrough", Icon: Strikethrough, action: { kind: "exec", command: "strikeThrough" } },
  { key: "colour", label: "Text and highlight colour", Icon: Baseline, action: { kind: "panel", panel: "colour" } },
  "divider",
  { key: "align", label: "Align", Icon: AlignLeft, action: { kind: "panel", panel: "align" } },
  { key: "ul", label: "Bulleted list", Icon: List, shortcut: "Ctrl+Shift+8", action: { kind: "exec", command: "insertUnorderedList" } },
  { key: "ol", label: "Numbered list", Icon: ListOrdered, shortcut: "Ctrl+Shift+7", action: { kind: "exec", command: "insertOrderedList" } },
  { key: "outdent", label: "Decrease indent", Icon: Outdent, action: { kind: "exec", command: "outdent" } },
  { key: "indent", label: "Increase indent", Icon: Indent, action: { kind: "exec", command: "indent" } },
  { key: "quote", label: "Quote", Icon: Quote, action: { kind: "exec", command: "formatBlock", arg: "blockquote" } },
  "divider",
  { key: "link", label: "Insert link", Icon: Link2, shortcut: "Ctrl+K", action: { kind: "panel", panel: "link" } },
  { key: "unlink", label: "Remove link", Icon: Link2Off, action: { kind: "exec", command: "unlink" } },
  { key: "emoji", label: "Insert emoji", Icon: Smile, action: { kind: "panel", panel: "emoji" } },
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
  const [panel, setPanel] = useState<Panel | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkHref, setLinkHref] = useState("");
  const [emojiQuery, setEmojiQuery] = useState("");
  /** The selection a panel was opened over, restored before applying. */
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.innerHTML = initialHtml;
    // `styleWithCSS` off asks the browser for `<b>` rather than
    // `<span style="font-weight:bold">`, and `<font>` for colours — which the
    // sanitizer translates back into one of our own declarations.
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

  /**
   * Mark the blockquote the Quote button just made as a QUOTE.
   *
   * `execCommand("formatBlock", "blockquote")` and `execCommand("indent")`
   * produce the SAME TAG, and the sanitizer has to tell them apart to decide
   * whether the recipient sees a quotation bar or an indent. `formatBlock`
   * emits a bare `<blockquote>`, so without this the Quote button would be
   * indistinguishable from Indent by the time the markup reaches the server.
   *
   * Walks up from the caret to the nearest blockquote inside the editor and
   * stamps `type="cite"` — the attribute `quoteHtml` already uses. Failing to
   * find one is harmless: the sanitizer defaults an unmarked blockquote to a
   * quote, which is what the person pressing Quote wanted anyway.
   */
  const markQuote = useCallback(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    let current: Node | null = node;
    while (current && current !== host.current) {
      if (current instanceof HTMLElement && current.tagName === "BLOCKQUOTE") {
        current.setAttribute("type", "cite");
        return;
      }
      current = current.parentNode;
    }
  }, []);

  /** Put the caret back where it was before a panel's input took focus. */
  const restoreSelection = useCallback(() => {
    host.current?.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    return selection;
  }, []);

  const openPanel = useCallback((next: Panel) => {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (next === "link") {
      // Prefill the display text from what is selected, the way every mail
      // client does — selecting a word and pressing Ctrl-K should not make you
      // retype it.
      setLinkText(selection?.toString() ?? "");
      setLinkHref("");
    }
    if (next === "emoji") setEmojiQuery("");
    setPanel((current) => (current === next ? null : next));
  }, []);

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // See the file header: this is the control, not a convenience.
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      // insertText keeps the browser's own undo stack, which manual DOM surgery
      // would break — and an editor where Ctrl-Z does not undo a paste is one
      // people stop trusting with anything long.
      run("insertText", text);
    },
    [run],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      // Bold, italic and underline are the browser's own and are left alone.
      // These three are not bound by default.
      if (key === "k") {
        event.preventDefault();
        openPanel("link");
        return;
      }
      if (event.shiftKey && key === "7") {
        event.preventDefault();
        run("insertOrderedList");
        return;
      }
      if (event.shiftKey && key === "8") {
        event.preventDefault();
        run("insertUnorderedList");
      }
    },
    [openPanel, run],
  );

  const applyLink = useCallback(() => {
    const href = normalizeLinkInput(linkHref);
    setPanel(null);
    if (!href) return;
    const selection = restoreSelection();
    const label = linkText.trim();
    const collapsed = selection?.isCollapsed ?? true;

    // A collapsed selection means there is nothing for `createLink` to wrap, so
    // the anchor is built and inserted whole. Doing nothing instead is what
    // reads as a button that missed.
    if (collapsed || label !== (selection?.toString() ?? "")) {
      run(
        "insertHTML",
        `<a href="${escapeAttr(href)}">${escapeText(label || href)}</a>`,
      );
      return;
    }
    run("createLink", href);
  }, [linkHref, linkText, restoreSelection, run]);

  const applyColour = useCallback(
    (colour: string, kind: "text" | "highlight") => {
      restoreSelection();
      if (kind === "text") {
        run("foreColor", colour);
        return;
      }
      // `hiliteColor` is the standard name and what Chrome and Firefox
      // implement; `backColor` is the older spelling some engines want. Trying
      // both costs one no-op.
      run("hiliteColor", colour);
      run("backColor", colour);
    },
    [restoreSelection, run],
  );

  const insertEmoji = useCallback(
    (character: string) => {
      restoreSelection();
      // insertText, not insertHTML: an emoji is a character. It needs no markup,
      // no sanitizer rule, and it lands in the plain-text alternative for free.
      run("insertText", character);
      setPanel(null);
    },
    [restoreSelection, run],
  );

  const emojiResults = emojiQuery.trim() ? searchEmoji(emojiQuery) : null;

  return (
    <div className="rounded-md border">
      <div
        className="relative flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
        role="toolbar"
        aria-label="Formatting"
      >
        {/* Font and size are selects rather than icon buttons: their current
            value is the useful thing to show, and an icon cannot say "Georgia". */}
        <PanelButton
          label="Font"
          open={panel === "font"}
          disabled={disabled}
          onOpen={() => openPanel("font")}
          className="min-w-[6.5rem] justify-between px-2"
        >
          <span className="truncate text-xs">Font</span>
        </PanelButton>
        <PanelButton
          label="Size"
          open={panel === "size"}
          disabled={disabled}
          onOpen={() => openPanel("size")}
          className="px-2"
        >
          <span className="text-xs">Size</span>
        </PanelButton>

        {TOOLBAR.map((item, index) =>
          item === "divider" ? (
            <span
              key={`divider-${index}`}
              aria-hidden
              className="mx-1 h-4 w-px shrink-0 bg-border"
            />
          ) : (
            <button
              key={item.key}
              type="button"
              title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              aria-label={item.label}
              aria-expanded={
                item.action.kind === "panel" ? panel === item.action.panel : undefined
              }
              disabled={disabled}
              // The whole reason the toolbar works: a button takes focus on
              // mousedown, which collapses the selection in the editable before
              // the click ever fires. Preventing the default keeps the selection
              // the command is about to act on.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (item.action.kind === "panel") {
                  openPanel(item.action.panel);
                  return;
                }
                run(item.action.command, item.action.arg);
                // See markQuote: Quote and Indent emit the same tag, and this
                // is the only moment we still know which button was pressed.
                if (item.key === "quote") markQuote();
              }}
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
                "hover:bg-secondary hover:text-foreground disabled:opacity-40",
                item.action.kind === "panel" &&
                  panel === item.action.panel &&
                  "bg-secondary text-foreground",
              )}
            >
              <item.Icon className="size-3.5" />
            </button>
          ),
        )}
      </div>

      {panel === "font" && (
        <Popover onClose={() => setPanel(null)}>
          {FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                restoreSelection();
                run("fontName", font.css);
                setPanel(null);
              }}
              style={{ fontFamily: font.css }}
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-secondary"
            >
              {font.label}
            </button>
          ))}
        </Popover>
      )}

      {panel === "size" && (
        <Popover onClose={() => setPanel(null)}>
          {SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                restoreSelection();
                run("fontSize", String(size.legacy));
                setPanel(null);
              }}
              style={{ fontSize: size.css }}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-secondary"
            >
              {size.label}
            </button>
          ))}
        </Popover>
      )}

      {panel === "align" && (
        <Popover onClose={() => setPanel(null)}>
          <div className="flex gap-1">
            {[
              { key: "left", label: "Align left", Icon: AlignLeft, command: "justifyLeft" },
              { key: "center", label: "Align centre", Icon: AlignCenter, command: "justifyCenter" },
              { key: "right", label: "Align right", Icon: AlignRight, command: "justifyRight" },
            ].map((a) => (
              <button
                key={a.key}
                type="button"
                aria-label={a.label}
                title={a.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  restoreSelection();
                  run(a.command);
                  setPanel(null);
                }}
                className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-secondary"
              >
                <a.Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </Popover>
      )}

      {panel === "colour" && (
        <Popover onClose={() => setPanel(null)}>
          <div className="flex gap-4">
            <Swatches
              title="Text"
              onPick={(c) => {
                applyColour(c, "text");
                setPanel(null);
              }}
            />
            <Swatches
              title="Highlight"
              onPick={(c) => {
                applyColour(c, "highlight");
                setPanel(null);
              }}
            />
          </div>
        </Popover>
      )}

      {panel === "emoji" && (
        <Popover onClose={() => setPanel(null)}>
          <input
            autoFocus
            value={emojiQuery}
            onChange={(e) => setEmojiQuery(e.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
            className="mb-2 h-7 w-full rounded-sm border bg-background px-2 text-xs outline-none"
          />
          <div className="max-h-56 overflow-y-auto">
            {emojiResults ? (
              emojiResults.length > 0 ? (
                <EmojiGrid entries={emojiResults} onPick={insertEmoji} />
              ) : (
                <p className="px-1 py-3 text-xs text-muted-foreground">
                  Nothing matches “{emojiQuery}”.
                </p>
              )
            ) : (
              EMOJI_GROUPS.map((group) => (
                <div key={group.id} className="mb-2">
                  <p className="px-1 pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                    {group.label}
                  </p>
                  <EmojiGrid entries={group.emoji} onPick={insertEmoji} />
                </div>
              ))
            )}
          </div>
        </Popover>
      )}

      {panel === "link" && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/40 px-2 py-1.5">
          <input
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => onLinkKey(e, applyLink, () => setPanel(null))}
            placeholder="Text to show"
            aria-label="Link text"
            className="h-7 min-w-[8rem] flex-1 rounded-sm border bg-background px-2 text-xs outline-none"
          />
          <input
            autoFocus
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={(e) => onLinkKey(e, applyLink, () => setPanel(null))}
            placeholder="example.com or name@example.com"
            aria-label="Link address"
            className="h-7 min-w-[10rem] flex-1 rounded-sm border bg-background px-2 text-xs outline-none"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={applyLink}
            className="rounded-sm px-2 py-1 text-xs font-medium hover:bg-secondary"
          >
            Add
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPanel(null)}
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
        // The browser's own spell checker. One attribute, and it is what "Spell
        // check" is in every other composer.
        spellCheck
        onPaste={onPaste}
        onKeyDown={onKeyDown}
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
`}</style>
    </div>
  );
}

function onLinkKey(
  event: React.KeyboardEvent<HTMLInputElement>,
  apply: () => void,
  cancel: () => void,
): void {
  if (event.key === "Enter") {
    event.preventDefault();
    apply();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
}

/**
 * A dropdown anchored under the toolbar.
 *
 * Deliberately not a portal or a floating-UI layer: the composer is already
 * inside the reading pane and a portalled popover would escape it and need its
 * own scroll handling. Absolute inside a relative parent is enough for a menu
 * that is never taller than the composer.
 */
function Popover({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="relative">
      <div
        className="absolute top-0 left-1.5 z-20 max-h-72 overflow-y-auto rounded-md border bg-background p-1.5 shadow-md"
        // Escape closes it from anywhere inside, including the search input.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function PanelButton({
  label,
  open,
  disabled,
  onOpen,
  className,
  children,
}: {
  label: string;
  open: boolean;
  disabled?: boolean;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-sm text-muted-foreground",
        "hover:bg-secondary hover:text-foreground disabled:opacity-40",
        open && "bg-secondary text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** One palette. Both pickers show the same colours; only the command differs. */
function Swatches({
  title,
  onPick,
}: {
  title: string;
  onPick: (colour: string) => void;
}) {
  return (
    <div>
      <p className="pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <div className="grid grid-cols-8 gap-1">
        {PALETTE.map((colour) => (
          <button
            key={`${title}-${colour}`}
            type="button"
            aria-label={`${title} ${colour}`}
            title={colour}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(colour)}
            style={{ backgroundColor: colour }}
            className="size-4 rounded-[2px] border border-black/15 hover:scale-110"
          />
        ))}
      </div>
    </div>
  );
}

function EmojiGrid({
  entries,
  onPick,
}: {
  entries: readonly EmojiEntry[];
  onPick: (character: string) => void;
}) {
  return (
    <div className="grid grid-cols-9 gap-0.5">
      {entries.map(([character, terms]) => (
        <button
          key={character}
          type="button"
          aria-label={terms.split(" ")[0]}
          title={terms.split(" ")[0]}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(character)}
          className="rounded-sm p-0.5 text-lg leading-none hover:bg-secondary"
        >
          {character}
        </button>
      ))}
    </div>
  );
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
