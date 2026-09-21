"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CornerDownLeft, Receipt, Ruler, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/panel";
import type { WalkView } from "../walk-ops";
import { formatMoney } from "@/lib/money";
import { formatQuantity } from "../billing-math";
import { basisLabel, type LineBasis } from "../walk-lines-math";
import {
  applyStepAction,
  askAgainAction,
  closeWalkAction,
  goToStepAction,
  measureFromSheetAction,
  proposeStepAction,
  reckonWalkAction,
  skipQuestionAction,
  takeWalkTurnAction,
} from "../walk-actions";
import type { Reckoning } from "../walk-reckoning";
import { StepCard, WalkRail, WalkReckoning } from "./walk-reckoning-panel";
import { MeasureOnADrawing } from "./measure-on-a-drawing";
import { RoomsDialog } from "./rooms-dialog";

/** A line the walk has worked out but nobody has accepted yet. */
interface ProposedRow {
  id: string;
  description: string;
  unit: string;
  quantityThousandths: number;
  unitCostCents: number;
  costCode: string;
  basis: string;
  basisDetail: string;
  quantityBasis: string;
  quantityNote: string;
}

/**
 * WALKING AN ESTIMATE (X2a, ADR 0098): the conversation on the left, what it
 * has settled on the right.
 *
 * ── THE TURN BRINGS THE WHOLE VIEW BACK ─────────────────────────────────────
 *
 * Every action returns a fresh `WalkView`, so the screen never has to guess
 * what changed and never renders a step's progress that disagrees with the
 * question above it. `router.refresh()` runs too, but only to keep the
 * server's copy of the page warm — nothing on screen waits for it.
 *
 * ── IT DOES NOT BOOTSTRAP ITSELF ────────────────────────────────────────────
 *
 * The opening question is asked by the SERVER when the walk starts, so this
 * arrives with something on it and needs no effect. The first draft fired a
 * turn on mount and was wrong twice: `setState` inside an effect is an error
 * in this repo (cascading renders), and a screen that bootstraps itself shows
 * an empty panel for as long as the model takes. The `Ask it` button below is
 * only for the case where that opening turn failed.
 */

