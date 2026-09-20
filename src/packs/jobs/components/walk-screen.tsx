"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CornerDownLeft, Receipt, SkipForward } from "lucide-react";
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
  proposeStepAction,
  reckonWalkAction,
  skipQuestionAction,
  takeWalkTurnAction,
} from "../walk-actions";
import type { Reckoning } from "../walk-reckoning";
import { StepCard, WalkRail, WalkReckoning } from "./walk-reckoning-panel";

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

  function goTo(stepId: string) {
    moved(
      () => goToStepAction({ interviewId: view.interviewId, stepId, projectId, estimateId }),
      "Back on that one.",
    );
  }

  function askAgain(questionId: string) {
    moved(
      () => askAgainAction({ interviewId: view.interviewId, questionId, projectId, estimateId }),
      "Asking that one again.",
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
          projectId,
          estimateId,
        });
        if ("error" in result) {
          toast.error(result.error);
          setFailed(true);
          return;
        }
        setFailed(false);
        setEchoed(null);
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

  const done = view.status !== "running";

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {view.stepSection && (
              <p className="text-xs uppercase tracking-wide text-subtle-foreground">
                {view.stepSection}
              </p>
            )}
            <p className="text-sm font-medium">
              {view.stepTitle || "Finished"}
              {view.stepCount > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  step {view.stepNumber} of {view.stepCount}
                </span>
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
              <p className="text-sm">
                That is every question in {view.outlineName}.
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
