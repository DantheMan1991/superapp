import type { Tx } from "@/db";
import { normalizeName } from "@/lib/paste-targets/shape";
import {
  PasteRefusal,
  type PasteChoice,
  type PasteCtx,
  type PasteField,
  type PasteRow,
  type PasteSaved,
  type PasteTarget,
} from "@/lib/paste-targets/types";
import { UNITS } from "../core/units";
import { createItem, InventoryError, listItems } from "../ops";
import { slugLabel, STORAGE_REQUIREMENTS, SUGGESTED_ITEM_KINDS } from "../vocabulary";

/**
 * Kinds of stock as a paste target (ADR 0036): the list of what a business
 * keeps and counts — feed, supplies, produce, meat, eggs, seed, medicine —
 * which on a farm moving in is a shelf list, a feed-store invoice, or the
 * left-hand column of somebody's spreadsheet.
 *
 * What is NOT here, deliberately: quantities on hand and costs. A kind of
 * stock is a thing; what is on the shelf is a delivery or a count, recorded
 * where those are recorded, and the plan's answer on cost never tracked is
 * that it stays blank. A "qty" column on this dialog would invite a guessed
 * balance with no batch behind it.
 *
 * `save` is `createItem` exactly as the item form calls it, so the unit is the
 * pack's own list and an unknown one is the pack's own refusal.
 */

const UNIT_CHOICES: PasteChoice[] = UNITS.map((u) => ({
  value: u.code,
  label: u.plural === u.code ? u.code : `${u.plural} (${u.code})`,
}));

const STORAGE_CHOICES: PasteChoice[] = STORAGE_REQUIREMENTS.map((s) => ({
  value: s,
  label: slugLabel(s),
}));

const text = (v: PasteRow[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

function refusal(err: unknown): unknown {
  return err instanceof InventoryError ? new PasteRefusal(err.message) : err;
}

export const itemsPasteTarget: PasteTarget = {
  slug: "inventory.items",
  moduleSlug: "inventory",
  label: "Kinds of stock",
  noun: { one: "kind of stock", many: "kinds of stock" },
  about:
    "kinds of stock — the things the business keeps and counts: feed, supplies, produce, meat, eggs, seed, medicine",
  async describe(tx: Tx, ctx: PasteCtx) {
    // The kinds already in use come first in the model's list, so a farm that
    // calls its bedding "supply" keeps calling it that.
    const items = await listItems(tx, ctx.tenantId);
    const kinds = [
      ...new Set([...items.map((i) => i.itemKind), ...SUGGESTED_ITEM_KINDS]),
    ];
    const fields: PasteField[] = [
      {
        key: "name",
        label: "Name",
        kind: "text",
        required: true,
        hint: "What it is called, as the business calls it — Layer pellets, Ground beef, Fence staples.",
      },
      {
        key: "kind",
        label: "Kind",
        kind: "choice",
        hint: "What sort of thing it is.",
        choices: kinds.map((k) => ({ value: k, label: slugLabel(k) })),
      },
      {
        key: "unit",
        label: "Counted in",
        kind: "choice",
        required: true,
        hint: "How it is counted or measured on hand — pounds for feed, each for tools, dozen for eggs, packages for wrapped meat.",
        choices: UNIT_CHOICES,
      },
      {
        key: "purchaseUnit",
        label: "Bought in",
        kind: "text",
        hint: "What it is bought in when that differs from how it is counted — bag, case, pallet, bale.",
      },
      {
        key: "purchaseUnitQty",
        label: "How many, each",
        kind: "number",
        hint: "How much of the counting unit one of those holds — 50 for a 50 lb bag.",
      },
      {
        key: "storage",
        label: "Kept",
        kind: "choice",
        hint: "Frozen, refrigerated, dry or ambient, when the list says.",
        choices: STORAGE_CHOICES,
      },
      { key: "notes", label: "Notes", kind: "text", hint: "Anything else the list says about it." },
    ];
    return { fields };
  },
  async duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]) {
    const items = await listItems(tx, ctx.tenantId);
    const known = new Map(items.map((i) => [normalizeName(i.name), i.name]));
    return rows.map((row) => {
      const name = text(row.name);
      return name ? (known.get(normalizeName(name)) ?? null) : null;
    });
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    try {
      const item = await createItem(tx, ctx, {
        name: text(row.name)!,
        itemKind: text(row.kind) ?? "supply",
        stockingUnit: text(row.unit)!,
        purchaseUnit: text(row.purchaseUnit),
        purchaseUnitQty: typeof row.purchaseUnitQty === "number" ? row.purchaseUnitQty : null,
        storageRequirement: text(row.storage),
        notes: text(row.notes) ?? undefined,
      });
      return { id: item.id, label: item.name };
    } catch (err) {
      throw refusal(err);
    }
  },
  revalidate: ["/dashboard/m/inventory", "/dashboard"],
};
