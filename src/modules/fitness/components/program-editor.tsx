"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveProgramAction } from "../actions";
import {
  emptyEditorVideo,
  fromEditor,
  readEditorVideo,
  toEditor,
  toEditorItem,
  toEditorPhase,
  type EditorItem,
  type EditorPhase,
  type EditorProgram,
  type EditorVideo,
} from "../core/editor";
import {
  FITNESS_UNITS,
  UNIT_WORDS,
  emptyItem,
  emptyPhase,
  prescription,
  type FitnessUnitValue,
  type ProgramInput,
} from "../core/program";
import { DiscardImportButton } from "./discard-import-button";
import { DeleteProgramButton } from "./delete-program-button";

/**
 * THE PROGRAM EDITOR — one screen for three jobs (docs/help/fitness/editor.md):
 *
 * - reviewing a draft Claude made from a PDF (`import`), where nothing is
 *   saved until Save;
 * - building a program by hand (`new`), the same screen started empty;
 * - editing a saved program (`edit`), which keeps every row's id so the logs
 *   workout mode will write survive a fixed typo.
 *
 * The form holds text where people type text (`core/editor.ts`), and
 * `fromEditor` turns it into a program or a list of what to fix — the same
 * rules the server runs again before it writes.
 */

export type EditorMode =
  | { kind: "import"; importId: string }
  | { kind: "new" }
  | { kind: "edit"; programId: string; version: number };

const HOME = "/personal/m/fitness";

