import { describe, expect, it } from "vitest";
import {
  isPreviewDevice,
  PREVIEW_DEVICES,
  previewWidth,
  readPreviewMessage,
  SECTION_ATTR,
} from "../src/lib/sites/preview";

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

  it("believes only the three messages, with an index where one is due", () => {
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
});
