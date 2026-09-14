import "server-only";
import { withSystem, withTenant } from "@/db";
import type { IndustryProfile } from "@/industries/types";
import { provisionAccounting } from "@/modules/accounting/templates/apply";
import { provisionDocuments } from "@/modules/documents/templates/apply";
import { packSeedAppliers } from "@/packs/seeds";

/**
 * A profile's seed data reaches the tenant (back-office slice 7a).
 *
 * `IndustryProfile.seed` was declared with Layer 2 and read by nothing for a
 * month: `installProfile` switched packs on and stamped the profile, and the
 * chart of accounts and folders a manifest promised never arrived. This is
 * the applier, and it lives beside the console's actions rather than in
 * `src/lib` because it has to call two modules' own provisioners — the console
 * may import module code (the provisioning precedent), a lib may not.
 *
 * TWO RULES:
 *
 *   1. **A seed lands only in a module that is ON**, and is not lost when the
 *      module is off. Install the profile first and switch Accounting on a
 *      week later: `toggleModule` asks this again for that one module. So
 *      both doors — install, and switching a module on — call it, each with
 *      the features it knows are on, and the report says what still waits.
 *
 *   2. **Additive, re-runnable, and the tenant's own rows win.** Every
 *      provisioner here already skips a code or a root folder the tenant has,
 *      so a re-run creates nothing and renames nothing. A profile's chart is
 *      written as ADDITIONS to the general one (`src/industries/agency/
 *      accounts.ts` says why), never a replacement.
 *
 * THE THIRD SEED KIND IS A PACK'S, AND THIS FILE DOES NOT KNOW WHICH PACK
 * (ADR 0057). `seed.packs` is walked slug by slug and each entry handed to the
 * applier that pack registered in `src/packs/seeds.ts`; the rules above hold
 * because the applier keeps them. The construction profile's starter cost
 * code lists were the first, and the rejected alternative — a `costCodeSets`
 * branch here — would have grown a branch per pack table from then on.
 */
export interface SeedReport {
  accountsCreated: number;
  foldersCreated: number;
  /** One entry per pack that took a seed and created something. */
  packs: { slug: string; created: number; description: string }[];
  /**
   * Modules the profile carries a seed for that were not on — the seed
   * applies when they are switched on. Named so the console can say so.
   */
  waitingOn: string[];
}

export const EMPTY_SEED_REPORT: SeedReport = {
  accountsCreated: 0,
  foldersCreated: 0,
  packs: [],
  waitingOn: [],
};

/** What a profile would contribute, for telling a person before the button. */
export function seedSummary(profile: IndustryProfile): {
  accounts: number;
  folders: number;
  /** One line per pack seed, in the pack's own words. */
  packs: string[];
} {
  const packs: string[] = [];
  for (const [slug, packSeed] of Object.entries(profile.seed?.packs ?? {})) {
    const line = packSeedAppliers[slug]?.summarize(packSeed);
    if (line) packs.push(line);
  }
  return {
    accounts: profile.seed?.accounts?.accounts.length ?? 0,
    folders: profile.seed?.folders?.length ?? 0,
    packs,
  };
}

export async function applyProfileSeed(
  tenantId: string,
  profile: IndustryProfile,
  enabled: Iterable<string>,
  /** The superadmin pressing the button: a seeded row is created by somebody. */
  actorUserId: string,
): Promise<SeedReport> {
  const on = new Set(enabled);
  const report: SeedReport = { ...EMPTY_SEED_REPORT, packs: [], waitingOn: [] };
  const seed = profile.seed;
  if (!seed) return report;

  if (seed.accounts) {
    if (on.has("accounting")) {
      // As the tenant, the rule `provisionAccounting` has always kept: withSystem
      // never writes accounting rows. The general chart is already there — an
      // enabled-but-unprovisioned module is unrepresentable — so the profile's
      // parents resolve against it.
      const template = seed.accounts;
      const { accountsCreated } = await withTenant(tenantId, (tx) =>
        provisionAccounting(tx, tenantId, template),
      );
      report.accountsCreated = accountsCreated;
    } else {
      report.waitingOn.push("accounting");
    }
  }

  if (seed.folders && seed.folders.length > 0) {
    if (on.has("documents")) {
      // Under withSystem, as `provisionDocuments` requires (its header says why).
      // Sorted after the platform's own starter folders, in the manifest's order.
      const folders = seed.folders.map((name, i) => ({
        name,
        sortOrder: 100 + i * 10,
      }));
      const { foldersCreated } = await withSystem((tx) =>
        provisionDocuments(tx, tenantId, folders),
      );
      report.foldersCreated = foldersCreated;
    } else {
      report.waitingOn.push("documents");
    }
  }

  for (const [slug, packSeed] of Object.entries(seed.packs ?? {})) {
    const applier = packSeedAppliers[slug];
    // A profile naming a pack that registered no applier is a configuration
    // error `tests/packs.test.ts` catches before it ships; here it is simply
    // nothing to do rather than a thrown install.
    if (!applier) continue;
    if (!on.has(slug)) {
      report.waitingOn.push(slug);
      continue;
    }
    // As the tenant, as its owner: the pack's own write rules apply (a seeded
    // cost code is a cost object, and `upsertDimensionMember` insists on an
    // owner), attributed to the person who pressed the button.
    const result = await withTenant(
      tenantId,
      (tx) => applier.apply(tx, { tenantId, userId: actorUserId, role: "owner" }, packSeed),
      { role: "owner" },
    );
    if (result.created > 0) {
      report.packs.push({ slug, created: result.created, description: result.description });
    }
  }

  return report;
}
