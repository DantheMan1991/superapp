/**
 * Layer 2b — an industry profile.
 *
 * A manifest, never components. A profile does not own features; it is a LIST
 * (docs/extension-model.md §1). Two profiles share a capability because both
 * reference the same pack, not because one inherits from the other.
 *
 * Sharing between profiles is by spreading a constant array, never by an
 * inheritance chain — flat and resolvable by reading one file, with no
 * "which ancestor set this" archaeology.
 */
export interface IndustryProfile {
  /** Stamped onto `tenants.industry` at install. */
  slug: string;
  name: string;
  /** One line, shown wherever a profile is chosen. */
  description: string;
  /**
   * Packs this profile installs, by slug.
   *
   * Order does not matter — the installer topologically sorts by each pack's
   * declared `requires`. Listing a pack whose dependency is absent from this
   * array is a configuration error the installer refuses, not something it
   * quietly fixes: a profile should say what it means.
   */
  packs: string[];
  /**
   * Vocabulary overrides, resolved LIVE rather than copied at install
   * (ADR 0009). Labels are pure presentation, so fixing one should not require
   * re-running an installer per tenant. A tenant may override any of these in
   * `tenant_modules.config`.
   */
  labels: Record<string, string>;
  /**
   * Data contributed on install: chart of accounts, folders, document kinds.
   *
   * NOT YET APPLIED — the installer currently enables packs and stamps the
   * profile. Seed application is the next slice, and needs a farm chart of
   * accounts written first. Declared now so the manifest shape does not change
   * when it lands.
   */
  seed?: {
    accounts?: string;
    folders?: string[];
    docKinds?: string[];
  };
  /**
   * Config handed to packs on install. A pack reads ITS OWN KEY and never the
   * profile slug — the moment a pack looks up which industry it is in, the
   * boundary has been broken.
   */
  packConfig?: Record<string, unknown>;
}
