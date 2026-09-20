"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CornerDownLeft, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/panel";
import type { WalkView } from "../walk-ops";
import {
  closeWalkAction,
  skipQuestionAction,
  takeWalkTurnAction,
} from "../walk-actions";

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
  projectId,
  estimateId,
  estimateHref,
}: {
  initial: WalkView;
  projectId: string;
  estimateId: string;
  estimateHref: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<WalkView>(initial);
  const [said, setSaid] = useState("");
  /** The last thing sent, so a failed turn can be retried without retyping. */
  const [lastSaid, setLastSaid] = useState("");
  const [failed, setFailed] = useState(false);
  /** What was just said, shown at once while the turn runs. */
  const [echoed, setEchoed] = useState<{ prompt: string; answer: string } | null>(null);
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
        if (result.view) setView(result.view);
        if (result.finished) {
          toast.success("That is the whole walk.");
          router.push(estimateHref);
          return;
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
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: Math.max(view.progress.steps, 1) }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < view.progress.covered
                  ? "bg-primary"
                  : i === view.progress.covered
                    ? "bg-primary/40"
                    : "bg-border"
              }`}
            />
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          {done ? (
            <div className="space-y-3">
              <p className="text-sm">That is the whole walk.</p>
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
    </div>
  );
}
