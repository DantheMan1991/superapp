"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import {
  friendlyTellError,
  proposeTold,
  recordTold,
  type TellProposal,
} from "./resolve";
import { confirmedEntriesSchema, TELL_MAX_CHARS, type TellCard } from "./shape";
import type { TellCtx } from "./types";

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
async function gate(): Promise<TellCtx> {
  const ctx = await requireTenant();
  // Typed on a screen, so the sentence happened now. The phone's gate
  // (`device-grants/redeem.ts`) is the one where this is not true.
  const now = new Date();
  return {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
    now,
    timezone: ctx.tenant.timezone,
    today: todayInTimezone(ctx.tenant.timezone, now),
  };
}

const proposeSchema = z.object({
  sentence: z.string().max(TELL_MAX_CHARS),
});

export async function proposeTellAction(
  input: z.infer<typeof proposeSchema>,
): Promise<ActionResult<TellProposal>> {
  try {
    const ctx = await gate();
    const parsed = proposeSchema.safeParse(input);
    if (!parsed.success) return { error: "That is a lot for one go — say one thing at a time." };
    return { ok: true, data: await proposeTold(ctx, parsed.data.sentence) };
  } catch (err) {
    return { error: friendlyTellError(err) };
  }
}

const recordSchema = z.object({ entries: confirmedEntriesSchema });

export async function recordTellAction(input: {
  entries: Array<{ actionSlug: string; values: TellCard["values"] }>;
}): Promise<ActionResult<{ summaries: string[] }>> {
  try {
    const ctx = await gate();
    const parsed = recordSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const result = await recordTold(ctx, parsed.data.entries);
    for (const path of result.touched) revalidatePath(path);
    revalidatePath("/dashboard");
    return { ok: true, data: { summaries: result.summaries } };
  } catch (err) {
    return { error: friendlyTellError(err) };
  }
}
