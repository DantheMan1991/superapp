import "server-only";
import { timeTellSource } from "@/modules/time/tell/source";
import { livestockTellSource } from "@/packs/livestock/tell/source";
import type { TellSource } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/tell-sources/` that may
 * import from `src/modules/**` or `src/packs/**` — the job every other
 * registry beside a contract does, and for the same reason: somebody has to
 * name the concrete implementations, and confining that to one file is what
 * keeps every other arrow pointing one way.
 *
 * TWO SOURCES. `livestock` was the first, and the box lived on that pack's
 * own daily round because of it. `time` is the second, and ADR 0039 named
 * what that means: *"when a second pack fills the slot the box belongs
 * somewhere both can be reached from — What needs you — and moving it is a
 * page change, not a change to any source."* It was, exactly.
 *
 * The ones that would come next, each a file and a line here: `inventory`
 * (stock used or counted), `land` (a paddock rested or topped), `production`
 * (a run's yield).
 *
 * ORDER MATTERS A LITTLE. Every action a tenant has goes into ONE tool
 * description (`tellToolFor`), so this list is the order the model reads them
 * in. `time` first because "clock me in" is the sentence said most often and
 * by the most people, and the catalogue is read top-down.
 */
export const tellSources: readonly TellSource[] = [
  timeTellSource,
  livestockTellSource,
];
