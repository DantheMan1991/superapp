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
import { PAGE_SECTIONS_MAX, type PageContent } from "./schema";
import { SECTION_DEFAULTS } from "./style";

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

/** What the editor sends the preview to draw: the page as it stands, unsaved, and the photos it may use. */
export interface DraftPage {
  title: string;
  path: string;
  content: PageContent;
}
export type DraftImages = Record<string, { width: number; height: number }>;

export type PreviewMessage =
  /** From the preview: a section was clicked. */
  | { type: "yosher:site-section"; index: number }
  /** From the editor: this section is selected; -1 is none. */
  | { type: "yosher:site-select"; index: number }
  /** From the preview: it has loaded and would like the selection and the draft. */
  | { type: "yosher:site-ready" }
  /** From the editor: draw this, as it stands (slice 13, the live preview). */
  | { type: "yosher:site-draft"; page: DraftPage; images: DraftImages };

function isIndex(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

/**
 * The editor's page as the preview will believe it: the SHAPE is checked
 * (strings where strings go, sections as objects of a kind the renderer
 * draws), the content model's limits are not — a headline being typed is
 * blank for a moment, and the preview should show that, not stop. The
 * renderer draws what it is given and turns anything unsafe (a link of the
 * wrong shape) into nothing, as it does for a stored row.
 */
function readDraftPage(value: unknown): DraftPage | null {
  if (!value || typeof value !== "object") return null;
  const { title, path, content } = value as { title?: unknown; path?: unknown; content?: unknown };
  if (typeof title !== "string" || typeof path !== "string") return null;
  if (!content || typeof content !== "object") return null;
  const { description, sections } = content as { description?: unknown; sections?: unknown };
  if (typeof description !== "string" || !Array.isArray(sections)) return null;
  if (sections.length > PAGE_SECTIONS_MAX) return null;
  for (const section of sections) {
    if (!section || typeof section !== "object") return null;
    const type = (section as { type?: unknown }).type;
    if (typeof type !== "string" || !(type in SECTION_DEFAULTS)) return null;
  }
  return { title, path, content: { description, sections: sections as PageContent["sections"] } };
}

function readDraftImages(value: unknown): DraftImages {
  const out: DraftImages = {};
  if (!value || typeof value !== "object") return out;
  for (const [id, size] of Object.entries(value as Record<string, unknown>)) {
    if (!size || typeof size !== "object") continue;
    const { width, height } = size as { width?: unknown; height?: unknown };
    if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) out[id] = { width, height };
  }
  return out;
}

/** A message from the other side, or null for anything that is not one of the four. */
export function readPreviewMessage(data: unknown): PreviewMessage | null {
  if (!data || typeof data !== "object") return null;
  const { type, index, page, images } = data as { type?: unknown; index?: unknown; page?: unknown; images?: unknown };
  switch (type) {
    case "yosher:site-section":
      return isIndex(index, 0) ? { type, index } : null;
    case "yosher:site-select":
      return isIndex(index, -1) ? { type, index } : null;
    case "yosher:site-ready":
      return { type };
    case "yosher:site-draft": {
      const draft = readDraftPage(page);
      return draft ? { type, page: draft, images: readDraftImages(images) } : null;
    }
    default:
      return null;
  }
}

/** The photos the editor holds, as the renderer needs them. */
export function draftImages(library: ReadonlyArray<{ id: string; width: number; height: number }>): DraftImages {
  return Object.fromEntries(library.map((p) => [p.id, { width: p.width, height: p.height }]));
}

/** Whether these sections want live data the preview does not hold yet: a block with no view, or events with none loaded. */
export function wantsLiveData(
  sections: PageContent["sections"],
  have: { blocks: Record<string, unknown>; eventsLoaded: boolean },
  keyOf: (section: Extract<PageContent["sections"][number], { type: "block" }>) => string,
): boolean {
  for (const section of sections) {
    if (section.type === "block" && !(keyOf(section) in have.blocks)) return true;
    if (section.type === "events" && !have.eventsLoaded) return true;
  }
  return false;
}
