/**
 * The editor's preview — pure.
 *
 * The preview is the draft route in an iframe on the same origin as the
 * editor (ADR 0019: there is one rendering of a section in the product).
 * Two small things pass between them as `postMessage`s: the preview says
 * which section was clicked and when it has loaded; the editor says which
 * section is selected. Every message is checked here before it is believed,
 * and the editor checks the origin and the source window first.
 */
export const PREVIEW_DEVICES = [
  { key: "desktop", label: "Desktop", width: null },
  { key: "tablet", label: "Tablet", width: 820 },
  { key: "phone", label: "Phone", width: 390 },
] as const;
export type PreviewDevice = (typeof PREVIEW_DEVICES)[number]["key"];

export function isPreviewDevice(value: string): value is PreviewDevice {
  return PREVIEW_DEVICES.some((d) => d.key === value);
}

/** The frame's width as CSS: the whole pane, or a device's. */
export function previewWidth(device: PreviewDevice): string {
  const width = PREVIEW_DEVICES.find((d) => d.key === device)?.width ?? null;
  return width === null ? "100%" : `${width}px`;
}

/** Remembered per browser, so the owner who checks phones keeps checking phones. */
export const PREVIEW_DEVICE_KEY = "yosher.site-preview.device";

/** The attribute the renderer puts on every section in the draft, holding its index on the page. */
export const SECTION_ATTR = "data-section-index";

export type PreviewMessage =
  /** From the preview: a section was clicked. */
  | { type: "yosher:site-section"; index: number }
  /** From the editor: this section is selected; -1 is none. */
  | { type: "yosher:site-select"; index: number }
  /** From the preview: it has loaded and would like the selection. */
  | { type: "yosher:site-ready" };

function isIndex(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

/** A message from the other side, or null for anything that is not one of the three. */
export function readPreviewMessage(data: unknown): PreviewMessage | null {
  if (!data || typeof data !== "object") return null;
  const { type, index } = data as { type?: unknown; index?: unknown };
  switch (type) {
    case "yosher:site-section":
      return isIndex(index, 0) ? { type, index } : null;
    case "yosher:site-select":
      return isIndex(index, -1) ? { type, index } : null;
    case "yosher:site-ready":
      return { type };
    default:
      return null;
  }
}
