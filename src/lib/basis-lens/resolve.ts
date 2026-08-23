import "server-only";
import type { Tx } from "@/db";
import { BASIS_LENS_PROVIDERS } from "./registry";
import {
  EMPTY_BASIS_LENS_ADJUSTMENT,
  type BasisLensAdjustment,
  type BasisLensRequest,
} from "./types";

/**
 * Run the providers and merge what they say.
 *
 * ## A FAILING PROVIDER MUST BREAK THE REPORT, NOT BE SWALLOWED
 *
 * The defensive posture here is `attention-sources/resolve.ts`'s, not
 * `mail-extensions/resolve.ts`'s, and the reason is the same one that file
 * gives. There, a broken extension costs its own chips and the inbox still
 * renders, so failure folds to `[]` and nobody is harmed.
 *
 * Here, folding a failure to "no adjustment" would hand somebody a profit and
 * loss computed on a treatment they did not elect, that balances, that looks
 * exactly like every other report, and that says nothing about having quietly
 * fallen back. **A wrong number nobody can see is the whole failure class
 * [ADR 0013](../../../docs/decisions/0013-inventory-tax-treatment.md) exists to
 * prevent.** So this rethrows, and the report fails loudly.
 *
 * ## Nothing here re-checks what a provider may see
 *
 * It cannot see anything: it is handed the caller's own `tx`, and RLS has
 * already decided. An application-level filter on top would be a second place
 * for that rule to be wrong.
 */
export async function resolveBasisLens(
  tx: Tx,
  request: BasisLensRequest,
): Promise<BasisLensAdjustment> {
  if (BASIS_LENS_PROVIDERS.length === 0) return EMPTY_BASIS_LENS_ADJUSTMENT;

  const excludedEntryIds: string[] = [];
  const substitutedLineAccounts = new Map<string, string>();

  for (const provider of BASIS_LENS_PROVIDERS) {
    let result: BasisLensAdjustment;
    try {
      result = await provider.adjust(tx, request);
    } catch (cause) {
      /**
       * **THE PROVIDER'S OWN MESSAGE IS PART OF THIS ONE, not just its
       * `cause`.** The first version wrapped it and put the reason in `cause`,
       * where a person reading a failed report never sees it — so a refusal
       * that exists to be actionable said only "could not be applied". A test
       * caught it by asserting on the reason rather than on the wrapper.
       *
       * Same lesson `LEDGER_ACCOUNTS` taught this codebase: a refusal carries
       * the repair, and flattening it to a generic apology throws away the only
       * thing that made refusing better than guessing.
       */
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `The "${provider.key}" basis lens could not be applied, so this report would have been computed on the wrong treatment and nothing has been rendered. ${reason}`,
        { cause },
      );
    }
    excludedEntryIds.push(...result.excludedEntryIds);
    for (const [lineId, accountId] of result.substitutedLineAccounts) {
      /**
       * **TWO PROVIDERS CLAIMING ONE LINE IS A CONFLICT, NOT A MERGE.** Last
       * write wins would make the answer depend on registry order, which is a
       * detail nobody reports on. There is one provider today and this is the
       * guard that keeps the second one from landing quietly.
       */
      const existing = substitutedLineAccounts.get(lineId);
      if (existing && existing !== accountId) {
        throw new Error(
          `Two basis lenses disagree about which account journal line ${lineId} belongs under. One of them is wrong and this report cannot say which.`,
        );
      }
      substitutedLineAccounts.set(lineId, accountId);
    }
  }

  return { excludedEntryIds, substitutedLineAccounts };
}
