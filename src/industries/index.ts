import type { IndustryProfile } from "./types";
import { homesteadFarm } from "./homestead-farm";

/**
 * Layer 2b registry: slug → manifest.
 *
 * `tenants.industry` defaults to `'general'`, which is NOT a profile and never
 * will be — it is the absence of one. Every lookup here must tolerate a slug
 * with no manifest and degrade rather than throw, because the no-profile path
 * is the common one and runs for every tenant on every request that resolves a
 * label.
 */
export const industryRegistry: Record<string, IndustryProfile> = {
  "homestead-farm": homesteadFarm,
};

/** The value `tenants.industry` carries when no profile has been installed. */
export const NO_PROFILE = "general";

export function getIndustryProfile(slug: string): IndustryProfile | null {
  return industryRegistry[slug] ?? null;
}

export function listIndustryProfiles(): IndustryProfile[] {
  return Object.values(industryRegistry).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
