import "server-only";
import type { Tx } from "@/db";
import { getActiveModules } from "@/lib/modules";
import { attentionSources } from "./registry";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
  SourceOutcome,
} from "./types";

/**
 * Running the sources: which apply, what they found, and what to say when one
 * of them could not be asked.
 *
 * The defensive posture here is deliberately DIFFERENT from
 * `mail-extensions/resolve.ts`, and the difference is the whole reason this
 * file exists separately rather than being generalised with it.
 *
 * There, a broken extension costs its own chips and the inbox still renders —
 * so failure folds silently to `[]` and nobody is harmed. Here, folding a
 * failure to `[]` would tell somebody they owe nothing when they might owe
 * seven things, in a product whose entire credibility rests on "one number
 * everywhere". So failures are RETURNED, and every caller is forced by the type
 * to decide what to say about them.
 *
 * Nothing here re-checks what a source is allowed to see. It cannot see
 * anything, because it is handed the caller's own `tx` and RLS has already
 * decided. An application-level filter on top would be a second place for that
 * rule to be wrong.
 */

/**
 * Long enough for a real query on a cold connection; short enough that one
 * wedged source does not hold up a digest run that has every other tenant still
 * to serve. More generous than mail's 2.5s: this runs in a cron, not behind
 * somebody's reading pane, and a slow honest answer beats a fast empty one.
 */
const SOURCE_TIMEOUT_MS = 8_000;

/**
 * Race a source against the clock and never let it reject.
 *
 * The loser keeps running — promises cannot be cancelled — so its eventual
 * rejection is swallowed explicitly. Without that, a slow source that also
 * fails surfaces as an unhandled rejection long after the run finished, in a
 * cron invocation nobody can identify.
 */
async function guarded(
  source: AttentionSource,
  work: () => Promise<AttentionItem[]>,
): Promise<SourceOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = work().then(
      (items) => ({ status: "ok" as const, source, items }),
      (err) => {
        // Never the item contents — a title carries a customer name (S9).
        console.error(`attention source ${source.slug} failed`, err);
        return { status: "failed" as const, source, reason: "error" as const };
      },
    );
    const timeout = new Promise<SourceOutcome>((resolve) => {
      timer = setTimeout(() => {
        console.error(`attention source ${source.slug} timed out`);
        resolve({ status: "failed", source, reason: "timeout" });
      }, SOURCE_TIMEOUT_MS);
    });
    return await Promise.race([started, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The sources that apply to this tenant right now.
 *
 * A source whose module is switched off contributes nothing and is NOT reported
 * as a failure — "you do not have Accounting" and "Accounting broke" are
 * different sentences and only one of them is alarming.
 */
export async function enabledAttentionSources(
  tenantId: string,
): Promise<AttentionSource[]> {
  const active = await getActiveModules(tenantId);
  const enabled = new Set(active.map((m) => m.module.id));
  return attentionSources.filter((s) => enabled.has(s.moduleSlug));
}

export interface AttentionResult {
  items: AttentionItem[];
  /** Sources that could not be asked. Non-empty means the count is a FLOOR. */
  failed: Array<{ slug: string; label: string; reason: "error" | "timeout" }>;
  /**
   * True when every enabled source answered. The only condition under which
   * "nothing needs you today" may be said as a fact rather than a guess.
   */
  complete: boolean;
}

/**
 * Everything this person still owes, across every enabled module.
 *
 * Sources run concurrently, each behind its own timeout, so one slow module
 * cannot decide how long the whole digest takes.
 */
export async function collectAttention(
  tx: Tx,
  ctx: AttentionCtx,
  sources?: readonly AttentionSource[],
): Promise<AttentionResult> {
  const applicable = sources ?? (await enabledAttentionSources(ctx.tenantId));
  const outcomes = await Promise.all(
    applicable.map((source) => guarded(source, () => source.collect(tx, ctx))),
  );

  const items: AttentionItem[] = [];
  const failed: AttentionResult["failed"] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "failed") {
      failed.push({
        slug: outcome.source.slug,
        label: outcome.source.label,
        reason: outcome.reason,
      });
      continue;
    }
    items.push(...outcome.items);
  }

  return { items, failed, complete: failed.length === 0 };
}

/** Ordering weight. Lower sorts first. */
const URGENCY_ORDER: Record<AttentionItem["urgency"], number> = {
  overdue: 0,
  today: 1,
  soon: 2,
};

/**
 * The order a person reads them in: most overdue first, then by date, then
 * alphabetically so the list is STABLE between runs.
 *
 * Stability is not a nicety. The design rejects learned or adaptive ranking
 * outright, because an order that changes for reasons the reader cannot predict
 * destroys the trust the whole channel runs on. Two runs over unchanged data
 * must produce a byte-identical list, which is why the last tiebreak is the key
 * rather than anything derived from row order.
 */
export function sortAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const byUrgency = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (byUrgency !== 0) return byUrgency;
    // Undated sorts after dated within the same urgency: a thing with an agreed
    // date is a firmer commitment than one without.
    if (a.dueOn !== b.dueOn) {
      if (a.dueOn === null) return 1;
      if (b.dueOn === null) return -1;
      return a.dueOn < b.dueOn ? -1 : 1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
