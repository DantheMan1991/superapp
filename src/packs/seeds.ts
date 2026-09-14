import "server-only";
import type { Tx } from "@/db";
import { applyJobsSeed, summarizeJobsSeed } from "./jobs/seed";

/**
 * Which packs can take a profile's seed, and how — ADR 0057.
 *
 * **A PACK REGISTERS AN APPLIER; THE PROFILE CARRIES THE DATA; THE CONSOLE
 * KNOWS NEITHER.** `src/app/admin/profile-seed.ts` walks `profile.seed.packs`
 * and hands each entry to the applier registered here under that slug — so a
 * profile can seed a pack's tables without the console learning what those
 * tables are, and a pack can accept a seed without knowing which industry it
 * came from. The rejected alternative was `profile-seed.ts` growing a
 * `costCodeSets` branch, which would have made Layer 0 know a pack's shape and
 * grown a branch per pack table from then on.
 *
 * SEPARATE FROM `src/packs/index.ts` ON PURPOSE. An applier imports a pack's
 * `ops.ts`, which is `server-only`; the registry is data the shell reads, and
 * a server-only import there would be a build error the moment anything
 * client-side touched it. Two files, one slug each.
 *
 * `apply` runs inside `withTenant(tenantId, …, { role: "owner" })` with an
 * owner-role context for the pack's own write rules — a seed is the install
 * acting as the business's owner, attributed to the superadmin who pressed the
 * button.
 */
export interface PackSeedApplier {
  /** One line for the console before the button; null when the seed brings nothing. */
  summarize(seed: unknown): string | null;
  apply(
    tx: Tx,
    ctx: { tenantId: string; userId: string; role: "owner" },
    seed: unknown,
  ): Promise<{ created: number; description: string }>;
}

export const packSeedAppliers: Record<string, PackSeedApplier> = {
  jobs: { summarize: summarizeJobsSeed, apply: applyJobsSeed },
};
