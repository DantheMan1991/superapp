"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveSideAction } from "../actions";
import { countOf, type SideMeans, type SideRule } from "../core/program";
import { assessedSide, FURTHER_CHOICES, sideFor, sideWords, testPoints, type Further, type Lean } from "../core/side";
import { VideoPlayer } from "./video-player";

const ANSWER_LABELS: Record<Further, string> = { left: "Left", same: "About the same", right: "Right" };
const ANSWER_WORDS: Record<Further, string> = {
  left: "Left went further",
  same: "About the same",
  right: "Right went further",
};

function capital(side: Lean): string {
  return side === "left" ? "Left" : "Right";
}

/**
 * TAKE THE TESTS (docs/help/fitness/side.md; F4b part 2, approved from a
 * mockup): the author's video first, then one test at a time, each answered
 * with which side went further, then the result, with what each answer points
 * to and what changes. The table is the app's to apply (`leftMeans`), so a
 * reversed test needs no thought. Save sends the answers only; the server
 * works the side out again from the program's own tests.
 */
export function SideTests({
  programId,
  tests,
  least,
  video,
  notes,
  oneSided,
  previous,
}: {
  programId: string;
  tests: { name: string; question: string; leftMeans: Lean }[];
  least: number;
  video: { id: string; startS: number | null; endS: number | null; embeddable: boolean | null } | null;
  /** What the program says about the result. */
  notes: string;
  /** The program's one-sided exercises, with their phase's number. */
  oneSided: { id: string; phase: number; name: string; rule: SideRule; means: SideMeans }[];
  /** The last time the tests were taken: "Taken Sep 29: left". */
  previous: string | null;
}) {
  const router = useRouter();
  const count = tests.length;
  // -1 is the video; 0 to count - 1 a test; count the result.
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState<(Further | null)[]>(() => tests.map(() => null));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const firstOpen = answers.findIndex((a) => a === null);

  function answer(further: Further) {
    setAnswers((prev) => prev.map((a, i) => (i === step ? further : a)));
    setError(null);
    setStep(step + 1);
  }

  function redo() {
    setAnswers(tests.map(() => null));
    setError(null);
    setStep(0);
  }

  function save() {
    if (answers.some((a) => a === null)) {
      setError("Answer every test first.");
      return;
    }
    startSaving(async () => {
      const outcome = await saveSideAction({ programId, answers });
      if ("error" in outcome) {
        setError(outcome.error);
        return;
      }
      toast.success(
        outcome.side
          ? `Your side is saved: ${outcome.side}.`
          : "Saved. No side is clear, so every exercise stays on both sides.",
      );
      router.push(`/personal/m/fitness/programs/${programId}`);
    });
  }

  if (step < 0) {
    const started = firstOpen !== 0;
    return (
      <div className="space-y-4">
        {video && (
          <div className="overflow-hidden rounded-2xl">
            <VideoPlayer
              videoId={video.id}
              startS={video.startS}
              endS={video.endS}
              embeddable={video.embeddable}
              title="The self-assessment's tests"
            />
          </div>
        )}
        <p>
          {`Watch how each test is done. Then do each one, and say which side went further. The app works out what it means.`}
        </p>
        {notes && <p className="text-sm text-muted-foreground">{notes}</p>}
        {previous && <p className="text-sm text-muted-foreground">{previous}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setStep(firstOpen === -1 ? count : firstOpen)}>
            {started ? "Back to the tests" : "Start the tests"}
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/personal/m/fitness/programs/${programId}`}>Back to the program</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (step < count) {
    const test = tests[step];
    return (
      <div className="space-y-4">
        <div className="flex gap-1" aria-hidden>
          {tests.map((t, i) => (
            <span
              key={`${t.name}-${i}`}
              className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-module-accent" : "bg-muted")}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{`Test ${step + 1} of ${count}`}</p>
        <h2 className="font-heading text-xl font-medium">{test.name}</h2>
        <p>{test.question}</p>
        <div role="group" aria-label="Which side went further" className="grid grid-cols-3 gap-2">
          {FURTHER_CHOICES.map((choice) => (
            <Button
              key={choice}
              variant={answers[step] === choice ? "default" : "outline"}
              className="h-14 whitespace-normal"
              aria-pressed={answers[step] === choice}
              onClick={() => answer(choice)}
            >
              {ANSWER_LABELS[choice]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          {video && (
            <Button variant="ghost" onClick={() => setStep(-1)}>
              <Play aria-hidden /> Watch the video again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const result = assessedSide(tests, answers, least);
  const lean = result.side;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Your result</p>
        <h2 className="font-heading text-2xl font-medium">{lean ? `You lean ${lean}` : "No clear side"}</h2>
        <p className="text-sm text-muted-foreground">
          {`${result.left} point left, ${result.right} point right. The program needs ${least} to agree.`}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-2xl bg-card px-4 text-sm shadow-elevation-1">
        {tests.map((test, i) => {
          const given = answers[i];
          const points = given ? testPoints(test, given) : null;
          return (
            <li key={`${test.name}-${i}`} className="flex flex-wrap justify-between gap-x-3 py-2">
              <span>{test.name}</span>
              <span className="text-muted-foreground">
                {given ? ANSWER_WORDS[given] : "Not answered"}
                {" → "}
                <span className={cn(points && "text-module-accent")}>{points ? capital(points) : "no side"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {lean ? (
        oneSided.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">What changes</p>
            <ul className="divide-y divide-border">
              {oneSided.map((o) => {
                const side = sideFor(o.rule, lean);
                return (
                  <li key={o.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                    <span>{`Phase ${o.phase} · ${o.name}`}</span>
                    {side && <span className="text-module-accent">{sideWords(o.means, side)}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : (
        <p className="text-sm">
          {`Every exercise stays on both sides. You can take the tests again any time.`}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {lean ? "Save my side" : "Save the result"}
        </Button>
        <Button variant="ghost" onClick={redo} disabled={saving}>
          Redo
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {`${countOf(count, "test", "tests")} answered. Saving replaces any side saved before.`}
      </p>
    </div>
  );
}