function swap<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function ProgramEditor({ initial, mode }: { initial: ProgramInput; mode: EditorMode }) {
  const router = useRouter();
  const [program, setProgram] = useState<EditorProgram>(() => toEditor(initial));
  // A new program opens on its first exercise; a draft or an edit opens folded.
  const [openItem, setOpenItem] = useState<string | null>(() =>
    mode.kind === "new" ? (program.phases[0]?.items[0]?.key ?? null) : null,
  );
  const [showProblems, setShowProblems] = useState(false);
  const [pending, startTransition] = useTransition();
  const checked = useMemo(() => fromEditor(program), [program]);

  const patch = (next: Partial<EditorProgram>) => setProgram((p) => ({ ...p, ...next }));
  const patchPhase = (key: string, next: Partial<EditorPhase>) =>
    setProgram((p) => ({
      ...p,
      phases: p.phases.map((phase) => (phase.key === key ? { ...phase, ...next } : phase)),
    }));
  const patchItem = (phaseKey: string, itemKey: string, next: Partial<EditorItem>) =>
    setProgram((p) => ({
      ...p,
      phases: p.phases.map((phase) =>
        phase.key !== phaseKey
          ? phase
          : {
              ...phase,
              items: phase.items.map((item) => (item.key === itemKey ? { ...item, ...next } : item)),
            },
      ),
    }));

  function save() {
    if (checked.program === null) {
      setShowProblems(true);
      toast.error(checked.problems[0]);
      return;
    }
    const program = checked.program;
    startTransition(async () => {
      const outcome = await saveProgramAction({
        program,
        programId: mode.kind === "edit" ? mode.programId : null,
        version: mode.kind === "edit" ? mode.version : null,
        importId: mode.kind === "import" ? mode.importId : null,
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success(mode.kind === "edit" ? "Program saved" : "Program saved. It is ready to follow.");
      router.push(`${HOME}/programs/${outcome.programId}`);
      router.refresh();
    });
  }

  const exerciseCount = program.phases.reduce((n, phase) => n + phase.items.length, 0);

  return (
    <div className="space-y-6 pb-24">
      {mode.kind === "import" && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Check it against the book. Nothing is saved until you press Save program.
        </p>
      )}

      <section className="space-y-4 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="program-name">Name</Label>
            <Input
              id="program-name"
              value={program.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Beginner mobility, 8 weeks"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-author">Written by</Label>
            <Input
              id="program-author"
              value={program.author}
              onChange={(e) => patch({ author: e.target.value })}
              placeholder="Who wrote it, if anybody"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="program-notes">How the program works</Label>
          <Textarea
            id="program-notes"
            rows={3}
            value={program.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="How often, how hard, how to breathe, when to move on."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RangeField
            label="Sessions a week"
            id="program-sessions"
            min={program.sessionsPerWeekMin}
            max={program.sessionsPerWeekMax}
            onChange={(min, max) => patch({ sessionsPerWeekMin: min, sessionsPerWeekMax: max })}
          />
          <RangeField
            label="Effort, out of 10"
            id="program-effort"
            min={program.effortMin}
            max={program.effortMax}
            onChange={(min, max) => patch({ effortMin: min, effortMax: max })}
          />
        </div>
      </section>

      <p className="text-sm text-muted-foreground">
        {program.phases.length} {program.phases.length === 1 ? "phase" : "phases"} · {exerciseCount}{" "}
        {exerciseCount === 1 ? "exercise" : "exercises"}
      </p>

      {program.phases.map((phase, p) => (
        <PhaseCard
          key={phase.key}
          phase={phase}
          index={p}
          count={program.phases.length}
          openItem={openItem}
          onOpenItem={setOpenItem}
          onPatch={(next) => patchPhase(phase.key, next)}
          onPatchItem={(itemKey, next) => patchItem(phase.key, itemKey, next)}
          onMove={(to) => setProgram((prev) => ({ ...prev, phases: swap(prev.phases, p, to) }))}
          onRemove={() =>
            setProgram((prev) => ({ ...prev, phases: prev.phases.filter((x) => x.key !== phase.key) }))
          }
        />
      ))}

      <Button
        variant="outline"
        onClick={() =>
          setProgram((prev) => ({
            ...prev,
            phases: [...prev.phases, toEditorPhase(emptyPhase(prev.phases.length))],
          }))
        }
      >
        <Plus aria-hidden /> Add a phase
      </Button>

      {showProblems && checked.problems.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Fix these before saving:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-destructive">
            {checked.problems.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {mode.kind === "edit" && (
        <section className="space-y-2 rounded-2xl border border-destructive/20 p-4">
          <h2 className="font-heading font-medium">Delete this program</h2>
          <p className="text-sm text-muted-foreground">
            Removes the program and every phase and exercise in it. This cannot be undone.
          </p>
          <DeleteProgramButton programId={mode.programId} name={program.name || "this program"} />
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        {mode.kind === "import" ? (
          <DiscardImportButton importId={mode.importId} />
        ) : (
          <Button asChild variant="ghost">
            <Link href={mode.kind === "edit" ? `${HOME}/programs/${mode.programId}` : HOME}>Cancel</Link>
          </Button>
        )}
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save program"}
        </Button>
      </div>
    </div>
  );
}

/** Two whole numbers, "from" and an optional "to". */
function RangeField({
  label,
  id,
  min,
  max,
  onChange,
}: {
  label: string;
  id: string;
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-min`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`${id}-min`}
          inputMode="numeric"
          className="w-20"
          value={min}
          onChange={(e) => onChange(e.target.value, max)}
          aria-label={`${label}: from`}
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          inputMode="numeric"
          className="w-20"
          value={max}
          onChange={(e) => onChange(min, e.target.value)}
          aria-label={`${label}: to (optional)`}
          placeholder="—"
        />
      </div>
    </div>
  );
}

function PhaseCard({
  phase,
  index,
  count,
  openItem,
  onOpenItem,
  onPatch,
  onPatchItem,
  onMove,
  onRemove,
}: {
  phase: EditorPhase;
  index: number;
  count: number;
  openItem: string | null;
  onOpenItem: (key: string | null) => void;
  onPatch: (next: Partial<EditorPhase>) => void;
  onPatchItem: (itemKey: string, next: Partial<EditorItem>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const label = phase.name.trim() || `Phase ${index + 1}`;
  return (
    <section className="space-y-4 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor={`${phase.key}-name`}>Phase {index + 1}</Label>
          <Input
            id={`${phase.key}-name`}
            value={phase.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            placeholder="Weeks 1–2"
          />
        </div>
        <div className="flex items-center pt-6">
          <Button size="icon" variant="ghost" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ChevronUp className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Move ${label} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`${phase.key}-days`}>Days before moving on</Label>
          <Input
            id={`${phase.key}-days`}
            inputMode="numeric"
            className="w-24"
            value={phase.minDoneDays}
            onChange={(e) => onPatch({ minDoneDays: e.target.value })}
            placeholder="—"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${phase.key}-notes`}>Notes for this phase</Label>
          <Input
            id={`${phase.key}-notes`}
            value={phase.notes}
            onChange={(e) => onPatch({ notes: e.target.value })}
            placeholder="Anything that applies to the whole phase"
          />
        </div>
      </div>

      <ol className="divide-y divide-border rounded-xl border border-border">
        {phase.items.map((item, i) => (
          <ItemRow
            key={item.key}
            item={item}
            index={i}
            count={phase.items.length}
            open={openItem === item.key}
            onToggle={() => onOpenItem(openItem === item.key ? null : item.key)}
            onPatch={(next) => onPatchItem(item.key, next)}
            onMove={(to) => onPatch({ items: swap(phase.items, i, to) })}
            onRemove={() => onPatch({ items: phase.items.filter((x) => x.key !== item.key) })}
          />
        ))}
      </ol>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const fresh = toEditorItem(emptyItem());
          onPatch({ items: [...phase.items, fresh] });
          onOpenItem(fresh.key);
        }}
      >
        <Plus aria-hidden /> Add an exercise
      </Button>
    </section>
  );
}

function summary(item: EditorItem): string {
  const n = (text: string) => (/^\d+$/.test(text.trim()) ? parseInt(text, 10) : null);
  const setsMin = n(item.setsMin);
  const targetMin = n(item.targetMin);
  if (setsMin === null || targetMin === null) return "Sets and count to fill in";
  return prescription({
    setsMin,
    setsMax: n(item.setsMax),
    targetMin,
    targetMax: n(item.targetMax),
    unit: item.unit,
    perSide: item.perSide,
  });
}

function ItemRow({
  item,
  index,
  count,
  open,
  onToggle,
  onPatch,
  onMove,
  onRemove,
}: {
  item: EditorItem;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onPatch: (next: Partial<EditorItem>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const name = item.name.trim() || "New exercise";
  const id = item.key;
  return (
    <li className={cn(open && "bg-muted/40")}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">{index + 1} · </span>
          {name}
          {item.optional && <span className="text-muted-foreground"> (optional)</span>}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground">{summary(item)}</span>
      </button>

      {open && (
        <div className="space-y-4 px-3 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Exercise</Label>
            <Input
              id={`${id}-name`}
              value={item.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder="Name of the exercise"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-purpose`}>What it is for</Label>
            <Textarea
              id={`${id}-purpose`}
              rows={2}
              value={item.purpose}
              onChange={(e) => onPatch({ purpose: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-unit`}>Counted in</Label>
              <Select value={item.unit} onValueChange={(value) => onPatch({ unit: value as FitnessUnitValue })}>
                <SelectTrigger id={`${id}-unit`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FITNESS_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {UNIT_WORDS[unit].many}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <RangeField
              label="Sets"
              id={`${id}-sets`}
              min={item.setsMin}
              max={item.setsMax}
              onChange={(min, max) => onPatch({ setsMin: min, setsMax: max })}
            />
            <RangeField
              label={`Count (${UNIT_WORDS[item.unit].many})`}
              id={`${id}-target`}
              min={item.targetMin}
              max={item.targetMax}
              onChange={(min, max) => onPatch({ targetMin: min, targetMax: max })}
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={item.perSide} onCheckedChange={(v) => onPatch({ perSide: v === true })} />
              Per side
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={item.optional} onCheckedChange={(v) => onPatch({ optional: v === true })} />
              Optional
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-cues`}>How to know you are doing it right</Label>
            <Textarea
              id={`${id}-cues`}
              rows={3}
              value={item.cues}
              onChange={(e) => onPatch({ cues: e.target.value })}
              placeholder={"One check per line\nLow back stays relaxed"}
            />
          </div>

          <VideoRows videos={item.videos} onChange={(videos) => onPatch({ videos })} />

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-notes`}>Notes</Label>
            <Textarea
              id={`${id}-notes`}
              rows={2}
              value={item.notes}
              onChange={(e) => onPatch({ notes: e.target.value })}
              placeholder="Which side, when to progress, equipment"
            />
          </div>

          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(index - 1)}>
              <ChevronUp aria-hidden /> Move up
            </Button>
            <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
              <ChevronDown aria-hidden /> Move down
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
              <Trash2 aria-hidden /> Remove
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function VideoRows({ videos, onChange }: { videos: EditorVideo[]; onChange: (videos: EditorVideo[]) => void }) {
  const patch = (key: string, next: Partial<EditorVideo>) =>
    onChange(videos.map((video) => (video.key === key ? { ...video, ...next } : video)));
  return (
    <div className="space-y-2">
      <Label>Videos</Label>
      {videos.length === 0 && <p className="text-sm text-muted-foreground">No video yet.</p>}
      {videos.map((video, v) => {
        const read = video.url.trim() === "" ? null : readEditorVideo(video);
        return (
          <div key={video.key} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                value={video.url}
                onChange={(e) => patch(video.key, { url: e.target.value })}
                placeholder="Paste a YouTube link"
                aria-label={`Video ${v + 1} link`}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove video ${v + 1}`}
                onClick={() => onChange(videos.filter((x) => x.key !== video.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {read && !read.ok && <p className="text-sm text-destructive">{read.problem}</p>}
            {read && read.ok && (
              <p className="text-sm text-muted-foreground">
                YouTube video {read.video.id} ·{" "}
                {read.video.embeddable === true
                  ? "plays here"
                  : read.video.embeddable === false
                    ? "only plays on YouTube"
                    : "checked when you save"}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {/* The first video is THE video, shown under the exercise's own
                  name; a later one needs a name, and an empty one takes its
                  YouTube title when the program is saved (`markVideos`). */}
              {v > 0 && (
                <Input
                  className="w-48"
                  value={video.label}
                  onChange={(e) => patch(video.key, { label: e.target.value })}
                  placeholder="Name (optional)"
                  aria-label={`Video ${v + 1} name`}
                />
              )}
              <Input
                className="w-28"
                value={video.start}
                onChange={(e) => patch(video.key, { start: e.target.value })}
                placeholder="Start 0:00"
                aria-label={`Video ${v + 1} starts at`}
              />
              <Input
                className="w-28"
                value={video.end}
                onChange={(e) => patch(video.key, { end: e.target.value })}
                placeholder="End"
                aria-label={`Video ${v + 1} ends at`}
              />
            </div>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => onChange([...videos, emptyEditorVideo()])}>
        <Plus aria-hidden /> Add a video
      </Button>
    </div>
  );
}
