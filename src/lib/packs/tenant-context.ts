import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { getIndustryProfile } from "@/industries";
import { resolveLabels } from "./resolve";

/**
 * What a pack needs to know about the tenant it is rendering for: its
 * vocabulary and its configuration.
 *
 * THE FIRST CALLER OF `resolveLabels`, which had been built and tested and
 * unread since Layer 2 shipped because nothing rendered a label.
 *
 * Both halves degrade silently and neither throws. `tenants.industry` defaults
 * to `'general'`, which is not a profile and never will be, and both jsonb
 * columns have no shape constraint — so the no-profile, no-override path is the
 * COMMON one and a corrupted row must at worst mean default words, never a
 * crashed page.
 *
 * **LABELS ARE TENANT-WIDE, not per pack.** They were briefly stored on each
 * pack's own `tenant_modules.config` row, on the reasoning that renaming a word
 * for one pack should not silently rename it in another. That was backwards:
 * `zone` is `land`'s word that `livestock` also displays, so a per-pack
 * override would have changed one screen and left the other alone. A paddock is
 * a paddock everywhere on a farm. Corrected 2026-08-15 — see `tenants.labels`.
 */
export interface PackContext {
  /** Profile vocabulary, overridden tenant-wide. Read through `labelFor`. */
  labels: Record<string, string>;
  /**
   * This pack's settings: the profile's `packConfig[slug]` as defaults, with
   * `tenant_modules.config` layered on top.
   *
   * `unknown`, deliberately. A pack parses its OWN key with its own tolerance
   * for nonsense (see `areaUnitFrom` in `packs/land/core/area.ts`); typing it
   * here would mean this Layer 0 file knowing what each pack's settings look
   * like, which is exactly the coupling packs exist to avoid.
   */
  config: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export async function packContext(
  tx: Tx,
  tenantId: string,
  industry: string,
  slug: string,
): Promise<PackContext> {
  const profile = getIndustryProfile(industry);

  const [moduleRow, tenantRow] = await Promise.all([
    tx.query.tenantModules.findFirst({
      where: and(
        eq(schema.tenantModules.tenantId, tenantId),
        eq(schema.tenantModules.moduleId, slug),
      ),
      columns: { config: true },
    }),
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
      columns: { labels: true },
    }),
  ]);

  const profileDefaults = asRecord(asRecord(profile?.packConfig)?.[slug]);

  return {
    labels: resolveLabels(profile?.labels, tenantRow?.labels),
    config: { ...(profileDefaults ?? {}), ...(asRecord(moduleRow?.config) ?? {}) },
  };
}
