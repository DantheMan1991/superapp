"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { blockKey } from "@/lib/site-blocks/core";
import type { BlockView } from "@/lib/site-blocks/types";
import type { LiveEvent } from "@/lib/sites/events-core";
import type { PublicSite } from "@/lib/sites/read";
import { readPreviewMessage, SECTION_ATTR, wantsLiveData, type DraftImages, type DraftPage } from "@/lib/sites/preview";
import type { SitePageView } from "@/lib/sites/schema";
import { SitePage } from "./site-page";

/**
 * The draft as the editor is changing it (slice 13). The route renders the
 * saved draft first, as it always did; then the editor, which frames this
 * page, sends what the owner has typed and this redraws with it, so every
 * edit shows at once and nothing is saved by looking. The same renderer
 * draws both, so there is still one rendering of a section in the product
 * (ADR 0019); this only changes where its words come from.
 *
 * Live data — a pack's block, the events calendar — is read from the
 * member route when the draft asks for something the page did not load
 * (a block just added, say), and kept once read. Messages are believed
 * only from the parent window on this origin, and only the shapes
 * `readPreviewMessage` knows.
 */
export function LiveDraft({ site, page, banner }: { site: PublicSite; page: SitePageView; banner?: ReactNode }) {
  const [draft, setDraft] = useState<DraftPage | null>(null);
  const [images, setImages] = useState<DraftImages>({});
  const [blocks, setBlocks] = useState<Record<string, BlockView>>({});
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [selected, setSelected] = useState<number>(-1);
  const fetching = useRef<AbortController | null>(null);

  useEffect(() => {
    if (window.parent === window) return;
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window.parent) return;
      const message = readPreviewMessage(event.data);
      if (!message) return;
      if (message.type === "yosher:site-draft") {
        setDraft(message.page);
        setImages(message.images);
      } else if (message.type === "yosher:site-select") {
        setSelected(message.index);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // What the draft shows that the page did not load: ask once per change, and drop a stale answer.
  const sections = draft?.content.sections ?? null;
  useEffect(() => {
    if (!sections) return;
    const have = { blocks: { ...site.blocks, ...blocks }, eventsLoaded: events !== null || site.events.length > 0 };
    if (!wantsLiveData(sections, have, blockKey)) return;
    fetching.current?.abort();
    const controller = new AbortController();
    fetching.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/marketing/sites/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sections }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { blocks?: Record<string, BlockView>; events?: LiveEvent[] };
        if (controller.signal.aborted) return;
        if (data.blocks) setBlocks((prev) => ({ ...prev, ...data.blocks }));
        if (data.events) setEvents(data.events);
      } catch {
        // Aborted, or offline: the draft draws without the live rows until the next change.
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `blocks`/`events` are what this fills; depending on them would ask again after every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  // A redraw can drop the outline the click-to-select island painted; paint it again.
  useEffect(() => {
    if (selected < 0 || !draft) return;
    document.querySelectorAll(".site-selected").forEach((s) => s.classList.remove("site-selected"));
    document.querySelector(`[${SECTION_ATTR}="${selected}"]`)?.classList.add("site-selected");
  }, [draft, selected]);

  const live: PublicSite = draft
    ? {
        ...site,
        images: { ...site.images, ...images },
        blocks: { ...site.blocks, ...blocks },
        events: events ?? site.events,
        pages: site.pages.map((p) => (p.path === page.path ? { ...p, title: draft.title, path: draft.path, content: draft.content } : p)),
      }
    : site;
  const livePage: SitePageView = draft ? { ...page, title: draft.title, path: draft.path, content: draft.content } : page;
  return <SitePage site={live} page={livePage} mode="draft" banner={banner} />;
}
