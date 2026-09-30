"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy, Info, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { localDayOf } from "../core/check-doc";
import {
  chronological,
  compare,
  noiseFor,
  previousOf,
  summarize,
  type CheckSummary,
  type Comparison,
  type Noise,
} from "../core/history";
import type { ViewCapture } from "../core/measures";
import { buildReport, detailsText, linesOf, noiseWords, reportText, VERTICAL_WORDS, type MeasureResult } from "../core/report";
import { stickersIn, VIEWS, type View } from "../core/sticker-map";
import { deleteEverywhere } from "../store/sync";
import { CheckPhotos } from "./check-photos";
import { ReportFigure } from "./report-figure";

/**
 * A POSTURE CHECK'S REPORT (docs/help/fitness/posture-report.md; ADR 0119):
 * each view drawn from its points, then every measure in plain words with its
 * own noise, reliable ones first, then what could not be measured and why.
 * Rebuilt from the check's numbers each time it opens (`buildReport`), so a
 * fix to the arithmetic reaches old checks too.
 *
 * With earlier checks (slice 3), each measure also says how it changed since
 * the one chosen under "Compared with", and whether that change is more than
 * the noise: the published figure, or the person's own once it is bigger.
 *
 * Never a verdict: no normal, no condition, no score. It says how the person
 * stood that day.
 */

export type ReportCheck = {
  id: string;
  at: string;
  captures: ViewCapture[];
  notes: string[];
  keepPhotos: boolean;
};

const VIEW_LABEL: Record<View, string> = { front: "Front", right: "Right side", back: "Back", left: "Left side" };

