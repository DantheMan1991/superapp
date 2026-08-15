import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { getIndustryProfile } from "@/industries";
import { resolveLabels } from "./resolve";

/**
 * What a pack needs to know about the tenant it is rendering for: its
 * vocabulary and its configuration.
 *
 * THE FIRST CALLER OF `resolveLabels`, which has been built and tested and
 * unread since Layer 2 shipped, because nothing rendered a label. `land` is the
 * first pack whose core word is genuinely wrong for its first customer — a
 * homestead says "paddock", not "zone" — so this is where the seam finally has
 * a consumer.
 *
 * Both halves degrade silently and neither throws. `tenants.industry` defaults
 * to `'general'`, which is not a profile and never will be, and
 * `tenant_modules.config` is jsonb with no shape constraint. The no-profile,
 * no-config path is therefore the COMMON one — it runs for every tenant that
 * has never installed anything — and a corrupted row must at worst mean default
 * words and default settings, never a crashed page.
 */
export interface PackContext {
  /** Profile vocabulary, overridden per tenant. Read through `labelFor`. */
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

  const row = await tx.query.tenantModules.findFirst({
    where: and(
      eq(schema.tenantModules.tenantId, tenantId),
      eq(schema.tenantModules.moduleId, slug),
    ),
    columns: { config: true },
  });
  const tenantConfig = asRecord(row?.config);

  // Per-tenant vocabulary lives under a `labels` key on the pack's own row, so
  // a tenant renaming a word for one pack does not silently rename it in
  // another. Everything else on that row is the pack's settings.
  const { labels: labelOverrides, ...settings } = tenantConfig ?? {};

  const profileDefaults = asRecord(
    asRecord(profile?.packConfig)?.[slug],
  );

  return {
    labels: resolveLabels(profile?.labels, labelOverrides),
    config: { ...(profileDefaults ?? {}), ...settings },
  };
}
