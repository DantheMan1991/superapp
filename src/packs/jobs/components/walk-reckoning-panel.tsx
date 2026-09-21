"use client";

import { AlertTriangle, Check, CornerUpLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/panel";
import { formatMoney } from "@/lib/money";
import type { Reckoning, StepReckoning, StepStanding } from "../walk-reckoning";

/**
 * THE WHOLE BID, AND THE WAY BACK INTO IT (X4, ADR 0098).
 *
 * Two things the walk did not have. **The rail** is every step of the
 * outline at once, coloured by what it is in — which replaces a progress bar
 * that could only say how far along you were, never whether any of it landed.
 * **The reckoning** is what is stopping the bid going out, and it is the
 * answer to the founder's verdict that the tool was not yet useful: a walk
 * that says *"that is the whole walk"* over three unpriced phases has told
 * you the conversation ended, not that the bid is done.
 *
 * ── THE RAIL STAYS CALM; THE RECKONING DOES THE WORRYING ────────────────────
 *
 * A step nobody has reached is grey, not red. Mid-walk that is most of them,
 * and a wall of red on a bid that is going perfectly well teaches somebody to
 * stop reading the colour — and then the real one goes past too. Red on the
 * rail means *answered and nothing came of it*, which is the state that
 * actually escapes into a proposal.
 */

interface Look {
  chip: string;
  dot: string;
  word: string;
}

const LOOKS: Record<StepStanding, Look> = {
  priced: { chip: "bg-success/40", dot: "bg-success", word: "priced" },
  out_for_bid: { chip: "bg-warning/60", dot: "bg-warning", word: "out for bid" },
  unpriced: { chip: "bg-destructive/50", dot: "bg-destructive", word: "not priced" },
  open: { chip: "bg-muted-foreground/25", dot: "bg-muted-foreground/40", word: "not walked yet" },
  by_others: { chip: "border border-border bg-transparent", dot: "bg-border", word: "by others" },
  nothing_asked: { chip: "bg-muted", dot: "bg-border", word: "asks nothing" },
};

export function WalkRail({
  reckoning,
  currentStepId,
  openStepId,
  onOpen,
}: {
  reckoning: Reckoning;
  currentStepId: string | null;
  openStepId: string | null;
  onOpen: (stepId: string) => void;
}) {
  if (reckoning.steps.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {reckoning.steps.map((s, i) => {
        const here = s.stepId === currentStepId;
        const showing = s.stepId === openStepId;
        return (
          <button
            key={s.stepId}
            type="button"
            onClick={() => onOpen(s.stepId)}
            title={`${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ""}`}
            aria-label={`${s.title}, ${LOOKS[s.standing].word}`}
            /**
             * **`rounded-sm` IS NOT SMALL HERE.** This design system remaps
             * Tailwind's radius scale off `--radius: .75rem`, so `rounded-sm`
             * computes to 7.2px — a circle on a 16px chip, and a row of them
             * read as dots rather than a rail. An explicit value is the fix.
             */
            className={`size-4 rounded-[3px] transition-opacity hover:opacity-70 ${
              LOOKS[s.standing].chip
            } ${here ? "ring-[1.5px] ring-primary ring-offset-1 ring-offset-card" : ""} ${
              showing && !here ? "ring-[1.5px] ring-border ring-offset-1 ring-offset-card" : ""
            }`}
          />
        );
      })}
    </div>
  );
}

/**
 * ONE STEP, OPENED FROM THE RAIL. What was asked, what was said, and the two
 * things somebody might want: go and work on it, or ask one question again.
 *
 * **ASK AGAIN IS THE ONLY WAY TO CHANGE AN ANSWER**, and it supersedes rather
 * than overwrites — the transcript keeps what was said at the time, which is
 * the promise the answers table has made since it was written.
 */
export function StepCard({
  step,
  index,
  isCurrent,
  busy,
  closed,
  symbol,
  onGo,
  onAskAgain,
  onClose,
}: {
  step: StepReckoning;
  index: number;
  isCurrent: boolean;
  busy: boolean;
  /**
   * The walk is over — which is when somebody most needs these two buttons,
   * not least. They used to be hidden here, on the grounds that a control
   * that can only produce an error toast is worse than none: `goToStep` and
   * `askAgain` both refused a walk that was not running, so on the one screen
   * X4 built for the end of a bid there was **no way back into a phase at
   * all**. Both doors now pick a finished walk back up, so the button is
   * offered and it works; this only changes the words beside it.
   */
  closed: boolean;
  symbol: string | null;
  onGo: () => void;
  onAskAgain: (questionId: string) => void;
  onClose: () => void;
}) {
  const look = LOOKS[step.standing];
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className={`size-2 shrink-0 rounded-full ${look.dot}`} aria-hidden="true" />
            {index + 1}. {step.title}
            {step.costCode && (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {step.costCode}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {look.word}
            {step.detail && ` · ${step.detail}`}
            {step.amountCents > 0 && ` · ${formatMoney(step.amountCents, symbol)} of cost`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {/**
            * **ONLY WHERE THERE IS SOMETHING TO ASK.** A bookmark on a phase
            * whose questions are all settled does not stick — `currentStep`
            * honours it only while the step has work in it, and ADR 0099
            * turned down honouring it anyway, because that wedges a walk on a
            * step with nothing to say. On a covered phase the way back in is
            * **Ask again** on the answer you want to change, below.
            */}
          {!isCurrent && step.outstanding > 0 && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onGo}>
              <CornerUpLeft className="size-3.5" /> Work on this
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {step.asked.length === 0 ? (
        <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
          Nothing has been asked on this one yet.
        </p>
      ) : (
        <ul className="mt-3 border-t">
          {step.asked.map((a, i) => (
            <li
              key={i}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{a.prompt}</p>
                {a.skipped ? (
                  <p className="mt-0.5 text-sm italic text-muted-foreground">
                    Passed — {a.skipReason}
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm">{a.answer}</p>
                )}
              </div>
              {a.questionId && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onAskAgain(a.questionId as string)}
                >
                  <RotateCcw className="size-3.5" /> Ask again
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {step.outstanding > 0 && (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          {step.outstanding} {step.outstanding === 1 ? "question" : "questions"} on this step
          nobody has answered.
        </p>
      )}

      {/**
        * **SAY THAT THE WALK STARTS AGAIN**, because it does: both buttons
        * put a finished walk back on this phase, price it, and let it close
        * itself again when nothing is outstanding. Somebody who thought they
        * were only reading the transcript should not discover that by being
        * asked a question.
        */}
      {closed && (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          This walk is finished. Working on a phase picks it back up, and it
          finishes again once nothing is outstanding.
        </p>
      )}
    </Panel>
  );
}

/**
 * WHAT IS STOPPING THIS BID. Holes first, then what is merely waiting on
 * somebody else — `reckonWalk` does that ordering, because which of the two a
 * phase is in decides whose move it is.
 */
export function WalkReckoning({
  reckoning,
  symbol,
  onOpen,
}: {
  reckoning: Reckoning;
  symbol: string | null;
  onOpen: (stepId: string) => void;
}) {
  const waiting = reckoning.blocking.filter((b) => b.standing === "out_for_bid");
  const holes = reckoning.blocking.filter((b) => b.standing !== "out_for_bid");

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">The whole bid</p>
        <p className="text-sm text-muted-foreground">
          {reckoning.priced} priced ·{" "}
          <span className="font-medium text-foreground">
            {formatMoney(reckoning.pricedCents, symbol)}
          </span>{" "}
          of cost on the estimate
        </p>
      </div>

      {reckoning.ready ? (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-success/15 px-3 py-2 text-sm text-success-foreground">
          <Check className="size-4 shrink-0" />
          Every phase is priced, excluded or asks nothing. Nothing is outstanding.
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {reckoning.blocking.length}{" "}
          {reckoning.blocking.length === 1 ? "phase is" : "phases are"} not finished.
        </p>
      )}

      {holes.length > 0 && <Rows rows={holes} onOpen={onOpen} />}

      {waiting.length > 0 && (
        <>
          <Rows rows={waiting} onOpen={onOpen} />
          {/**
           * **NOT IN THE TOTAL, AND SAID OUT LOUD.** A price nobody has chosen
           * is not a number yet; a total that quietly carried the lowest one
           * would be the plausible wrong figure this program exists to refuse.
           */}
          <p className="mt-1.5 pl-4 text-xs text-muted-foreground">
            {waiting.length === 1
              ? "Nobody is going with one yet, so that is not in the figure above."
              : `Nobody is going with one yet, so none of those ${waiting.length} are in the figure above.`}
          </p>
        </>
      )}

      {/**
        * **ROOMS NOTHING ON THE BID MENTIONS** (X8b).
        *
        * The founder, weighing this against a template estimate sheet:
        * *"How is this question thing we are building better than just have
        * a template estimate sheet with all of the assemblies preloaded."*
        * This is one of the answers. A template fails by SILENCE — the row
        * you did not fill in looks exactly like the row that does not
        * apply — and the forgotten room is the error that eats the margin.
        *
        * Amber rather than red, and not counted in "not finished": a garage
        * with no finishes against it is usually correct. Something to look
        * at, not something in the way. Blocking on it would teach somebody
        * to ignore the panel that matters.
        */}
      {reckoning.roomsUnpriced.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-sm text-warning-foreground">
            {reckoning.roomsUnpriced.length}{" "}
            {reckoning.roomsUnpriced.length === 1 ? "room has" : "rooms have"} nothing on this
            bid.
          </p>
          <p className="mt-1 text-xs text-warning-foreground/80">
            {reckoning.roomsUnpriced
              .map((r) => (r.level ? `${r.name} (${r.level})` : r.name))
              .join(" · ")}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Read off the lines&apos; own words, so a line that does not name its rooms will show
            here even when it covers them. Often right — a garage usually has nothing.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>{reckoning.priced} priced</span>
        {reckoning.byOthers > 0 && <span>{reckoning.byOthers} by others, in the exclusions</span>}
        {reckoning.outForBid > 0 && <span>{reckoning.outForBid} out for bid</span>}
        {reckoning.unpriced > 0 && <span>{reckoning.unpriced} answered and not priced</span>}
        {reckoning.open > 0 && <span>{reckoning.open} not walked yet</span>}
      </div>
    </Panel>
  );
}

function Rows({
  rows,
  onOpen,
}: {
  rows: readonly StepReckoning[];
  onOpen: (stepId: string) => void;
}) {
  return (
    <ul className="mt-2">
      {rows.map((r) => (
        <li key={r.stepId}>
          <button
            type="button"
            onClick={() => onOpen(r.stepId)}
            className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          >
            <span
              className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                LOOKS[r.standing].dot
              }`}
              aria-hidden="true"
            />
            <span className="flex-1 text-sm">{r.title}</span>
            <span className="text-xs text-muted-foreground">
              {r.detail || LOOKS[r.standing].word}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
