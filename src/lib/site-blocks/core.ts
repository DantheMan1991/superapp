import type { Section } from "@/lib/sites/schema";
import type { BlockCatalogEntry, BlockConfig, BlockField } from "./types";

/**
 * The pure half of the declared slot (slice 9b): what the editor, the
 * renderer and the tests share without a database or a pack in sight.
 */
export type BlockSection = Extract<Section, { type: "block" }>;

/** The pack a kind belongs to: the part before the dot. */
export function packOfKind(kind: string): string {
  return kind.split(".")[0] ?? "";
}

/**
 * The name a block's view is filed under on `PublicSite.blocks`: the kind
 * and its config, keys sorted, so two sections set up the same way share
 * one load and a section keeps its view when a key is added in a different
 * order.
 */
export function blockKey(section: Pick<BlockSection, "kind" | "config">): string {
  const keys = Object.keys(section.config).sort();
  return `${section.kind}|${JSON.stringify(keys.map((k) => [k, section.config[k]]))}`;
}

/** The config a new section starts with: every field at its default. */
export function defaultConfig(fields: BlockField[]): BlockConfig {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

/** A fresh section for a catalogue entry, headed with the block's own name. */
export function newBlockSection(entry: BlockCatalogEntry): BlockSection {
  return { type: "block", kind: entry.kind, heading: entry.label, note: "", emptyText: "", config: defaultConfig(entry.fields) };
}

/** The entries whose pack is switched on: what the editor offers and what the site draws. */
export function filterCatalog<T extends { pack: string }>(entries: T[], enabledPacks: Iterable<string>): T[] {
  const on = new Set(enabledPacks);
  return entries.filter((e) => on.has(e.pack));
}

/** What the editor calls a block section: the catalogue's label, else the kind's own name. */
export function blockLabel(kind: string, catalog: ReadonlyArray<Pick<BlockCatalogEntry, "kind" | "label">>): string {
  const entry = catalog.find((e) => e.kind === kind);
  if (entry) return entry.label;
  const name = kind.split(".")[1] ?? kind;
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
}

/** The block sections among a page's sections, in order. */
export function blockSectionsOf(sections: Section[]): BlockSection[] {
  return sections.filter((s): s is BlockSection => s.type === "block");
}
