import type { CoaTemplate } from "@/modules/accounting/templates/general";

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
   * Data contributed on install: chart of accounts and folders.
   *
   * Applied by `src/app/admin/profile-seed.ts` (back-office slice 7a) — at
   * install for every module that is on, and again for a module switched on
   * later, so a profile installed first loses nothing. Additive over what the
   * tenant has: a code or a root folder that already exists is skipped, never
   * renamed.
   *
   * `accounts` is the template ITSELF, not a slug into core's
   * `COA_TEMPLATES`: registering an industry's chart there would make core
   * know an industry, which is the inversion the extension model forbids. A
   * profile's chart is written as ADDITIONS to the general one — parents it
   * names are general accounts, codes it uses are ones the general chart does
   * not — because Accounting is provisioned with `general` when it is
   * switched on and the profile lands on top.
   *
   * No document kinds: `documents.doc_kind` is an open taxonomy typed freely,
   * and nothing lists its values, so a seeded list would have no reader.
   */
  seed?: {
    accounts?: CoaTemplate;
    /** Root folders, beside the platform's starter cabinet, in this order. */
    folders?: string[];
  };
  /**
   * Config handed to packs on install. A pack reads ITS OWN KEY and never the
   * profile slug — the moment a pack looks up which industry it is in, the
   * boundary has been broken.
   */
  packConfig?: Record<string, unknown>;
  /**
   * Platform-level presentation this industry wants, applied to the TENANT at
   * install rather than resolved live.
   *
   * Copied rather than read through, unlike `labels`: these settle onto columns
   * every module reads — `tenants.currency_symbol` today — and a tenant must be
   * able to change one afterwards without the profile silently putting it back.
   * A label is presentation the profile owns; this is a default it suggests.
   */
  display?: {
    /** "$", "£", or omitted for the house style of no symbol at all. */
    currencySymbol?: string;
  };
}
