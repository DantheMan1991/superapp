import type { Tx } from "@/db";
import { normalizeName } from "@/lib/paste-targets/shape";
import {
  PasteRefusal,
  type PasteCtx,
  type PasteField,
  type PasteRow,
  type PasteSaved,
  type PasteTarget,
} from "@/lib/paste-targets/types";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { createZone, LandError, listParcels, listZones } from "../ops";

/**
 * Paddocks as a paste target (ADR 0036): the twenty fields a farm already
 * calls by name — on a rotation sheet, a fence map, or the back of an
 * envelope. A zone belongs to exactly one parcel, so the parcel is a column;
 * and because most farms are one parcel, a blank parcel means the only one,
 * and the column is only REQUIRED once there are two to choose from.
 *
 * THE FIRST TARGET THAT CAN BE BLOCKED. With no parcel there is nowhere for a
 * paddock to be, and the dialog says so before anything is read rather than
 * proposing rows that cannot save. Parcels themselves are added by hand or
 * found from the county — two deeds are not a list worth pasting.
 *
 * No boundary: a drawn paddock's acreage is its drawn acreage, and a paste
 * has no drawing. A figure the list gives is recorded as given.
 */

const text = (v: PasteRow[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

function refusal(err: unknown): unknown {
  return err instanceof LandError ? new PasteRefusal(err.message) : err;
}

/**
 * **THE STATIC HALF OF THIS TARGET CANNOT SPEAK THE TENANT'S WORD, AND THE
 * DIALOG DOES NOT NEED IT TO.** `label`, `noun` and `about` are read off the
 * object at module load, with no tenant in hand — but `PasteListButton` is
 * given the tenant's word by `LandModule` and overrides the first two, and
 * `about` only ever reaches the model's system prompt. What a person actually
 * READS comes out of `describe`, which has a `Tx` and a tenant, so that is
 * where the word is resolved.
 */
const noParcel = (zoneWord: string) =>
  `Add a parcel first, so a ${zoneWord.toLowerCase()} has somewhere to be.`;

export const paddocksPasteTarget: PasteTarget = {
  slug: "land.paddocks",
  moduleSlug: "land",
  label: "Paddocks",
  noun: { one: "paddock", many: "paddocks" },
  about:
    "paddocks — the named fields, pens and plots the business grazes, grows or works, each with its size where known",
  async describe(tx: Tx, ctx: PasteCtx) {
    const [parcels, pack] = await Promise.all([
      listParcels(tx, ctx.tenantId),
      // `industry` is nullable here and `packContext` degrades on an unknown
      // one, which is the same shape `livestock`'s target uses to read its
      // species list.
      packContext(tx, ctx.tenantId, ctx.industry ?? "", "land"),
    ]);
    const zoneWord = labelFor(pack.labels, "zone", "Zone");
    if (parcels.length === 0) {
      return { fields: [], blocked: noParcel(zoneWord) };
    }
    const one = parcels.length === 1;
    const fields: PasteField[] = [
      {
        key: "name",
        label: "Name",
        kind: "text",
        required: true,
        hint: `What the ${zoneWord.toLowerCase()} is called — North 40, Creek field, Pen 3.`,
      },
      {
        key: "parcel",
        label: "Parcel",
        kind: "choice",
        required: !one,
        hint: one
          ? "The block of ground it is on. Left blank, the only parcel is used."
          : "The block of ground it is on.",
        choices: parcels.map((p) => ({ value: p.id, label: p.name })),
      },
      {
        key: "acres",
        label: "Acres",
        kind: "number",
        hint: "Its size in acres, when the list gives one.",
      },
      { key: "notes", label: "Notes", kind: "text", hint: "Anything else the list says about it." },
    ];
    return { fields };
  },
  async duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]) {
    const known = new Map(
      (await listZones(tx, ctx.tenantId)).map((z) => [normalizeName(z.name), z.name]),
    );
    return rows.map((row) => {
      const name = text(row.name);
      return name ? (known.get(normalizeName(name)) ?? null) : null;
    });
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    let parcelId = text(row.parcel);
    if (!parcelId) {
      const parcels = await listParcels(tx, ctx.tenantId);
      if (parcels.length !== 1) throw new PasteRefusal("Parcel is missing.");
      parcelId = parcels[0].id;
    }
    try {
      const zone = await createZone(tx, ctx, {
        parcelId,
        name: text(row.name)!,
        areaAcres: typeof row.acres === "number" ? row.acres : null,
        notes: text(row.notes) ?? undefined,
      });
      return { id: zone.id, label: zone.name };
    } catch (err) {
      throw refusal(err);
    }
  },
  revalidate: ["/dashboard/m/land", "/dashboard"],
};