function viewsWords(views: View[]): string {
  const names = views.map((v) => VIEW_LABEL[v].toLowerCase());
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function dayWords(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function PostureReport({
  check,
  owner,
  backHref,
  history,
  canDelete,
}: {
  check: ReportCheck;
  owner: string;
  backHref: string;
  /** Every check in the account, summarized; this one is added when it is not there yet. */
  history: CheckSummary[];
  /** Kept somewhere (the account, this phone), so there is something to delete. */
  canDelete: boolean;
}) {
  const router = useRouter();
  const report = useMemo(() => buildReport(check.captures), [check.captures]);
  const [copied, setCopied] = useState(false);
  // Whether this phone kept photos can be learned after the report opens (it
  // reads the phone's storage), so it is followed, not copied into state.
  const [photosDeleted, setPhotosDeleted] = useState(false);
  const hasPhotos = check.keepPhotos && !photosDeleted;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const when = new Date(check.at);

  const all = useMemo(() => {
    if (history.some((c) => c.id === check.id)) return history;
    const takenAt = new Date(check.at).toISOString();
    return [...history, summarize({ id: check.id, takenAt, localDay: localDayOf(new Date(check.at)), captures: check.captures })];
  }, [history, check]);
  const self = all.find((c) => c.id === check.id)!;
  // Only checks taken before this one: a change is always later minus earlier. Newest first.
  const earlier = useMemo(() => chronological(all).filter((c) => c.takenAt < self.takenAt).reverse(), [all, self.takenAt]);
  const [compareId, setCompareId] = useState<string | null>(() => previousOf(check.id, all)?.id ?? null);
  const other = earlier.find((c) => c.id === compareId) ?? null;
  const first = earlier[earlier.length - 1] ?? null;
  const before = earlier[0] ?? null;

  const reliable = report.measures.filter((m) => m.tier === "reliable");
  const trend = report.measures.filter((m) => m.tier === "trend");
  // The first round's hold of each view, or the second's when the first was skipped.
  const figures = VIEWS.flatMap((view) => {
    const capture = check.captures.filter((c) => c.view === view).sort((a, b) => a.round - b.round)[0];
    return capture ? [{ view, capture, lines: linesOf(report, view, capture.round) }] : [];
  });

  async function copy() {
    const text = [reportText(report, when, check.notes), "", detailsText(check.captures, (v) => stickersIn(v).map((s) => s.id))].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const outcome = await deleteEverywhere(owner, check.id);
      if ("error" in outcome) {
        setDeleteError(outcome.error);
        return;
      }
      router.push(backHref);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  const row = (m: MeasureResult) => (
    <MeasureRow
      key={m.key}
      m={m}
      noise={noiseFor(m.key, all)}
      comparison={other ? compare(m.key, self, other, all) : null}
      otherDay={other ? dayWords(other.takenAt) : null}
    />
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="font-medium">
          {when.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
        <p className="text-sm text-muted-foreground">
          {report.views.length === 4 ? "All four views" : `${report.views.length} of 4 views`}, {report.rounds}{" "}
          {report.rounds === 1 ? "round" : "rounds"}. Vertical from {VERTICAL_WORDS[report.vertical]}
          {report.scale ? ", millimeters from its tape marks." : "."}
        </p>
      </div>

      {report.vertical !== "plumb" && (
        <div className="flex gap-2 rounded-xl bg-warning/15 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
          <span>
            Without the plumb line, the angles against level can be off by about a degree, the size of what is being
            measured. Hang it where the camera sees it next time.
          </span>
        </div>
      )}

      {earlier.length > 0 ? (
        <section className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1" aria-label="Compared with">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Compared with</span>
            <select
              className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={compareId ?? ""}
              onChange={(e) => setCompareId(e.target.value || null)}
            >
              <option value="">No comparison</option>
              {earlier.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === first?.id ? "Your first check, " : c.id === before?.id ? "The check before, " : ""}
                  {new Date(c.takenAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            A change is called real only when it is bigger than the measure&apos;s noise: the published figure, or your
            own once your checks show it is bigger.
          </p>
        </section>
      ) : (
        all.length === 1 && (
          <p className="text-sm text-muted-foreground">
            This is your first check. Your next checks are compared with it, a measure at a time.
          </p>
        )
      )}

      {figures.length > 0 && (
        <section className="space-y-2" aria-label="The views">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {figures.map((f) => (
              <ReportFigure key={f.view} capture={f.capture} lines={f.lines} label={VIEW_LABEL[f.view]} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            As the camera saw you, straightened to true vertical (the dashed line). The colored lines are what each
            measure was taken along; the dots are your stickers where the check found them.
          </p>
        </section>
      )}

      {reliable.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Measured reliably</h2>
          <p className="text-sm text-muted-foreground">
            Each has a smallest real change: a difference between two checks bigger than that is more than measuring noise.
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">{reliable.map(row)}</ul>
        </section>
      )}

      {trend.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Trend only</h2>
          <p className="text-sm text-muted-foreground">
            Too dependent on where a sticker went, or on bone shape, to read as a value. Compare them only with your own
            earlier checks.
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">{trend.map(row)}</ul>
        </section>
      )}

      {report.missing.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Not measured this time</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
            {report.missing.map((x) => (
              <li key={x.key} className="space-y-0.5 px-4 py-3">
                <div className="text-sm font-medium">{x.name}</div>
                <p className="text-sm text-muted-foreground">{x.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {check.notes.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Along the way</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {check.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      {hasPhotos && (
        <CheckPhotos owner={owner} checkId={check.id} captures={check.captures} report={report} onDeleted={() => setPhotosDeleted(true)} />
      )}

      <div className="flex gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          This describes how you stood during this check, for fitness and body awareness. It is not a medical assessment.
          Most people are a little uneven, and how you stand says little on its own about pain.
        </span>
      </div>

      {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>
          <Copy aria-hidden /> {copied ? "Copied" : "Copy the numbers"}
        </Button>
        <Button asChild variant="outline">
          <Link href={backHref}>Back to the posture check</Link>
        </Button>
        {canDelete && (
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogTrigger asChild>
              <Button variant="ghost" className="text-destructive">
                <Trash2 aria-hidden /> Delete this check
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this check?</DialogTitle>
                <DialogDescription>
                  Its numbers go from your account and from this phone{hasPhotos ? ", and its photos with them" : ""}. This
                  cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
                <Button variant="destructive" onClick={() => void remove()} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete this check"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}

function amount(value: number, unit: "deg" | "mm"): string {
  return unit === "mm" ? `${Math.round(Math.abs(value))} mm` : `${Math.abs(value).toFixed(1)}°`;
}

function MeasureRow({
  m,
  noise,
  comparison,
  otherDay,
}: {
  m: MeasureResult;
  noise: Noise;
  comparison: Comparison | null;
  otherDay: string | null;
}) {
  return (
    <li className="space-y-1 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{m.name}</span>
        <Badge variant={m.tier === "reliable" ? "secondary" : "outline"}>{m.tier === "reliable" ? "Reliable" : "Trend only"}</Badge>
      </div>
      <p className="text-lg leading-snug">{m.words}</p>
      {comparison && otherDay && (
        <div className="space-y-0.5">
          <span
            className={cn(
              "inline-block rounded-md px-1.5 py-0.5 text-xs",
              comparison.beyond ? "bg-module-accent/10 text-module-accent" : "bg-muted text-muted-foreground",
            )}
          >
            {comparison.beyond ? `${comparison.words} since ${otherDay}` : `Within your noise since ${otherDay}`}
          </span>
          <p className="text-sm text-muted-foreground">
            Was: {comparison.then.words}.{" "}
            {comparison.beyond
              ? `More than the ${amount(comparison.noise.used, comparison.now.unit)} a real change needs.`
              : comparison.words === "No change"
                ? "No change."
                : `${comparison.words}: less than the ${amount(comparison.noise.used, comparison.now.unit)} a real change needs.`}
          </p>
        </div>
      )}
      <p className={cn("text-sm", m.unsteady ? "text-warning-foreground" : "text-muted-foreground")}>
        {noiseWords(m, { value: noise.used, yours: noise.from === "yours" })}
      </p>
      {m.context && <p className="text-sm text-muted-foreground">{m.context}</p>}
      <p className="text-xs text-muted-foreground">
        From the {viewsWords(m.views)}
        {m.from === "stickers" ? ", by your stickers." : m.from === "model" ? ", by the pose model's points (no sticker)." : ", partly by the pose model's points."}
      </p>
    </li>
  );
}
