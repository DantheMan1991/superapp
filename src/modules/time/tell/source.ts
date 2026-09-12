import type { Tx } from "@/db";
import {
  TellRefusal,
  type TellAction,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { formatDuration } from "../core/duration";
import { TimeError } from "../core/errors";
import { clockIn, clockOut } from "../punch-ops";
import { getWorkerForUser, listOpenPunches } from "../read";
import { getTimePrefs } from "../settings-ops";

/**
 * What the time module can be told in one sentence — *"clock me in"*.
 *
 * THE SECOND FILLER OF THE `tell-sources` SLOT, and the one ADR 0039 was
 * waiting for: *"when a second pack fills the slot the box belongs somewhere
 * both can be reached from — What needs you"*. Moving it was a page change,
 * exactly as that ADR said it would be, and no source changed.
 *
 * ── IT IS ALWAYS YOUR OWN CLOCK ──────────────────────────────────────────────
 *
 * There is no "who" field, and that is the security property rather than a
 * convenience. The worker is resolved from `ctx.userId` through
 * `getWorkerForUser`, so **a sentence can only ever move the speaker's own
 * clock.** Clocking somebody ELSE in is writing a wage record on their behalf,
 * which is what the shared keypad's PIN exists for (`pin-ops.ts`), and a
 * sentence carries no credential of theirs. "Clock Dave in" has nothing here
 * to land on, deliberately.
 *
 * A person the business does not keep hours for contributes NO actions at
 * all, so the model is never told these exist — the same gating a switched-off
 * module gets.
 *
 * ── AND IT USES `ctx.now`, NEVER A CLOCK ─────────────────────────────────────
 *
 * **This is the action that made `TellCtx.now` necessary.** From the box the
 * two are the same instant. From a phone (ADR 0048) a sentence spoken in a
 * barn with no signal is queued and arrives hours later, and stamping the
 * punch at processing time would not be a rounding error — it would be wages.
 * `new Date()` must not appear in this file.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────
 *
 * **No backdating.** "I started at seven" is an amendment to the record, and
 * the module has a screen for it that shows what changed and who changed it.
 * A spoken hour is the one input nobody can check afterwards.
 *
 * **No "what it was for"** (slice 4's dimensions). It belongs on the ENTRY,
 * which clock-out creates, and choosing between a tenant's whole dimension
 * tree by voice needs the readback work that has not been done. The clock
 * runs either way; tagging it later costs nothing.
 */

const note = (v: TellValues[string]): string =>
  typeof v === "string" ? v.trim().slice(0, 500) : "";

/**
 * The module's own refusals, in its own words — ADR 0039's third rule. `a
 * clock is already running` and `that person has left` are already written
 * for a person to read, and rewriting them here would be a second voice
 * saying a worse version of the same thing.
 */
function refusal(err: unknown): unknown {
  return err instanceof TimeError ? new TellRefusal(err.message) : err;
}

/** The speaker's own running clock, if they have one. */
async function myOpenPunch(tx: Tx, tenantId: string, workerId: string) {
  const open = await listOpenPunches(tx, tenantId);
  return open.find((p) => p.workerId === workerId) ?? null;
}

export const timeTellSource: TellSource = {
  slug: "time",
  moduleSlug: "time",
  label: "Time",
  revalidate: ["/dashboard/m/time", "/dashboard/hours"],

  async actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]> {
    const worker = await getWorkerForUser(tx, ctx.tenantId, ctx.userId);
    // Not somebody this business keeps hours for. The module may well be on
    // for the workspace; it is simply not on for them, and an action they
    // cannot perform is worse in the catalogue than absent from it.
    if (!worker) return [];

    return [
      {
        slug: "time.clock_in",
        title: "Clocked in",
        // ADR 0050. A clock that started when you did not mean it to is on
        // the Time panel the moment you look, and {button:Cancel} removes the
        // punch outright. It moves no head, no stock and no money — it is a
        // timestamp on your own name.
        unattended: true,
        about:
          "The person speaking is starting work NOW. Examples: “clock me in”, “starting on the fencing”, “I'm on”. Only ever the speaker's own clock — if the sentence names somebody else, this is not the action. Do not choose this for a sentence that says when they started; there is no way to record a past time here.",
        fields: [
          {
            key: "note",
            label: "What you are starting on",
            kind: "text",
            hint: "What the work is, if the sentence says. Leave out when it only says they are starting.",
          },
        ],
        async record(tx, ctx, values) {
          try {
            await clockIn(tx, ctx.tenantId, {
              workerId: worker.id,
              note: note(values.note),
              actorClerkUserId: ctx.userId,
              // NOT `new Date()`. See the header.
              at: ctx.now,
            });
          } catch (err) {
            throw refusal(err);
          }
          const at = new Intl.DateTimeFormat("en-US", {
            timeZone: ctx.timezone,
            hour: "numeric",
            minute: "2-digit",
          }).format(ctx.now);
          return { summary: `Clocked in at ${at}` };
        },
      },
      {
        slug: "time.clock_out",
        title: "Clocked out",
        // Same three tests as clock-in. A stop in the wrong minute is an
        // amendment on a screen built to show what changed and who changed it.
        unattended: true,
        about:
          "The person speaking is stopping work NOW. Examples: “clock me out”, “that's me done”, “finished for the day”. Only ever the speaker's own clock.",
        fields: [
          {
            key: "note",
            label: "Anything to add",
            kind: "text",
            hint: "What was done, if the sentence says. Usually empty.",
          },
        ],
        async record(tx, ctx, values) {
          const open = await myOpenPunch(tx, ctx.tenantId, worker.id);
          // The module's verbs refuse a punch that is already stopped, but
          // they cannot refuse one that was never started — there is nothing
          // to name. So this is the slot's own refusal, and the only one.
          if (!open) throw new TellRefusal("your clock is not running");

          const prefs = await getTimePrefs(tx, ctx.tenantId);
          let result;
          try {
            result = await clockOut(tx, ctx.tenantId, {
              punchId: open.id,
              note: note(values.note),
              actorClerkUserId: ctx.userId,
              at: ctx.now,
              roundingMinutes: prefs.roundingMinutes,
              timezone: ctx.timezone,
            });
          } catch (err) {
            throw refusal(err);
          }

          // BOTH NUMBERS, the way the panel says them. "You worked 7:53, we
          // logged 8:00" is a sentence; a single figure that quietly differs
          // from the span is a discrepancy found at the end of the month.
          const worked = formatDuration(result.rawMinutes);
          const paid = formatDuration(result.paidMinutes);
          return {
            summary:
              result.paidMinutes === result.rawMinutes
                ? `Clocked out — ${worked}`
                : `Clocked out — ${worked} worked, ${paid} paid`,
          };
        },
      },
    ];
  },
};
