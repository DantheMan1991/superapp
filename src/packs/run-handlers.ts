import "server-only";
import type { Tx } from "@/db";
import type { RunInputHandler } from "./production/core/handler";
import { livestockRunHandler } from "./livestock/run-handler";

/**
 * Which packs own the contents of an inventory lot, for the purposes of a
 * production run.
 *
 * **THIS FILE EXISTS FOR THE SAME REASON `src/packs/index.ts` DOES**, and the
 * comment at the top of that file is the whole justification: a registry may
 * know that several packs exist; no individual pack may. `production` must not
 * require `livestock` — a bakery running runs over purchased flour is a
 * legitimate composition — and `livestock` must not require `production`,
 * because a farm that never processes anything still has a withdrawal clock. So
 * one names the slot, the other fills it, and this is the only place both
 * appear.
 *
 * **CONSULTED, NEVER ASSUMED.** A tenant with no livestock has no handler
 * claiming any lot: every input is ordinary stock, leaves through
 * `inventory.issueStock`, and nothing about the run model changes.
 *
 * **DELIBERATELY NOT GATED ON THE PACK BEING SWITCHED ON.** A handler claims a
 * lot by finding a row, so a tenant without `livestock` installed has nothing to
 * find and the guard is inert. Where it is NOT inert is the case that matters:
 * a farm that switched `livestock` off still has animals under a withdrawal, and
 * a clock that stopped applying because a toggle moved would be the most
 * dangerous kind of quiet.
 */
export const RUN_INPUT_HANDLERS: RunInputHandler<Tx>[] = [livestockRunHandler];
