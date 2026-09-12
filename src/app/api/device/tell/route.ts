import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { readProposal, signProposal } from "@/lib/public-token";
import { buildReadback } from "@/lib/device-grants/readback";
import {
  atEffectiveTime,
  clampSpokenAt,
  priorUse,
  recordUse,
  redeemGrant,
  usesInWindow,
} from "@/lib/device-grants/redeem";
import {
  bearerFrom,
  PROPOSAL_TTL_MS,
  RATE_MAX_PER_WINDOW,
  type ProposalPayload,
} from "@/lib/device-grants/types";
import { TELL_MAX_CHARS } from "@/lib/tell-sources/shape";
import { friendlyTellError } from "@/lib/tell-sources/resolve";
import { proposeTold, recordTold } from "@/lib/tell-sources/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHAT A PHONE SAYS, WITHOUT THE APP BEING OPEN.
 *
 * ============================================================================
 * THE ONLY ROUTE IN THE PRODUCT THAT WRITES TENANT DATA WITHOUT A SESSION.
 * ============================================================================
 *
 * `/api/schedule/feed/[token]` is the only one that READS without a session
 * and says so at the top of its own file; this is that, one degree more
 * serious, so the same discipline applies and then some. ADR 0048 has the
 * reasoning; `src/lib/device-grants/redeem.ts` has the gate.
 *
 * A Siri App Intent fires with the phone locked and the app closed. There is
 * no cookie, no Clerk session and no web view — the token in the Authorization
 * header is the entire credential. `clerkMiddleware()` attaches context and
 * never enforces it (`src/proxy.ts`), so nothing had to be excluded for this
 * to be reachable, which cuts both ways and is why every check lives here and
 * in `redeem.ts`.
 *
 * ── WHAT THIS ROUTE DOES NOT DO ──────────────────────────────────────────────
 *
 *  - **It never gets owner.** `roleForGrant` hands `withTenant` `staff` or
 *    `expert` and nothing else, so owners-only anything stays shut.
 *  - **It never writes by itself.** Two calls: one proposes and returns a
 *    readback, one records what a person said yes to. The model never writes,
 *    which is ADR 0039's rule and has not moved.
 *  - **It reads nothing back but its own work.** No balances, no lists.
 *
 * ── THE TWO CALLS ────────────────────────────────────────────────────────────
 *
 *   POST { idempotencyKey, utterance, spokenAt? }
 *     → 200 { ok, readback, ready, cards, proposal? }
 *   POST { idempotencyKey, proposal, confirm: true, spokenAt? }
 *     → 200 { ok, readback, recorded[] }
 *
 * The proposal is a SIGNED BLOB the phone holds between the two, not a row —
 * so there is no table to sweep and no dependence on both calls reaching the
 * same serverless instance (`signProposal`, `src/lib/public-token.ts`). It
 * carries its own five-minute expiry and the grant that made it, so one phone
 * cannot confirm another's cards.
 *
 * ── WHY REFUSALS ARE 200 ─────────────────────────────────────────────────────
 *
 * A voice client that gets a non-2xx says "something went wrong" and throws
 * the body away — including the sentence that explains what to do instead. So
 * anything the PERSON can act on ("a loss bigger than the pen", "I did not
 * catch which paddock") is a 200 carrying `ok: false` and a `readback` to
 * speak. Non-2xx is kept for what the person cannot act on: a bad credential,
 * a malformed body, too many sentences.
 */

const IDEMPOTENCY = z.string().min(8).max(200);
const SPOKEN_AT = z.string().datetime().optional();

const bodySchema = z.union([
  z.object({
    idempotencyKey: IDEMPOTENCY,
    spokenAt: SPOKEN_AT,
    utterance: z.string().min(1).max(TELL_MAX_CHARS),
  }),
  z.object({
    idempotencyKey: IDEMPOTENCY,
    spokenAt: SPOKEN_AT,
    confirm: z.literal(true),
    proposal: z.string().min(1).max(40_000),
  }),
]);

/** One answer for every credential failure. See `redeemGrant`. */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function say(
  status: number,
  body: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = bearerFrom(req.headers.get("authorization"));
  if (!token) return unauthorized();

  const redeemed = await redeemGrant(token);
  if (!redeemed) return unauthorized();
  const { grantId } = redeemed;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return say(400, { ok: false, error: "that is not a request I understand" });
  }
  const body = parsed.data;

  const now = new Date();
  const claimedAt = body.spokenAt ? new Date(body.spokenAt) : null;
  const { effectiveAt } = clampSpokenAt(claimedAt, now);
  // EVERY use of `ctx` below is dated to when the sentence HAPPENED, not to
  // when it arrived. A phone queues sentences while it has no signal, and an
  // action that stamps a timestamp — `time.clock_in` — must never read a clock.
  const ctx = atEffectiveTime(redeemed.ctx, effectiveAt);

  const scoped = <T,>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant(ctx.tenantId, fn, { role: ctx.role, userId: ctx.userId });

  // Idempotency and the rate limit in one transaction, before anything costs
  // a model call. A phone with no signal queues sentences and retries them.
  const pre = await scoped(async (tx) => ({
    prior: await priorUse(tx, grantId, body.idempotencyKey),
    used: await usesInWindow(tx, grantId, now),
  }));

  if (pre.prior) {
    // Answered from the first attempt rather than acted on again. The original
    // words are deliberately not stored (S9), so the replay says what became
    // of it and not what it said.
    return say(200, {
      ok: pre.prior.outcome !== "refused",
      replayed: true,
      outcome: pre.prior.outcome,
      readback:
        pre.prior.outcome === "recorded"
          ? "Already recorded."
          : "I already have that one.",
    });
  }

  if (pre.used >= RATE_MAX_PER_WINDOW) {
    return say(429, {
      ok: false,
      error: "too many",
      readback: "That is a lot of sentences in one hour. Try again shortly.",
    });
  }

  const write = (outcome: "proposed" | "recorded" | "refused", slugs: string[]) =>
    scoped((tx) =>
      recordUse(tx, {
        tenantId: ctx.tenantId,
        grantId,
        clerkUserId: ctx.userId,
        idempotencyKey: body.idempotencyKey,
        outcome,
        actionSlugs: slugs,
        claimedAt,
        effectiveAt,
      }),
    );

  /* -- Say it ------------------------------------------------------------- */

  if (!("confirm" in body)) {
    let proposal;
    try {
      proposal = await proposeTold(ctx, body.utterance);
    } catch (err) {
      await write("refused", []);
      return say(200, { ok: false, readback: friendlyTellError(err) });
    }

    const readback = buildReadback(proposal.cards, proposal.actions);
    const slugs = proposal.cards.map((c) => c.actionSlug);
    await write("proposed", slugs);

    return say(200, {
      ok: true,
      ready: readback.ready,
      readback: readback.text,
      cards: readback.cards,
      // Only a readback with every field filled is worth confirming, so a
      // blocked one comes back without anything to say yes to.
      proposal: readback.ready
        ? signProposal({
            exp: Date.now() + PROPOSAL_TTL_MS,
            grantId,
            entries: proposal.cards.map((c) => ({
              actionSlug: c.actionSlug,
              values: c.values,
            })),
          } satisfies ProposalPayload)
        : undefined,
    });
  }

  /* -- Yes ---------------------------------------------------------------- */

  const payload = readProposal<ProposalPayload>(body.proposal);
  if (!payload || payload.grantId !== grantId) {
    // Expired, edited, forged, or another phone's. One answer for all four.
    await write("refused", []);
    return say(200, {
      ok: false,
      readback: "That has expired. Say it again and I will read it back.",
    });
  }

  try {
    const result = await recordTold(ctx, payload.entries);
    await write(
      "recorded",
      payload.entries.map((e) => e.actionSlug),
    );
    await logAudit({
      action: "device.tell",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "device_grant",
      targetId: grantId,
      // Slugs only. What the person said never reaches the audit log (S9).
      meta: { actionSlugs: payload.entries.map((e) => e.actionSlug) },
    });
    for (const path of result.touched) revalidatePath(path);
    revalidatePath("/dashboard");

    return say(200, {
      ok: true,
      recorded: result.summaries,
      readback: `Done. ${result.summaries.join(". ")}.`,
    });
  } catch (err) {
    await write(
      "refused",
      payload.entries.map((e) => e.actionSlug),
    );
    // A pack's own refusal, in the pack's own words — ADR 0039's third rule.
    return say(200, { ok: false, readback: friendlyTellError(err) });
  }
}
