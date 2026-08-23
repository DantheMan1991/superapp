import "server-only";
import type { Tx } from "@/db";
import { inventoryBasisLens } from "@/packs/inventory/basis-lens";
import type { BasisLensProvider } from "./types";

/**
 * Which things outside `accounting` may change what a basis lens recognises.
 *
 * **THIS FILE EXISTS SO THAT ACCOUNTING NEVER NAMES A PACK**, which is the same
 * job `src/lib/mail-extensions/registry.ts` and
 * `src/lib/attention-sources/registry.ts` do, and the same rule
 * `src/packs/run-handlers.ts` lives by: **a registry may know that several
 * things exist; no individual module or pack may.** Core imports
 * `@/lib/basis-lens/resolve`; the pack is named here and nowhere else in that
 * chain.
 *
 * Slice 3b earned this rule: `approveBill` copies a bill line's account
 * verbatim and `inventory` sets that account at match time, precisely so the
 * bill path never learns what a stock receipt is. Teaching `getBalances` about
 * `item_kind` would have undone it in the one function every report goes
 * through.
 *
 * **CONSULTED, NEVER ASSUMED.** A tenant with no inventory has no recorded tax
 * rules, so the provider returns nothing after one cheap query and no report
 * changes shape.
 *
 * **DELIBERATELY NOT GATED ON THE PACK BEING SWITCHED ON**, for the reason
 * `run-handlers.ts` gives about the withdrawal clock: a business that turned
 * `inventory` off still has whatever it elected, and a treatment that stopped
 * applying because a toggle moved would change a tax figure with nothing
 * anywhere to say why.
 */
export const BASIS_LENS_PROVIDERS: BasisLensProvider<Tx>[] = [
  inventoryBasisLens,
];
