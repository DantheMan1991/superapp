import "server-only";
import { livestockTellSource } from "@/packs/livestock/tell/source";
import type { TellSource } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/tell-sources/` that may
 * import from `src/modules/**` or `src/packs/**` — the job every other
 * registry beside a contract does, and for the same reason: somebody has to
 * name the concrete implementations, and confining that to one file is what
 * keeps every other arrow pointing one way.
 *
 * ONE SOURCE SO FAR, and the box is hosted on that pack's own daily round
 * because of it. The three sentences the plan opens with are all livestock —
 * "fed two bags to the broilers", "three chicks dead in pen two", "moved cows
 * to paddock seven" — and building a second filler before the first has been
 * used would be guessing at what the next one needs.
 *
 * The ones that would come next, each a file and a line here: `inventory`
 * (stock used or counted), `land` (a paddock rested or topped), `production`
 * (a run's yield). When a second exists the box belongs somewhere both packs
 * can be reached from — What needs you — and moving it is a page change, not
 * a change to any source.
 */
export const tellSources: readonly TellSource[] = [livestockTellSource];
