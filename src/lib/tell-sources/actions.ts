"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { clampSpokenAt, type SpokenAt } from "./spoken-at";
import {
  friendlyTellError,
  previewTold,
  proposeTold,
  recordTold,
  type TellProposal,
} from "./resolve";
import { confirmedEntriesSchema, TELL_MAX_CHARS, type TellCard } from "./shape";
import type { TellCtx, TellPreview } from "./types";

/**
 * Tell it what happened, then confirm it (onboarding slice 6).
 *
 * TWO ACTIONS ON PURPOSE, and the split is the safety property (see
 * `resolve.ts`). `proposeTell` writes NOTHING. `recordTell` writes the cards
 * a person confirmed, through the pack's own verb.
 *
 * Platform code in `src/lib/`, like `work/actions.ts` and
 * `paste-targets/actions.ts`: no pack hosts the box, so no pack hosts its
 * actions.
 */

type ActionResult<T> = { ok: true; data: T } | { error: string };

/**
 * NO ROLE CHECK HERE, deliberately. Every action records through the pack's
 * own verb, and that verb's level is the rule — `allowsWrite` clears `expert`
 * at `member` on purpose, because in a PACK the outside accountant is a
 * member and walking the round is a chore
 * (`src/lib/packs/authorize.ts`, and the daily round's own guide says so).
 * A second rule here would be a second opinion, and the one that drifted
 * would be this one.
 */
async function gate(claimedAt?: string): Promise<{ ctx: TellCtx; spoken: SpokenAt }> {
  const ctx = await requireTenant();
  const serverNow = new Date();

  /*
   * **A SENTENCE IS NOT ALWAYS AS OLD AS ITS REQUEST** (tell.md, slice D2).
   *
   * This used to say "typed on a screen, so the sentence happened now", and
   * for a typed sentence it still does — nothing sends `spokenAt` unless it
   * waited. What changed is that the box now keeps a sentence said in a field
   * with no bars and replays it when there is signal, so the same door the
   * phone's gate had is needed here.
   *
   * How much of the claim to believe is NOT decided here. `clampSpokenAt`
   * owns that rule for both doors ([ADR 0055](../../../docs/decisions/0055-a-queued-sentence-is-old-not-wrong.md)),
   * because two copies of it is how two paths come to disagree about wages.
   */
  const spoken = clampSpokenAt(claimedAt ? new Date(claimedAt) : null, serverNow);

  return {
    // `today` follows the EFFECTIVE time, not the request's. A sentence said
    // at dusk and sent the next morning must default its date field to the day
    // it happened, or every queued round lands on the wrong day.
    ctx: {
      tenantId: ctx.tenant.id,
      userId: ctx.userId,
      role: ctx.role,
      now: spoken.effectiveAt,
      timezone: ctx.tenant.timezone,
      industry: ctx.tenant.industry,
      today: todayInTimezone(ctx.tenant.timezone, spoken.effectiveAt),
    },
    spoken,
  };
}

const proposeSchema = z.object({
  sentence: z.string().max(TELL_MAX_CHARS),
  /** ISO, and only ever sent by a sentence that waited for signal. */
  spokenAt: z.string().datetime().optional(),
});

export async function proposeTellAction(
  input: z.infer<typeof proposeSchema>,
): Promise<ActionResult<TellProposal>> {
  try {
    // Parsed BEFORE the gate now, because the gate needs the claimed time out
    // of it — and refusing a malformed input without touching the database is
    // the better order anyway.
    const parsed = proposeSchema.safeParse(input);
    if (!parsed.success) return { error: "That is a lot for one go — say one thing at a time." };
    const { ctx } = await gate(parsed.data.spokenAt);
    return { ok: true, data: await proposeTold(ctx, parsed.data.sentence) };
  } catch (err) {
    return { error: friendlyTellError(err) };
  }
}

const previewSchema = z.object({
  actionSlug: z.string().min(1).max(120),
  values: z.record(z.string().max(64), z.union([z.string(), z.number(), z.null()])),
});

/**
 * What one card will do, asked again every time it changes (ADR 0054 §2).
 *
 * **WRITES NOTHING**, and the split is the same one `proposeTell` keeps: this
 * reads, `recordTell` writes, and a person stands between them. It carries
 * `spokenAt` for the same reason the other two do — a preview of a sentence
 * from yesterday evening has to be worked out against yesterday evening.
 *
 * A failure here is answered with `null` rather than an error. The card is
 * still correct without a preview and the pack's verb is still what refuses;
 * interrupting somebody because the arithmetic above the button could not be
 * done would be the tail wagging the dog.
 */
export async function previewTellAction(input: {
  actionSlug: string;
  values: TellCard["values"];
  spokenAt?: string;
}): Promise<ActionResult<TellPreview | null>> {
  try {
    const parsed = previewSchema.safeParse(input);
    if (!parsed.success) return { ok: true, data: null };
    const { ctx } = await gate(input.spokenAt);
    return { ok: true, data: await previewTold(ctx, parsed.data.actionSlug, parsed.data.values) };
  } catch {
    return { ok: true, data: null };
  }
}

const recordSchema = z.object({
  entries: confirmedEntriesSchema,
  spokenAt: z.string().datetime().optional(),
});

export async function recordTellAction(input: {
  entries: Array<{ actionSlug: string; values: TellCard["values"] }>;
  spokenAt?: string;
}): Promise<
  ActionResult<{
    summaries: string[];
    /**
     * How long the sentence waited before it was recorded, and whether the
     * claim survived the clamp.
     *
     * **RETURNED RATHER THAN ONLY STORED** — [ADR 0055](../../../docs/decisions/0055-a-queued-sentence-is-old-not-wrong.md)
     * leans on this. A three-hour-old clock-in recorded silently looks exactly
     * like a fresh one, and half of why the generous past bound is defensible
     * is that the box can SAY so. `clamped` matters as much: telling somebody
     * a sentence was dated back when it was not would be the same lie in the
     * other direction.
     */
    delayedMs: number;
    clamped: boolean;
  }>
> {
  try {
    const parsed = recordSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { ctx, spoken } = await gate(parsed.data.spokenAt);
    const result = await recordTold(ctx, parsed.data.entries);
    for (const path of result.touched) revalidatePath(path);
    revalidatePath("/dashboard");
    return {
      ok: true,
      data: {
        summaries: result.summaries,
        delayedMs: spoken.delayedMs,
        clamped: spoken.clamped,
      },
    };
  } catch (err) {
    return { error: friendlyTellError(err) };
  }
}
