import "server-only";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { FoodError } from "./core/errors";
import { normalizePlate } from "./core/plate";
import { searchFoods, type FoodHit } from "./eating-ops";
import { callPlateModel, type PlateModel } from "./plate-model";

/**
 * A PLATE, READ (D4a, ADR 0126): Claude names the foods and their grams; each
 * is then found on the food list by its search words (or, failing those, its
 * name), and the person checks the lot before anything is kept. Nothing is
 * written here and the photo is kept nowhere: it goes to Claude with the
 * request, and what comes back is a draft for the screen.
 */

export interface PlateDraftItem {
  /** The id the item is logged under, made here, so the Add can be sent twice and kept once. */
  id: string;
  /** What Claude called it, shown beside the match so the person can judge the match. */
  seen: string;
  /** How much Claude judged there was. */
  grams: number;
  /** The food on the list it was matched to; null when none was found, and the person searches. */
  match: FoodHit | null;
}

export async function readPlate(
  ctx: TenantContext,
  jpeg: string,
  deps: { model?: PlateModel } = {},
): Promise<PlateDraftItem[]> {
  let raw: unknown;
  try {
    raw = await (deps.model ?? callPlateModel)(jpeg);
  } catch (error) {
    console.error("plate read failed", error instanceof Error ? error.name : "unknown");
    throw new FoodError("PLATE_FAILED");
  }
  const plate = normalizePlate(raw);
  if (!plate.found) throw new FoodError("PLATE_EMPTY");
  return withTenant(
    ctx.tenant.id,
    async (tx) => {
      const out: PlateDraftItem[] = [];
      for (const item of plate.items) {
        const [byWords] = await searchFoods(tx, item.search, 1);
        const match = byWords ?? (await searchFoods(tx, item.name, 1))[0] ?? null;
        out.push({ id: randomUUID(), seen: item.name, grams: item.grams, match });
      }
      return out;
    },
    { role: ctx.role },
  );
}
