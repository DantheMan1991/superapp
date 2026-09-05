import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Section } from "@/lib/sites/schema";
import { blockKey, blockSectionsOf, filterCatalog, packOfKind } from "./core";
import { SITE_BLOCK_PROVIDERS } from "./registry";
import type { BlockCatalogEntry, BlockView, SiteBlockProvider } from "./types";

/**
 * What the site asks of the slot (slice 9b). Core imports this file and
 * never a pack: the providers come from `registry.ts`, and every answer
 * here is bounded by which packs the TENANT has switched on, read inside
 * the same transaction as the pages — a block whose pack is off is not
 * offered in the editor and draws nothing on the page, however it got
 * into the content.
 */
function provider(kind: string): SiteBlockProvider<Tx> | null {
  return SITE_BLOCK_PROVIDERS.find((p) => p.kind === kind) ?? null;
}

/** The packs switched on for this tenant, by slug. */
export async function enabledPacks(tx: Tx, tenantId: string): Promise<Set<string>> {
  const rows = await tx.query.tenantModules.findMany({
    where: and(eq(schema.tenantModules.tenantId, tenantId), eq(schema.tenantModules.enabled, true)),
    columns: { moduleId: true },
  });
  return new Set(rows.map((r) => r.moduleId));
}

/** The blocks the editor may offer this tenant, with their fields resolved: only providers whose pack is on. */
export async function siteBlockCatalog(tx: Tx, tenantId: string): Promise<BlockCatalogEntry[]> {
  const on = await enabledPacks(tx, tenantId);
  const offered = filterCatalog(SITE_BLOCK_PROVIDERS, on);
  const entries: BlockCatalogEntry[] = [];
  for (const p of offered) {
    entries.push({ kind: p.kind, pack: p.pack, label: p.label, hint: p.hint, fields: await p.fields(tx, tenantId) });
  }
  return entries;
}

/**
 * Why a page with these sections cannot be saved, or null. An owner may
 * only keep a block whose pack is on and whose config its provider takes;
 * the message names the section the way the content model's own do.
 */
export async function blockSectionsProblem(tx: Tx, tenantId: string, sections: Section[]): Promise<string | null> {
  const blocks = blockSectionsOf(sections);
  if (blocks.length === 0) return null;
  const on = await enabledPacks(tx, tenantId);
  for (const [i, section] of sections.entries()) {
    if (section.type !== "block") continue;
    const p = provider(section.kind);
    if (!p || !on.has(p.pack)) {
      return `Section ${i + 1}: that block needs the ${packOfKind(section.kind)} pack switched on.`;
    }
    if (!p.parseConfig(section.config)) return `Section ${i + 1}: ${p.label} needs its settings filled in.`;
  }
  return null;
}

/**
 * The views for every block section on show, keyed by `blockKey`, loaded
 * once per distinct block. A block whose pack is off, whose config its
 * provider refuses, or whose load fails gets no entry, and the renderer
 * draws nothing for it: the page comes up whatever a pack does.
 */
export async function loadSiteBlocks(tx: Tx, tenantId: string, sections: Section[], now = new Date()): Promise<Record<string, BlockView>> {
  const blocks = blockSectionsOf(sections);
  if (blocks.length === 0) return {};
  const on = await enabledPacks(tx, tenantId);
  const views: Record<string, BlockView> = {};
  for (const section of blocks) {
    const key = blockKey(section);
    if (key in views) continue;
    const p = provider(section.kind);
    if (!p || !on.has(p.pack)) continue;
    const config = p.parseConfig(section.config);
    if (!config) continue;
    try {
      views[key] = await p.load(tx, tenantId, config, now);
    } catch (err) {
      console.error(`site block ${section.kind} failed to load`, err instanceof Error ? err.message : err);
    }
  }
  return views;
}
