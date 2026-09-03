"use client";

import { createContext, createElement, useContext } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getControlIcon } from "./guide-icons";

/**
 * True inside the help panel, where a control drawn in a guide can point at
 * the real one on the screen beside it. False on the Guides page, where there
 * is no screen to point at and the control is a picture.
 */
export const GuidePointerContext = createContext(false);

const BUTTON_VARIANT = {
  primary: "default",
  outline: "outline",
  ghost: "ghost",
  destructive: "destructive",
  secondary: "secondary",
  link: "link",
} as const;

const BADGE_VARIANT = {
  primary: "default",
  secondary: "secondary",
  outline: "outline",
  destructive: "destructive",
  success: "default",
  warning: "default",
} as const;

/** The app tints its success and warning badges by class, never by variant. */
const BADGE_TINT: Record<string, string> = {
  success: "bg-success/12 text-success-foreground",
  warning: "bg-warning/12 text-warning-foreground",
};

interface GuideControlProps {
  kind: string;
  label: string;
  variant?: string;
  icon?: string;
}

/**
 * A control as the screen draws it — the same Button and Badge the app uses,
 * one size down so it sits in a line of prose — from a `{button:…}` marker in
 * a guide (`remarkGuideControls`). A screenshot of a button goes stale with
 * the next design sweep; this cannot, because it is the component.
 *
 * In the help panel, the control is live: click it and the matching control on
 * the page scrolls into view and is ringed for a moment. The match is by the
 * text the reader sees, so no screen needs marking up, and a control that is
 * not on the screen right now (inside a dialog, or owner-only) says so.
 */
export function GuideControl({ kind, label, variant, icon }: GuideControlProps) {
  const pointer = useContext(GuidePointerContext);

  if (kind === "button") {
    // `createElement` rather than `<Icon />`: a component picked during render
    // trips `react-hooks/static-components`, as it did on the guide page.
    const glyph = getControlIcon(icon);
    const look = BUTTON_VARIANT[(variant ?? "outline") as keyof typeof BUTTON_VARIANT] ?? "outline";
    const content = (
      <>
        {glyph && createElement(glyph)}
        {label}
      </>
    );
    if (pointer) {
      return (
        <Button
          type="button"
          size="xs"
          variant={look}
          className="mx-0.5 align-middle"
          title="Show me where this is"
          onClick={() => pointTo(label, "control")}
        >
          {content}
        </Button>
      );
    }
    return (
      <Button asChild size="xs" variant={look} className="mx-0.5 align-middle">
        <span>{content}</span>
      </Button>
    );
  }

  if (kind === "badge") {
    const look = BADGE_VARIANT[(variant ?? "outline") as keyof typeof BADGE_VARIANT] ?? "outline";
    const className = cn("mx-0.5 align-middle", BADGE_TINT[variant ?? ""]);
    if (pointer) {
      return (
        <Badge asChild variant={look} className={cn(className, "cursor-pointer")}>
          <button
            type="button"
            title="Show me where this is"
            onClick={() => pointTo(label, "badge")}
          >
            {label}
          </button>
        </Badge>
      );
    }
    return (
      <Badge variant={look} className={className}>
        {label}
      </Badge>
    );
  }

  if (kind === "icon") {
    const glyph = getControlIcon(label);
    if (!glyph) return <span>{label}</span>;
    return createElement(glyph, {
      className: "inline size-4 align-text-bottom",
      "aria-label": label,
    });
  }

  if (kind === "kbd") {
    return (
      <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[0.8em] font-medium text-foreground">
        {label}
      </kbd>
    );
  }

  return <span>{label}</span>;
}

const CONTROL_SELECTOR = 'button, a, [role="tab"], [role="menuitem"], summary';
const BADGE_SELECTOR = '[data-slot="badge"]';

function plain(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function pointTo(label: string, kind: "control" | "badge") {
  // The guide's own drawn controls are buttons with the same text, so the
  // prose is excluded; the panel's footer is not, so "Open full guide" is
  // found where it is.
  const prose = [...document.querySelectorAll(".guide-prose")];
  const wanted = plain(label);
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(kind === "badge" ? BADGE_SELECTOR : CONTROL_SELECTOR),
  ].filter((element) => !prose.some((block) => block.contains(element)));
  const reads = (element: HTMLElement) => [
    plain(element.textContent),
    plain(element.getAttribute("aria-label")),
    plain(element.getAttribute("title")),
  ];
  // The Mail row carries its unread count in its text, so an exact match is
  // tried first and a prefix second, never a substring.
  const hit =
    candidates.find((element) => reads(element).includes(wanted)) ??
    candidates.find((element) => reads(element).some((read) => read.startsWith(wanted + " ")));
  if (!hit) {
    toast.message(`“${label}” is not on the screen right now.`, {
      description: "It may be inside a dialog, or shown only to owners.",
    });
    return;
  }
  hit.scrollIntoView({ block: "center", behavior: "smooth" });
  hit.classList.remove("guide-target");
  void hit.offsetWidth; // restart the animation when the same control is pointed at twice
  hit.classList.add("guide-target");
  window.setTimeout(() => hit.classList.remove("guide-target"), 2600);
}
