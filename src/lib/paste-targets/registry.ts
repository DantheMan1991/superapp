import "server-only";
import { customersPasteTarget, vendorsPasteTarget } from "@/modules/accounting/paste/targets";
import { assetsPasteTarget } from "@/packs/assets/paste/target";
import { itemsPasteTarget } from "@/packs/inventory/paste/target";
import { paddocksPasteTarget } from "@/packs/land/paste/target";
import { animalsPasteTarget } from "@/packs/livestock/paste/target";
import { pricesPasteTarget } from "@/packs/retail/paste/target";
import type { PasteTarget } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/paste-targets/` that may
 * import from `src/modules/**` or `src/packs/**` — the job
 * `setup-sources/registry.ts` does for the card, for the same reason:
 * somebody has to name the concrete implementations, and confining that to
 * one file is what keeps every other arrow pointing one way.
 *
 * ORDER IS THE ORDER OF VALUE TO A BUSINESS MOVING IN, per the onboarding
 * plan: who it deals with, then what it keeps, then the animals counted in
 * that, then what it owns, the ground, and what it charges. Nothing reads the
 * order today — each page offers only its own target — but a screen that one
 * day lists "what can I paste" should not have to decide it.
 *
 * The plan's seven targets are all here. What is NOT a target, and why, is in
 * each filler's header: parcels (two deeds are not a list), quantities on
 * hand (a count or a delivery, never a paste), costs never tracked (blank).
 */
export const pasteTargets: readonly PasteTarget[] = [
  vendorsPasteTarget,
  customersPasteTarget,
  itemsPasteTarget,
  animalsPasteTarget,
  assetsPasteTarget,
  paddocksPasteTarget,
  pricesPasteTarget,
];
