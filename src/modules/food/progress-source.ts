import "server-only";
import type { ProgressSource, ProgressWindow } from "@/lib/progress-sources/types";
import { eatingRows, eatingToday } from "./core/progress-rows";
import { dayEaten, eatenBetween, getTargets } from "./eating-ops";

/**
 * FOOD IN THE PROGRESS SLOT (D4a; ADR 0125): what was eaten in a run of days,
 * and the targets, read in the caller's transaction (RLS has decided what it
 * sees) and added up by `core/progress-rows.ts`. Imports only the slot's
 * `types.ts`; the registry names this, and Food never learns Health exists.
 */
export const foodProgressSource: ProgressSource = {
  tool: "food",
  name: "Food",
  async rows(tx, tenantId, windows: readonly ProgressWindow[]) {
    if (windows.length === 0) return [];
    const from = windows.reduce((min, w) => (w.from < min ? w.from : min), windows[0].from);
    const to = windows.reduce((max, w) => (w.to > max ? w.to : max), windows[0].to);
    const [entries, targets] = [await eatenBetween(tx, tenantId, from, to), await getTargets(tx, tenantId)];
    return eatingRows(entries, windows, targets);
  },
  async today(tx, tenantId, day) {
    const [entries, targets] = [await dayEaten(tx, tenantId, day), await getTargets(tx, tenantId)];
    return eatingToday(entries, targets);
  },
};
