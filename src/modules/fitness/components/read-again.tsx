"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, FileText, Loader2, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readAgainAction } from "../actions";
import { draftTextProblem } from "../core/draft";
import { countOf, type ProgramInput } from "../core/program";
import { READ_AGAIN_WORDS, type AdditionsFound } from "../core/read-again";
import { ProgramEditor } from "./program-editor";
import { readProgramPdf, TooManyPagesError } from "./read-program-pdf";

type Step =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "asking"; pages: number; pictures: number; since: number }
  | { kind: "failed"; message: string }
  | { kind: "read"; fileName: string; program: ProgramInput; version: number; found: AdditionsFound };

/**
 * READ THE PDF AGAIN (docs/help/fitness/program.md; F4b, core/read-again.ts):
 * the program's PDF read in the browser as the import reads it, words, links
 * and a picture of a page whose table is an image, and Claude asked for what
 * the app does not have yet: the side self-assessment and the exercises done
 * on one side. What it finds is merged into the program and opened in the
 * editor, where nothing is saved until Save program.
 */
export function ReadAgain({ programId, sessions }: { programId: string; sessions: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());

  // A clock for "about a minute", ticking only while Claude reads.
  useEffect(() => {
    if (step.kind !== "asking") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step.kind]);

  async function start(chosen: File) {
    setStep({ kind: "reading", done: 0, total: 0 });
    let read;
    try {
      read = await readProgramPdf(chosen, (done, total) => setStep({ kind: "reading", done, total }));
    } catch (err) {
      setStep({
        kind: "failed",
        message:
          err instanceof TooManyPagesError
            ? `This PDF has ${err.pageCount} pages. That reads like a book rather than a program, so it cannot be read in one go.`
            : "This file could not be read as a PDF. Check it opens on your device, then choose it again.",
      });
      return;
    }
    const request = { fileName: chosen.name, pageCount: read.pageCount, pages: read.pages, pictures: read.pictures };
    const problem = draftTextProblem(request);
    if (problem) {
      setStep({ kind: "failed", message: READ_AGAIN_WORDS[problem] });
      return;
    }
    const since = Date.now();
    setNow(since);
    setStep({ kind: "asking", pages: read.pageCount, pictures: read.pictures.length, since });
    let outcome;
    try {
      outcome = await readAgainAction({ programId, request });
    } catch {
      setStep({
        kind: "failed",
        message: "The connection was lost while reading. Nothing was changed. Choose the PDF again to try again.",
      });
      return;
    }
    if ("error" in outcome) {
      setStep({ kind: "failed", message: outcome.error });
      return;
    }
    setStep({ kind: "read", fileName: chosen.name, program: outcome.program, version: outcome.version, found: outcome.found });
  }

  const busy = step.kind === "reading" || step.kind === "asking";
  const seconds = step.kind === "asking" ? Math.max(0, Math.floor((now - step.since) / 1000)) : 0;

  if (step.kind === "read") {
    const { found } = step;
    const nothing = found.tests === 0 && found.sideRules === 0;
    return (
      <div className="space-y-6">
        <div className="space-y-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <FileText className="size-4 text-module-accent" aria-hidden />
            {`Read from ${step.fileName}`}
          </p>
          {nothing ? (
            <p>Nothing new was found: no self-assessment, and no exercise done on one side.</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-5">
              {found.tests > 0 && <li>{`A side self-assessment, with ${countOf(found.tests, "test", "tests")}.`}</li>}
              {found.sideRules > 0 && (
                <li>{`${countOf(found.sideRules, "exercise", "exercises")} done on one side, for someone who leans to a side.`}</li>
              )}
            </ul>
          )}
          {found.unmatched.length > 0 && (
            <p className="flex items-start gap-1.5 text-warning-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {`The PDF also names ${found.unmatched.join(", ")} as done on one side, which this program has no exercise to match. Set it by hand below if it is one of yours.`}
            </p>
          )}
          {!nothing && (
            <p className="text-muted-foreground">
              Check them below: the self-assessment comes before the phases, and a one-sided exercise shows its side
              when you open it. Nothing is saved until you press Save program. Your workouts stay with the program.
            </p>
          )}
        </div>
        <ProgramEditor
          initial={step.program}
          mode={{ kind: "edit", programId, version: step.version, sessions }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Choose the program PDF"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen) void start(chosen);
        }}
      />

      {step.kind === "idle" && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center hover:bg-muted/50"
        >
          <FileText className="size-8 text-module-accent" aria-hidden />
          <span className="font-medium">Choose the program&apos;s PDF</span>
          <span className="text-sm text-muted-foreground">The one this program was imported from.</span>
        </button>
      )}

      {step.kind === "reading" && (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-module-accent" aria-hidden />
          {step.total > 0 ? `Reading page ${step.done} of ${step.total}…` : "Opening the PDF…"}
        </p>
      )}

      {step.kind === "asking" && (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2">
            <CircleCheck className="size-4 text-success" aria-hidden />
            {`Read ${countOf(step.pages, "page", "pages")}${step.pictures > 0 ? `, and ${countOf(step.pictures, "page", "pages")} as a picture` : ""}`}
          </p>
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-module-accent" aria-hidden />
            {`Finding the self-assessment and the one-sided exercises… about a minute (${seconds}s)`}
          </p>
          <p className="text-muted-foreground">Stay on this page: what it finds opens here, to check.</p>
        </div>
      )}

      {step.kind === "failed" && (
        <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {step.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            Choose the PDF again
          </Button>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        The file stays on your device. Only its words and links are sent, with a picture of any page that shows a table
        as an image.
      </p>

      <Button asChild variant="ghost" disabled={busy}>
        <Link href={`/personal/m/fitness/programs/${programId}`}>Back to the program</Link>
      </Button>
    </div>
  );
}
