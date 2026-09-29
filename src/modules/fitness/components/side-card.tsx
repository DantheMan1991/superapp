import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countOf } from "../core/program";
import { phasesWords, savedCounts, sideFor, sideWords } from "../core/side";
import type { LoadedProgram } from "../program-ops";
import type { SavedSide } from "../side-ops";

/**
 * YOUR SIDE (docs/help/fitness/program.md; F4b part 2, approved from a
 * mockup): on the program page of a program with a side self-assessment,
 * under Reminders. Before the tests, what they are for and the way in; after,
 * the side they found and what each one-sided exercise does because of it,
 * and the way to take them again, which is the only way to change it.
 */
export function SideCard({
  program,
  saved,
  timeZone,
}: {
  program: LoadedProgram;
  saved: SavedSide | null;
  timeZone: string;
}) {
  const assessment = program.assessment;
  if (!assessment || assessment.tests.length === 0) return null;
  const href = `/personal/m/fitness/programs/${program.id}/side`;
  const oneSided = program.phases.flatMap((phase, p) =>
    phase.items
      .filter((item) => item.perSide && item.sideRule !== "both")
      .map((item) => ({ id: item.id, phase: p + 1, name: item.exercise.name, rule: item.sideRule, means: item.sideMeans })),
  );
  const tests = countOf(assessment.tests.length, "quick test", "quick tests");

  if (!saved) {
    return (
      <section aria-label="Your side" className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <h2 className="flex items-center gap-2 font-medium">
          <ArrowLeftRight className="size-4 text-module-accent" aria-hidden /> Your side
        </h2>
        <p className="text-sm text-muted-foreground">
          {`This program has ${tests} that find which side you lean to. Until you take them, you do every exercise on both sides.`}
        </p>
        {oneSided.length > 0 && (
          <p className="text-sm">
            {`${countOf(oneSided.length, "exercise", "exercises")} in ${phasesWords(oneSided.map((o) => o.phase))} ${oneSided.length === 1 ? "changes" : "change"} once your side is known.`}
          </p>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={href}>Take the tests</Link>
        </Button>
      </section>
    );
  }

  const counts = savedCounts(assessment.tests, saved.answers, assessment.least);
  const taken = saved.assessedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  const lean = saved.side;
  return (
    <section aria-label="Your side" className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <ArrowLeftRight className="size-4 text-module-accent" aria-hidden />
        {lean ? `Your side: ${lean === "left" ? "Left" : "Right"}` : "Your side: none clear"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {lean
          ? counts
            ? `${counts[lean]} of ${assessment.tests.length} tests point ${lean}. Taken ${taken}.`
            : `Taken ${taken}.`
          : `No side reached ${assessment.least} of the ${assessment.tests.length} tests, so you do every exercise on both sides. Taken ${taken}.`}
      </p>
      {lean && oneSided.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {oneSided.map((o) => {
            const side = sideFor(o.rule, lean);
            return (
              <li key={o.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span>{`Phase ${o.phase} · ${o.name}`}</span>
                {side && <span className="text-module-accent">{sideWords(o.means, side)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <Button asChild variant="outline" size="sm">
        <Link href={href}>Redo the tests</Link>
      </Button>
    </section>
  );
}
