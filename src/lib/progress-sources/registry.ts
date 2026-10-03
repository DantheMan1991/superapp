import "server-only";
import { fitnessProgressSource } from "@/modules/fitness/progress-source";
import { foodProgressSource } from "@/modules/food/progress-source";
import type { ProgressSource } from "./types";

/**
 * THE COMPOSITION ROOT for the progress slot (docs/modules/health.md, H1). The
 * only file in `src/lib/progress-sources/` that may import from
 * `src/modules/**`, exactly as `attention-sources/registry.ts` is for the
 * digest: somebody has to name the concrete sources, and confining that to one
 * file keeps every other arrow pointing one way. Health (the host) runs the
 * slot through `resolve.ts`; a tool imports `types.ts` and never this.
 *
 * Registration order is the order on Health's Progress page, after Health's
 * own rows: Workouts, then Food's eating (D4a).
 */
export const progressSources: readonly ProgressSource[] = [fitnessProgressSource, foodProgressSource];
