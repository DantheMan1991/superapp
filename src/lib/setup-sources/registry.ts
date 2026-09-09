import "server-only";
import { accountingSetupSource } from "@/modules/accounting/setup/source";
import { crmSetupSource } from "@/modules/crm/setup/source";
import { emailSetupSource } from "@/modules/email/setup/source";
import { assetsSetupSource } from "@/packs/assets/setup/source";
import { inventorySetupSource } from "@/packs/inventory/setup/source";
import { landSetupSource } from "@/packs/land/setup/source";
import { livestockSetupSource } from "@/packs/livestock/setup/source";
import { retailSetupSource } from "@/packs/retail/setup/source";
import type { SetupSource } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/setup-sources/` that may
 * import from `src/modules/**` or `src/packs/**` — the job
 * `attention-sources/registry.ts` does for the digest, for the same reason:
 * somebody has to name the concrete implementations, and confining that to one
 * file is what keeps every other arrow pointing one way.
 *
 * REGISTRATION ORDER IS THE ORDER ON THE CARD, and it is the order a new
 * business should do these things in:
 *
 *  1. ACCOUNTING FIRST. The register is the one thing every business has, and
 *     the bank feed is what makes the money side automatic from day one.
 *  2. THEN THE PHYSICAL WORLD, in dependency order. A place (assets) before
 *     what is kept in it (inventory); stock lines before the animals counted
 *     in them (livestock); the ground they stand on (land); then where it is
 *     all sold (retail). `inventory` requires `assets` and `retail` requires
 *     `inventory` in `src/packs/index.ts`, so this is also the order the
 *     dependency graph would give.
 *  3. THEN WHO YOU DEAL WITH (crm). Customers and vendors mostly make
 *     themselves — a new name on an invoice or a bill creates one — so this
 *     sits after the things that generate them.
 *  4. MAIL LAST. A mailbox on the client's own domain is the step most often
 *     done with us rather than alone, and nothing else waits on it.
 *
 * Not registered, and each is an open item in docs/modules/onboarding.md:
 * `production` (a run needs animals, which is livestock's step), `documents`
 * and `scheduling` (their first rows are provisioned), `work`, `marketing`
 * (a brand kit is layer 0 and a site is optional).
 */
export const setupSources: readonly SetupSource[] = [
  accountingSetupSource,
  assetsSetupSource,
  inventorySetupSource,
  livestockSetupSource,
  landSetupSource,
  retailSetupSource,
  crmSetupSource,
  emailSetupSource,
];
