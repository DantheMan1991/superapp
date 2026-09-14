import "server-only";
import { accountingTellSource } from "@/modules/accounting/tell/source";
import { timeTellSource } from "@/modules/time/tell/source";
import { inventoryTellSource } from "@/packs/inventory/tell/source";
import { workTellSource } from "@/modules/work/tell/source";
import { livestockTellSource } from "@/packs/livestock/tell/source";
import type { TellSource } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/tell-sources/` that may
 * import from `src/modules/**` or `src/packs/**` — the job every other
 * registry beside a contract does, and for the same reason: somebody has to
 * name the concrete implementations, and confining that to one file is what
 * keeps every other arrow pointing one way.
 *
 * THREE SOURCES, and the third is the one that matters for the claim. The
 * founder's ask was that this *"should work with every tool"*. `livestock` and
 * `time` are both things a particular kind of business does; `work` is a list
 * of things that need doing, which every business alive has. It is the source
 * that shows the slot is not a farm feature wearing a general coat.
 *
 * `inventory` joined them in Phase B and is the one that changes the shape of
 * the problem: stock is said by every business, every day, and feeding animals
 * is ALSO using stock — the first pair of actions in this product that a
 * sentence can honestly belong to either of. `tests/fixtures/tell-sentences.ts`
 * holds that pair, and `npm run tell:eval` is how it stays settled.
 *
 * The ones that would come next, each a file and a line here: `crm` (a call
 * logged against a name), `land` (a paddock rested or topped), `production`
 * (a run's yield).
 *
 * ORDER IS MOST-SAID FIRST: the clock is said by the most people, then the jobs
 * everybody has, then stock, then the herd.
 *
 * ORDER MATTERS A LITTLE. Every action a tenant has goes into ONE tool
 * description (`tellToolFor`), so this list is the order the model reads them
 * in. Most-said first: the clock is said by the most people, then the jobs
 * everybody has, then the herd.
 */
export const tellSources: readonly TellSource[] = [
  timeTellSource,
  workTellSource,
  inventoryTellSource,
  accountingTellSource,
  livestockTellSource,
];
