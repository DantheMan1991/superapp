import "server-only";
import type { Tx } from "@/db";
import { getActiveModules } from "@/lib/modules";
import { setupSources } from "./registry";
import type { SetupCtx, SetupOutcome, SetupSource, SetupStep } from "./types";

/**
 * Running the sources: which apply, what they found, and what to say when one
 * of them could not be asked.
 *
 * The posture is `attention-sources/resolve.ts`'s, for the same reason. The
 * card on the Overview DISAPPEARS when nothing is left to do, so a source that
 * failed and was folded to `[]` would render exactly like a business that is
 * set up. Failures are returned, and the card is forced by the type to say
 * "Inventory could not be checked" rather than nothing.
 *
 * Nothing here re-checks what a source may see. It is handed the caller's own
 * `tx`, and RLS has already decided.
 */

/**
 * Shorter than the digest's 8s: this runs behind a page somebody is looking
 * at, and every source is a `LIMIT 1` on a tenant index. A source that takes
 * longer than this is a source that is broken, and the card says so.
 */
const SOURCE_TIMEOUT_MS = 4_000;

/** A step with the section it belongs under — the source's label. */
export interface CollectedStep extends SetupStep {
  section: string;
}

export interface SetupResult {
  /** In registry order, then each source's own order. */
  steps: CollectedStep[];
  /** Sources that could not be asked. Non-empty means the list may be SHORT. */
  failed: Array<{ slug: string; label: string; reason: "error" | "timeout" }>;
  /**
   * True when every enabled source answered. The only condition under which an
   * empty `steps` means "set up" rather than "we could not tell".
   */
  complete: boolean;
}

/**
 * Race a source against the clock and never let it reject. The loser keeps
 * running — promises cannot be cancelled — so its eventual rejection is
 * swallowed explicitly rather than surfacing as an unhandled rejection after
 * the page has long since rendered.
 */
async function guarded(
  source: SetupSource,
  work: () => Promise<SetupStep[]>,
  timeoutMs: number,
): Promise<SetupOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = work().then(
      (steps) => ({ status: "ok" as const, source, steps }),
      (err) => {
        console.error(`setup source ${source.slug} failed`, err);
        return { status: "failed" as const, source, reason: "error" as const };
      },
    );
    const timeout = new Promise<SetupOutcome>((resolve) => {
      timer = setTimeout(() => {
        console.error(`setup source ${source.slug} timed out`);
        resolve({ status: "failed", source, reason: "timeout" });
      }, timeoutMs);
    });
    return await Promise.race([started, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The sources that apply to this tenant right now. A source whose module is
 * switched off contributes nothing and is NOT a failure.
 */
export async function enabledSetupSources(tenantId: string): Promise<SetupSource[]> {
  const active = await getActiveModules(tenantId);
  const enabled = new Set(active.map((m) => m.module.id));
  return setupSources.filter((s) => enabled.has(s.moduleSlug));
}

/**
 * Everything the business's tools are still waiting for.
 *
 * Sources run concurrently, each behind its own timeout, so one slow module
 * cannot decide how long the Overview takes. `sources` and `options` exist for
 * tests; the page passes neither.
 */
export async function collectSetup(
  tx: Tx,
  ctx: SetupCtx,
  sources?: readonly SetupSource[],
  options: { timeoutMs?: number } = {},
): Promise<SetupResult> {
  const applicable = sources ?? (await enabledSetupSources(ctx.tenantId));
  const timeoutMs = options.timeoutMs ?? SOURCE_TIMEOUT_MS;
  const outcomes = await Promise.all(
    applicable.map((source) => guarded(source, () => source.collect(tx, ctx), timeoutMs)),
  );

  const steps: CollectedStep[] = [];
  const failed: SetupResult["failed"] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "failed") {
      failed.push({
        slug: outcome.source.slug,
        label: outcome.source.label,
        reason: outcome.reason,
      });
      continue;
    }
    for (const step of outcome.steps) {
      steps.push({ ...step, section: outcome.source.label });
    }
  }

  return { steps, failed, complete: failed.length === 0 };
}
