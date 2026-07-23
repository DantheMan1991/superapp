import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { z } from "zod";

/**
 * The pack AI-context seam (P17, umbrella axis-2 seam #3): industry packs
 * register prompt-context contributions per AI tool; the AI engines stay
 * pack-unaware of contents. A pack's guidance is included only for
 * tenants that have the pack enabled in tenant_modules.config.packs.
 *
 * No real pack ships in the core phase — the test stub proves the seam.
 */

export type PackAiTool = "bill_coding";

export interface PackContextContribution {
  packId: string;
  tool: PackAiTool;
  /** Runs inside the caller's withTenant tx; null = nothing to add. */
  buildGuidance: (tx: Tx, tenantId: string) => Promise<string | null>;
}

const registry: PackContextContribution[] = [];

export function registerPackContext(contribution: PackContextContribution): void {
  registry.push(contribution);
}

/** Test helper — packs never unregister in production. */
export function unregisterPackContext(packId: string, tool: PackAiTool): void {
  for (let i = registry.length - 1; i >= 0; i--) {
    if (registry[i].packId === packId && registry[i].tool === tool) {
      registry.splice(i, 1);
    }
  }
}

const packsConfigSchema = z.object({ packs: z.array(z.string()).default([]) });

async function enabledPacks(tx: Tx, tenantId: string): Promise<Set<string>> {
  // The accounting module's tenant_modules row carries the packs config.
  const row = await tx.query.tenantModules.findFirst({
    where: and(
      eq(schema.tenantModules.tenantId, tenantId),
      eq(schema.tenantModules.moduleId, "accounting"),
    ),
    columns: { config: true },
  });
  const parsed = packsConfigSchema.safeParse(row?.config ?? {});
  return new Set(parsed.success ? parsed.data.packs : []);
}

export async function getPackGuidance(
  tx: Tx,
  tenantId: string,
  tool: PackAiTool,
): Promise<string[]> {
  const enabled = await enabledPacks(tx, tenantId);
  if (enabled.size === 0) return [];
  const out: string[] = [];
  for (const contribution of registry) {
    if (contribution.tool !== tool || !enabled.has(contribution.packId)) continue;
    try {
      const guidance = await contribution.buildGuidance(tx, tenantId);
      if (guidance && guidance.trim() !== "") out.push(guidance.trim());
    } catch (err) {
      // A broken pack contribution must never block coding.
      console.error(`pack context ${contribution.packId} failed`, err);
    }
  }
  return out;
}
