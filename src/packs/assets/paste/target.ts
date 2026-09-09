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
import { AssetError, createAsset, listAssets } from "../ops";
import { assetKindLabel, SUGGESTED_ASSET_KINDS } from "../vocabulary";

/**
 * Equipment and buildings as a paste target (ADR 0036): the asset register,
 * which on a farm moving in is an insurance schedule, the accountant's
 * depreciation list, or a walk round the yard with a notebook. The plan's
 * "places" — the freezers, the barn, the walk-in — are assets with `Things
 * are kept here` on, so they are a column here rather than a target of their
 * own: a list of what the farm owns says which of it holds stock.
 *
 * COST IS TAKEN ONLY WHEN THE LIST GIVES IT, in dollars, and lands as
 * `acquisitionCostCents` with no depreciation method — the register's own
 * form does the same, and the depreciation settings move together under a
 * CHECK that this dialog has no business half-filling. Depreciation already
 * taken before the books began is slice 5's, not this one's.
 *
 * `save` is `createAsset` exactly as the form calls it: the company is the
 * default one, resolved and frozen there; an unknown kind is the pack's own
 * refusal.
 */

const KEEPS_CHOICES: PasteChoice[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const text = (v: PasteRow[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

function refusal(err: unknown): unknown {
  return err instanceof AssetError ? new PasteRefusal(err.message) : err;
}

export const assetsPasteTarget: PasteTarget = {
  slug: "assets.assets",
  moduleSlug: "assets",
  label: "Assets",
  noun: { one: "asset", many: "assets" },
  about:
    "equipment and buildings — what the business owns: tractors, trucks, barns, freezers, fencing, tools",
  async describe(tx: Tx, ctx: PasteCtx) {
    const kinds = [
      ...new Set([
        ...(await listAssets(tx, ctx.tenantId)).map((a) => a.kind),
        ...SUGGESTED_ASSET_KINDS,
      ]),
    ];
    const fields: PasteField[] = [
      {
        key: "name",
        label: "Name",
        kind: "text",
        required: true,
        hint: "What it is called — Kubota L3901, the north barn, the chest freezer in the garage.",
      },
      {
        key: "kind",
        label: "Kind",
        kind: "choice",
        hint: "What sort of thing it is.",
        choices: kinds.map((k) => ({ value: k, label: assetKindLabel(k) })),
      },
      {
        key: "identifier",
        label: "Serial or tag",
        kind: "text",
        hint: "A serial number, plate or tag, if the list gives one.",
      },
      {
        key: "model",
        label: "Model",
        kind: "text",
        hint: "The maker's model, if given — what it is, as opposed to which one.",
      },
      { key: "acquired", label: "Acquired", kind: "date", hint: "When it was bought or built." },
      {
        key: "cost",
        label: "Cost",
        kind: "number",
        hint: "What it cost, in dollars, only when the list says. Never an estimate.",
      },
      {
        key: "keeps",
        label: "Things are kept here",
        kind: "choice",
        hint: "Yes when stock is kept in it — a freezer, a barn, a walk-in, a truck that carries product. No otherwise.",
        choices: KEEPS_CHOICES,
      },
      { key: "notes", label: "Notes", kind: "text", hint: "Anything else the list says about it." },
    ];
    return { fields };
  },
  async duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]) {
    const known = new Map(
      (await listAssets(tx, ctx.tenantId)).map((a) => [normalizeName(a.name), a.name]),
    );
    return rows.map((row) => {
      const name = text(row.name);
      return name ? (known.get(normalizeName(name)) ?? null) : null;
    });
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    try {
      const asset = await createAsset(tx, ctx, {
        kind: text(row.kind) ?? "equipment",
        name: text(row.name)!,
        identifier: text(row.identifier) ?? undefined,
        model: text(row.model) ?? undefined,
        acquiredOn: text(row.acquired),
        acquisitionCostCents:
          typeof row.cost === "number" ? Math.round(row.cost * 100) : null,
        isStorageLocation: text(row.keeps) === "yes",
        notes: text(row.notes) ?? undefined,
      });
      return { id: asset.id, label: asset.name };
    } catch (err) {
      throw refusal(err);
    }
  },
  // Inventory's hub reads the places, so it is told too.
  revalidate: ["/dashboard/m/assets", "/dashboard/m/inventory", "/dashboard"],
};