export function WalkScreen({
  initial,
  initialReckoning,
  projectId,
  estimateId,
  estimateHref,
  symbol,
}: {
  initial: WalkView;
  initialReckoning: Reckoning;
  projectId: string;
  estimateId: string;
  estimateHref: string;
  symbol: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<WalkView>(initial);
  /** The whole bid, refreshed beside a turn rather than inside one. */
  const [reck, setReck] = useState<Reckoning>(initialReckoning);
  /** The step opened from the rail, which is not where the walk is standing. */
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  /** The last thing sent, so a failed turn can be retried without retyping. */
  const [lastSaid, setLastSaid] = useState("");
  const [failed, setFailed] = useState(false);
  /** What was just said, shown at once while the turn runs. */
  const [echoed, setEchoed] = useState<{ prompt: string; answer: string } | null>(null);
  /** What this phase comes to, before anybody accepts it. */
  const [proposal, setProposal] = useState<{ lines: ProposedRow[]; excluded: string } | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * **EVERY CALL IS WRAPPED, and one that was not is why the founder found a
   * question with all of its buttons dead.** An action that REJECTS rather
   * than returning `{ error }` — the model overloaded, the request dropped —
   * left the transition unsettled, so `pending` stayed true and every
   * control on the screen stayed disabled with no way back but a reload.
   *
   * `lastSaid` is kept so the retry below can send the same thing again
   * without making somebody type it twice.
   */
  /**
   * **NOTHING WAITS FOR THIS.** A reckoning is five indexed reads and a turn
   * is already two and a half seconds of model; putting them in series would
   * undo the speed work the founder asked for. It is fired after the view has
   * landed and the panel catches up a beat later.
   */
  function refreshReckoning() {
    void reckonWalkAction({ interviewId: view.interviewId, projectId })
      .then((r) => {
        if ("reckoning" in r && r.reckoning) setReck(r.reckoning);
      })
      .catch(() => {
        /* The panel keeps the last good reckoning rather than emptying. */
      });
  }

  const openedIndex = openStepId
    ? reck.steps.findIndex((x) => x.stepId === openStepId)
    : -1;
  const opened =
    openedIndex >= 0 ? { step: reck.steps[openedIndex], index: openedIndex } : null;

  /** The conversation is over. The rail and the reckoning are not. */
  const done = view.status !== "running";
  /** Phases with questions nobody has answered, which a finished walk names. */
  const unasked = reck.steps.filter((s) => s.outstanding > 0).length;

  /** Shared by the two rail actions: both end with a fresh view and a turn. */
  function moved(
    run: () => Promise<{ error: string } | { ok: true; view?: WalkView | null }>,
    said: string,
  ) {
    if (pending) return;
    setOpenStepId(null);
    setEchoed(null);
    startTransition(async () => {
      try {
        const result = await run();
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setFailed(false);
        /** A proposal was about the answers as they were; these change them. */
        setProposal(null);
        if (result.view) setView(result.view);
        toast.success(said);
        refreshReckoning();
      } catch {
        toast.error("That did not get through. Try again.");
        setFailed(true);
      }
    });
  }

  /**
   * **A FINISHED WALK SAYS IT IS GOING AGAIN.** Both doors pick one back up
   * rather than refusing — the reckoning exists to be acted on — and a
   * conversation that simply reappeared over a screen reading *"that is every
   * question"* would be the surprise.
   */
  function goTo(stepId: string) {
    moved(
      () => goToStepAction({ interviewId: view.interviewId, stepId, projectId, estimateId }),
      done ? "Picking the walk back up there." : "Back on that one.",
    );
  }

  function askAgain(questionId: string) {
    moved(
      () => askAgainAction({ interviewId: view.interviewId, questionId, projectId, estimateId }),
      done ? "Picking the walk back up on that one." : "Asking that one again.",
    );
  }

  function send(text: string) {
    if (pending) return;
    setSaid("");
    setLastSaid(text);
    /**
     * **YOUR ANSWER LANDS BEFORE THE MODEL DOES.** A turn is a couple of
     * seconds whatever else is trimmed, and the first version spent all of
     * them with the panel greyed and nothing moving, which is what the
     * founder was describing when he said it seemed slow. Showing the answer
     * against the question it answered makes the wait the model's, not the
     * screen's — and it is only ever replaced by the real view a moment
     * later, so it cannot go stale.
     */
    if (text.trim() !== "") {
      setEchoed({ prompt: view.say, answer: text.trim() });
    }
    startTransition(async () => {
      try {
        const result = await takeWalkTurnAction({
          interviewId: view.interviewId,
          said: text,
          /**
           * **WHAT WAS ON THE SCREEN WHEN THEY ANSWERED.** The server holds
           * the pending question too, and if the two disagree this screen is
           * stale — so nothing is recorded and the real question comes back.
           * Without this an answer could land on a question nobody saw.
           */
          answering: view.say,
          projectId,
          estimateId,
        });
        if ("error" in result) {
          toast.error(result.error);
          setFailed(true);
          /**
           * **AND THE SCREEN RESYNCS EVEN ON A FAILURE.** A turn can commit
           * and then fail on the way back; keeping the old question on screen
           * is what sent the next answer to the wrong place.
           */
          if (result.view) {
            setView(result.view);
            setEchoed(null);
          }
          return;
        }
        setFailed(false);
        setEchoed(null);
        /** The screen was behind; it is not any more, and nothing was lost. */
        if ("resynced" in result && result.resynced) {
          toast.message("That had already moved on — here is where it is.");
        }
        /**
         * **A PHASE THAT LANDED SAYS SO.** Money that goes on silently may
         * as well not have gone on, which was half of what "it seems like I
         * am just answering questions" meant.
         */
        if ("put" in result && result.put) {
          toast.success(
            `${result.put.name} — ${formatMoney(result.put.cents, symbol)} on the estimate.`,
          );
        }
        /** A proposal is about the answers as they were; another answer
         *  makes it out of date, so it goes rather than misleading. */
        setProposal(null);
        if (result.view) setView(result.view);
        refreshReckoning();
        /**
         * **IT NO LONGER THROWS YOU OUT AT THE END.** This pushed straight to
         * the estimate the moment the questions ran out, so the one moment
         * somebody most needs to see what is missing was the one moment the
         * screen went away. Running out of questions is not the same as
         * having a bid, and the reckoning below says which you have.
         */
        if (result.finished) {
          toast.success("That is every question. See what is left below.");
        }
        /**
         * NO `router.refresh()` HERE EITHER. The turn returns the whole
         * view, so the refresh bought nothing and cost a server re-render of
         * the estimate page behind this one on every single exchange.
         */
      } catch {
        toast.error("That did not get through. Try again.");
        setFailed(true);
      }
    });
  }

  /**
   * **THE WALK IS ASKING WHAT THE BUILDING MEASURES (X7)**, not what the
   * work is. The answer box takes a figure, the drawings are one click
   * away, and the phase rail is beside the point until this is done.
   */
  const measuring = view.measuring.ask !== null;
  /** Either half of the measure-up: the phase rail is beside the point. */
  const settingUp = measuring || view.measuring.askingRooms;
  /** What the rooms come to, for the one line that says so. */
  const roomsMeasured = view.measuring.rooms.reduce(
    (n, r) => n + (r.areaThousandths ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {/**
              * **THE PHASE'S SECTION IS NOT TRUE WHILE MEASURING.** The step
              * underneath is only where the walk WILL start; printing
              * *04. Structural* over "Wall perimeter — how many lf?" says the
              * screen is somewhere it is not.
              */}
            {!settingUp && view.stepSection && (
              <p className="text-xs uppercase tracking-wide text-subtle-foreground">
                {view.stepSection}
              </p>
            )}
            <p className="text-sm font-medium">
              {measuring
                ? "Measuring the building"
                : view.measuring.askingRooms
                  ? "The rooms"
                  : view.stepTitle || "Finished"}
              {measuring ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {view.measuring.left} to go
                </span>
              ) : view.measuring.askingRooms ? null : (
                view.stepCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    step {view.stepNumber} of {view.stepCount}
                  </span>
                )
              )}
            </p>
            {view.stepGuidance && (
              <p className="mt-1 text-xs text-muted-foreground">{view.stepGuidance}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {view.progress.covered} of {view.progress.steps} steps ·{" "}
            {view.progress.answered} answered
            {view.progress.skipped > 0 && ` · ${view.progress.skipped} passed`}
            {view.progress.volunteered > 0 &&
              ` · ${view.progress.volunteered} it thought of`}
          </p>
        </div>
        {/**
          * **THE RAIL REPLACES A PROGRESS BAR.** A bar could only say how far
          * along the conversation was — never whether any of it landed on the
          * estimate, which is the only question that matters at the end.
          */}
        <WalkRail
          reckoning={reck}
          currentStepId={view.stepId}
          openStepId={openStepId}
          onOpen={(id) => setOpenStepId((was) => (was === id ? null : id))}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Every step of {view.outlineName}. Click one to see what it says.
        </p>
      </Panel>

      {opened && (
        <StepCard
          step={opened.step}
          index={opened.index}
          isCurrent={opened.step.stepId === view.stepId}
          busy={pending || working}
          closed={done}
          symbol={symbol}
          onGo={() => goTo(opened.step.stepId)}
          onAskAgain={(questionId) => askAgain(questionId)}
          onClose={() => setOpenStepId(null)}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          {done ? (
            <div className="space-y-3">
              {/**
                * **IT ONLY SAYS "EVERY QUESTION" WHEN IT WAS.** A walk used to
                * close the moment there was no step LEFT ON THE LIST, so one
                * taken to a late phase from the rail closed over the phases
                * before it — and said this over a bid with seven of them never
                * asked. The close rule is fixed; this is the sentence, and
                * walks closed under the old one are still out there.
                */}
              <p className="text-sm">
                {unasked > 0
                  ? `This walk stopped with ${unasked} ${unasked === 1 ? "phase" : "phases"} still to ask.`
                  : `That is every question in ${view.outlineName}.`}
                {reck.ready
                  ? " Nothing is outstanding."
                  : " What is left is below — click any phase to look at it."}
              </p>
              <Button onClick={() => router.push(estimateHref)}>
                Back to the estimate
              </Button>
            </div>
          ) : (
            <>
              <p className="min-h-12 text-[15px] leading-relaxed">
                {pending ? (
                  <span className="text-muted-foreground">Thinking…</span>
                ) : (
                  view.say || "It has not asked anything yet."
                )}
              </p>
              {!pending && view.say.trim() === "" && (
                <Button className="mt-3" size="sm" onClick={() => send("")}>
                  Ask it
                </Button>
              )}

              {failed && !pending && (
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => send(lastSaid)}>
                    Try that again
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Nothing you have said is lost.
                  </span>
                </div>
              )}

              {view.quickReplies.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {view.quickReplies.map((reply) => (
                    <Button
                      key={reply}
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => send(reply)}
                    >
                      {reply}
                    </Button>
                  ))}
                </div>
              )}

              <form
                className="mt-4 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (said.trim() === "") return;
                  send(said.trim());
                }}
              >
                <Input
                  value={said}
                  onChange={(e) => setSaid(e.target.value)}
                  disabled={pending}
                  placeholder="or say it in your own words"
                  aria-label="Your answer"
                  maxLength={2000}
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={pending || said.trim() === ""}
                >
                  <CornerDownLeft className="size-4" />
                </Button>
              </form>

              {/**
                * **THE TAKEOFF, WITHOUT LEAVING THE WALK (X7).** The
                * founder's ask, in his words: *"there are numerous times it
                * asks for a square footage. I need the takeoff tool to get
                * that a lot of the time."* The number it hands back goes on
                * the JOB, so every question after this one can read it.
                */}
              {/**
                * **THE ROOM LIST, PASTED RATHER THAN TYPED** (X8). The
                * founder wanted the rooms gathered with the measurements:
                * *"identify the rooms on every floor... then the estimate
                * questions can start asking questions like what type of
                * flooring in Master bedroom."* Fifteen forms is why a
                * feature like this goes unused, so the whole list arrives
                * at once and the areas come after.
                */}
              {(view.measuring.askingRooms || view.measuring.rooms.length > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <RoomsDialog
                    projectId={projectId}
                    rooms={view.measuring.rooms}
                    onChanged={(rooms) =>
                      setView((was) => ({ ...was, measuring: { ...was.measuring, rooms } }))
                    }
                  />
                  {view.measuring.askingRooms && (
                    <span className="text-xs text-muted-foreground">
                      or paste them straight into the box above — one a line.
                    </span>
                  )}
                </div>
              )}

              {view.measuring.ask && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <MeasureOnADrawing
                    projectId={projectId}
                    measure={{
                      name: view.measuring.ask.name,
                      unit: view.measuring.ask.unit,
                      kind: view.measuring.ask.kind,
                    }}
                    onUse={async (valueThousandths, markupId, note, sheetId) => {
                      const result = await measureFromSheetAction({
                        interviewId: view.interviewId,
                        valueThousandths,
                        sheetId,
                        markupId: markupId ?? undefined,
                        note,
                      });
                      if ("error" in result) {
                        toast.error(result.error);
                        /** The view comes back even on a failure, so the
                         *  screen stays true — and the dialog stays open. */
                        if (result.view) setView(result.view);
                        throw new Error(result.error);
                      }
                      if (result.view) setView(result.view);
                      setEchoed(null);
                      refreshReckoning();
                      if (result.finished) {
                        toast.success("That is every question. See what is left below.");
                      }
                      router.refresh();
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    or type it — 248, 24 x 40 and 38&apos;-6&quot; all read.
                  </span>
                </div>
              )}

              {view.settled.length > 0 && !proposal && (
                <div className="mt-4 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={working || pending}
                    onClick={() =>
                      startTransition(async () => {
                        setWorking(true);
                        try {
                          const result = await proposeStepAction({
                            interviewId: view.interviewId,
                            projectId,
                            estimateId,
                          });
                          if ("error" in result) toast.error(result.error);
                          else setProposal({ lines: result.lines, excluded: result.excluded });
                        } catch {
                          toast.error("That did not get through. Try again.");
                        } finally {
                          setWorking(false);
                        }
                      })
                    }
                  >
                    <Receipt className="mr-1.5 size-4" />
                    {working ? "Working it out…" : "What does this come to?"}
                  </Button>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
                {view.pendingQuestionId && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          const result = await skipQuestionAction({
                            interviewId: view.interviewId,
                            questionId: view.pendingQuestionId!,
                            projectId,
                            estimateId,
                          });
                          if ("error" in result) toast.error(result.error);
                          else send("Skip that one.");
                        } catch {
                          toast.error("That did not get through. Try again.");
                        }
                      })
                    }
                  >
                    <SkipForward className="size-3.5" /> Come back to this
                  </button>
                )}
                <button
                  type="button"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const result = await closeWalkAction({
                          interviewId: view.interviewId,
                          status: "abandoned",
                          projectId,
                          estimateId,
                        });
                        if ("error" in result) toast.error(result.error);
                        else router.push(estimateHref);
                      } catch {
                        toast.error("That did not get through. Try again.");
                      }
                    })
                  }
                >
                  Stop the walk
                </button>
              </div>
            </>
          )}
        </Panel>

        <Panel className="p-5">
          <p className="text-sm font-medium">What you have said</p>
          {view.settled.length === 0 && !echoed ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing on this step yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {view.settled.map((s, i) => (
                <li key={i} className="border-t pt-3 first:border-t-0 first:pt-0">
                  <p className="text-xs text-muted-foreground">
                    {s.prompt}
                    {s.volunteered && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        it asked
                      </Badge>
                    )}
                  </p>
                  {s.skipped ? (
                    <p className="mt-0.5 text-sm italic text-muted-foreground">
                      passed — {s.skipReason}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm">{s.answer}</p>
                  )}
                </li>
              ))}
              {echoed && (
                <li className="border-t pt-3 opacity-70">
                  <p className="text-xs text-muted-foreground">{echoed.prompt}</p>
                  <p className="mt-0.5 text-sm">{echoed.answer}</p>
                </li>
              )}
            </ul>
          )}

          {view.outstanding.length > 0 && (
            <>
              <p className="mt-5 text-sm font-medium">Still to come on this step</p>
              <ul className="mt-2 space-y-1.5">
                {view.outstanding.map((q) => (
                  <li key={q.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3 opacity-30" />
                    <span>
                      {q.prompt}
                      {q.alwaysAsk && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          always ask
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/**
            * **THE BUILDING'S NUMBERS STAY ON THE SCREEN (X7).** Not because
            * a panel is nice, but because they are the thing every later
            * question reads: if the walk quotes 2,232 sf of wall at drywall,
            * the estimator has to be able to see where that came from
            * without scrolling back through forty answers.
            */}
          {view.measuring.taken.length > 0 && (
            <>
              <p className="mt-5 text-sm font-medium">The building</p>
              <ul className="mt-2 space-y-1.5">
                {view.measuring.taken.map((m) => (
                  <li
                    key={m.slug}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                  >
                    <span className="text-muted-foreground">{m.name}</span>
                    <span className="flex items-baseline gap-2">
                      <span className={m.passed ? "italic text-muted-foreground" : "font-medium"}>
                        {m.value}
                      </span>
                      {m.source === "measured" && (
                        <Ruler
                          className="size-3 shrink-0 self-center text-muted-foreground"
                          aria-label="off a drawing"
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-subtle-foreground">
                Every question from here on can use these.
              </p>
            </>
          )}

          {/**
            * **THE ROOMS STAY ON THE SCREEN TOO** (X8), for the reason the
            * measurements do: when the walk says *"LVP in the great room,
            * kitchen and dining — 1,010 sf"*, the estimator has to be able
            * to see which rooms that was and what each one measures without
            * scrolling back through forty answers.
            */}
          {view.measuring.rooms.length > 0 && (
            <>
              <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">The rooms</p>
                <span className="text-xs text-muted-foreground">
                  {view.measuring.rooms.length}
                  {roomsMeasured > 0 ? ` · ${formatQuantity(roomsMeasured)} sf` : ""}
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {view.measuring.rooms.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {r.name}
                      {r.level ? (
                        <span className="text-subtle-foreground"> · {r.level}</span>
                      ) : null}
                    </span>
                    <span
                      className={
                        r.areaThousandths === null
                          ? "italic text-subtle-foreground"
                          : "font-medium"
                      }
                    >
                      {r.areaThousandths === null
                        ? "no area"
                        : `${formatQuantity(r.areaThousandths)} ${r.areaUnit}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      {proposal && (
        <Panel className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              What {view.stepTitle || "this"} comes to
            </p>
            <p className="text-sm font-medium">
              {formatMoney(
                proposal.lines.reduce(
                  (n, l) => n + Math.round((l.quantityThousandths * l.unitCostCents) / 1000),
                  0,
                ),
                symbol,
              )}
            </p>
          </div>

          {proposal.lines.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing to price on this one.
            </p>
          ) : (
            <ul className="mt-3">
              {proposal.lines.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{l.description}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={
                          l.basis === "none"
                            ? "rounded-full bg-warning/15 px-2 py-0.5 text-warning-foreground"
                            : "rounded-full bg-muted px-2 py-0.5"
                        }
                      >
                        {basisLabel(l.basis as LineBasis)}
                      </span>
                      {/* The chip already says it when there is nothing to add. */}
                      {l.basisDetail && l.basisDetail !== basisLabel(l.basis as LineBasis) && (
                        <span>{l.basisDetail}</span>
                      )}
                      {l.quantityBasis === "derived" && l.quantityNote && (
                        <span className="italic">{l.quantityNote}</span>
                      )}
                    </p>
                  </div>
                  <p className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatQuantity(l.quantityThousandths)}
                    {l.unit ? ` ${l.unit}` : ""} × {formatMoney(l.unitCostCents, symbol)}
                  </p>
                  <p className="w-24 whitespace-nowrap text-right text-sm">
                    {formatMoney(
                      Math.round((l.quantityThousandths * l.unitCostCents) / 1000),
                      symbol,
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {proposal.excluded && (
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              For the exclusions: {proposal.excluded}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3">
            <Button
              disabled={pending || proposal.lines.length === 0}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = await applyStepAction({
                      interviewId: view.interviewId,
                      projectId,
                      estimateId,
                    });
                    if ("error" in result) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success(`${result.groupName} is on the estimate.`);
                    setProposal(null);
                    refreshReckoning();
                  } catch {
                    toast.error("That did not get through. Try again.");
                  }
                })
              }
            >
              Put it on the estimate
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setProposal(null)}>
              Not yet
            </Button>
            <p className="text-xs text-muted-foreground">
              Nothing is written until you press it.
            </p>
          </div>
        </Panel>
      )}

      <WalkReckoning
        reckoning={reck}
        symbol={symbol}
        onOpen={(id) => setOpenStepId((was) => (was === id ? null : id))}
      />
    </div>
  );
}
