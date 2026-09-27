"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, FileText, Loader2, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftProgramAction } from "../actions";
import { draftTextProblem } from "../core/draft";
import { FitnessError, fitnessMessage } from "../core/errors";
import { countOf } from "../core/program";
import { readProgramPdf, TooManyPagesError } from "./read-program-pdf";

/**
 * IMPORT A PROGRAM: choose the PDF, it is read here, the words and links go to
 * be drafted, and the review opens. Drafting takes about a minute, so the
 * screen says so and counts; closing the tab does not lose it — the import is
 * already a row, and it waits under Drafts on the Workouts page.
 */

type Step =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "drafting"; pages: number; links: number; since: number }
  | { kind: "failed"; message: string; pages: number | null; links: number | null };

const HOME = "/personal/m/fitness";

function fileSize(bytes: number): string {
  if (bytes < 100 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());

  // A clock for "about a minute", ticking only while drafting.
  useEffect(() => {
    if (step.kind !== "drafting") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step.kind]);

  async function start(chosen: File) {
    setFile(chosen);
    setStep({ kind: "reading", done: 0, total: 0 });
    let read;
    try {
      read = await readProgramPdf(chosen, (done, total) =>
        setStep({ kind: "reading", done, total }),
      );
    } catch (err) {
      setStep({
        kind: "failed",
        message:
          err instanceof TooManyPagesError
            ? `This PDF has ${err.pageCount} pages. That reads like a book rather than a program, so it cannot be drafted in one go. Build the program by hand instead.`
            : "This file could not be read as a PDF. Check it opens on your device, then choose it again.",
        pages: null,
        links: null,
      });
      return;
    }
    const request = { fileName: chosen.name, pageCount: read.pageCount, pages: read.pages };
    // A scan or a book is refused HERE, before a word is sent (ADR 0112). The
    // server asks the same question again.
    const problem = draftTextProblem(request);
    if (problem) {
      setStep({
        kind: "failed",
        message: fitnessMessage(new FitnessError(problem)),
        pages: read.pageCount,
        links: read.linkCount,
      });
      return;
    }
    const since = Date.now();
    setNow(since);
    setStep({ kind: "drafting", pages: read.pageCount, links: read.linkCount, since });
    let outcome;
    try {
      outcome = await draftProgramAction(request);
    } catch {
      // The request itself failed: the connection dropped, or the page gave
      // up waiting. The server may well still be drafting, and the import is
      // already a row, so the Workouts page is where it will turn up.
      setStep({
        kind: "failed",
        message:
          "The connection was lost while drafting. The draft may still arrive under Drafts on the Workouts page, so look there in a minute before trying again.",
        pages: read.pageCount,
        links: read.linkCount,
      });
      return;
    }
    if ("error" in outcome) {
      setStep({ kind: "failed", message: outcome.error, pages: read.pageCount, links: read.linkCount });
      return;
    }
    router.push(`${HOME}/import/${outcome.importId}`);
  }

  const busy = step.kind === "reading" || step.kind === "drafting";
  const seconds = step.kind === "drafting" ? Math.max(0, Math.floor((now - step.since) / 1000)) : 0;

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

      {file === null ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center hover:bg-muted/50"
        >
          <FileText className="size-8 text-module-accent" aria-hidden />
          <span className="font-medium">Choose the program PDF</span>
          <span className="text-sm text-muted-foreground">The one you were given, as a file on this device.</span>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <FileText className="size-6 shrink-0 text-module-accent" aria-hidden />
          <div className="min-w-0">
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-sm text-muted-foreground">
              {fileSize(file.size)}
              {(step.kind === "drafting" || step.kind === "failed") && step.pages ? (
                <> · {countOf(step.pages, "page", "pages")}</>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {step.kind === "reading" && (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-module-accent" aria-hidden />
          {step.total > 0 ? `Reading page ${step.done} of ${step.total}…` : "Opening the PDF…"}
        </p>
      )}

      {step.kind === "drafting" && (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2">
            <CircleCheck className="size-4 text-success" aria-hidden />
            Read {countOf(step.pages, "page", "pages")} and {countOf(step.links, "link", "links")}
          </p>
          <p className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-module-accent" aria-hidden />
            Drafting your program… about a minute ({seconds}s)
          </p>
          <p className="text-muted-foreground">
            You can leave this page. The draft will wait under Drafts on the Workouts page.
          </p>
        </div>
      )}

      {step.kind === "failed" && (
        <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {step.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            Choose another file
          </Button>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        The file stays on your device. Only its words and links are sent, to draft the program.
      </p>

      <div className="flex flex-wrap gap-2">
        {file !== null && !busy && step.kind !== "failed" && (
          <Button variant="outline" onClick={() => input.current?.click()}>
            Choose another file
          </Button>
        )}
        <Button asChild variant="ghost" disabled={busy}>
          <Link href={`${HOME}/new`}>Or build one by hand</Link>
        </Button>
      </div>
    </div>
  );
}
