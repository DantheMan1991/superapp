"use client";
import { useEffect } from "react";
import { readPreviewMessage, SECTION_ATTR } from "@/lib/sites/preview";

/**
 * The draft preview inside the editor: a click on a section tells the
 * editor which one, and the editor's selection is outlined here. Nothing
 * renders; the public page never carries this, and the draft opened on its
 * own (not in the editor's frame) does nothing either, so it stays a page
 * like any other. Messages cross to the parent on the same origin only, and
 * only ones `readPreviewMessage` recognises are believed.
 */
export function DraftSelect() {
  useEffect(() => {
    if (window.parent === window) return;
    const origin = window.location.origin;
    const root = document.querySelector(".site-root");
    root?.classList.add("site-draft");

    const mark = (el: Element | null) => {
      document.querySelectorAll(".site-selected").forEach((s) => s.classList.remove("site-selected"));
      el?.classList.add("site-selected");
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const section = target?.closest(`[${SECTION_ATTR}]`) ?? null;
      if (!section) return;
      // A link or a button inside a section selects the section here rather
      // than going anywhere; the menu, outside any section, still moves
      // between pages.
      if (target?.closest("a, button")) event.preventDefault();
      const index = Number(section.getAttribute(SECTION_ATTR));
      mark(section);
      window.parent.postMessage({ type: "yosher:site-section", index }, origin);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      const message = readPreviewMessage(event.data);
      if (!message || message.type !== "yosher:site-select") return;
      const el = document.querySelector(`[${SECTION_ATTR}="${message.index}"]`);
      mark(el);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    document.addEventListener("click", onClick);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "yosher:site-ready" }, origin);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("message", onMessage);
      root?.classList.remove("site-draft");
    };
  }, []);
  return null;
}
