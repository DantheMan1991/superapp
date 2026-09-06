import { describe, expect, it } from "vitest";
import {
  draftImages,
  isPreviewDevice,
  PREVIEW_DEVICES,
  previewWidth,
  readPreviewMessage,
  SECTION_ATTR,
  wantsLiveData,
} from "../src/lib/sites/preview";
import type { PageContent } from "../src/lib/sites/schema";

describe("the editor's preview", () => {
  it("is the whole pane, or a tablet's or a phone's width", () => {
    expect(PREVIEW_DEVICES.map((d) => d.key)).toEqual(["desktop", "tablet", "phone"]);
    expect(previewWidth("desktop")).toBe("100%");
    expect(previewWidth("tablet")).toBe("820px");
    expect(previewWidth("phone")).toBe("390px");
    expect(isPreviewDevice("phone")).toBe(true);
    expect(isPreviewDevice("watch")).toBe(false);
    expect(SECTION_ATTR).toBe("data-section-index");
  });

  it("believes only the four messages, with an index where one is due", () => {
    expect(readPreviewMessage({ type: "yosher:site-section", index: 2 })).toEqual({ type: "yosher:site-section", index: 2 });
    expect(readPreviewMessage({ type: "yosher:site-select", index: -1 })).toEqual({ type: "yosher:site-select", index: -1 });
    expect(readPreviewMessage({ type: "yosher:site-ready", index: "ignored" })).toEqual({ type: "yosher:site-ready" });
    expect(readPreviewMessage({ type: "yosher:site-section", index: -1 })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-section", index: 1.5 })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-section", index: "2" })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-select" })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-explode", index: 0 })).toBeNull();
    expect(readPreviewMessage("yosher:site-ready")).toBeNull();
    expect(readPreviewMessage(null)).toBeNull();
    // React DevTools and extensions post their own messages; none of them is ours.
    expect(readPreviewMessage({ source: "react-devtools-content-script", hello: true })).toBeNull();
  });

  it("believes the editor's draft when it is page-shaped, and takes only real photo sizes with it", () => {
    const page = { title: "Home", path: "/", content: { description: "", sections: [{ type: "hero", headline: "" }, { type: "block", kind: "retail.prices", config: {} }] } };
    const message = readPreviewMessage({ type: "yosher:site-draft", page, images: { a: { width: 800, height: 600 }, b: { width: "800", height: 600 }, c: null } });
    expect(message).toEqual({ type: "yosher:site-draft", page: { ...page, content: { ...page.content, seoTitle: "" } }, images: { a: { width: 800, height: 600 } } });
    // The shape is checked, the limits are not: a blank headline mid-edit still draws.
    expect(readPreviewMessage({ type: "yosher:site-draft", page: { ...page, content: { description: "", sections: [{ type: "wizard" }] } } })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-draft", page: { ...page, content: { description: 1, sections: [] } } })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-draft", page: { ...page, content: { description: "", sections: new Array(13).fill({ type: "text" }) } } })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-draft", page: { title: "Home", content: page.content } })).toBeNull();
    expect(readPreviewMessage({ type: "yosher:site-draft" })).toBeNull();
    expect(draftImages([{ id: "a", width: 10, height: 20, extra: true } as never])).toEqual({ a: { width: 10, height: 20 } });
  });

  it("asks for live data only for a block with no view or events with none loaded", () => {
    const sections = [
      { type: "text", heading: "", body: [] },
      { type: "block", kind: "retail.prices", heading: "", note: "", emptyText: "", config: { channel: "x" } },
    ] as PageContent["sections"];
    const keyOf = (s: { kind: string }) => s.kind;
    expect(wantsLiveData(sections, { blocks: {}, eventsLoaded: false }, keyOf)).toBe(true);
    expect(wantsLiveData(sections, { blocks: { "retail.prices": {} }, eventsLoaded: false }, keyOf)).toBe(false);
    const withEvents = [...sections, { type: "events", heading: "", note: "", count: 5, horizonDays: 90, emptyText: "" }] as PageContent["sections"];
    expect(wantsLiveData(withEvents, { blocks: { "retail.prices": {} }, eventsLoaded: false }, keyOf)).toBe(true);
    expect(wantsLiveData(withEvents, { blocks: { "retail.prices": {} }, eventsLoaded: true }, keyOf)).toBe(false);
    expect(wantsLiveData([], { blocks: {}, eventsLoaded: false }, keyOf)).toBe(false);
  });
});
