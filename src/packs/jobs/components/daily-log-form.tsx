"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteDailyLogAction, saveDailyLogAction } from "../actions";
import { tenthsToHours } from "../vocabulary";

const NONE = "__none__";

interface CrewDraft {
  partyId: string;
  trade: string;
  workers: string;
  hours: string;
}

export interface EditableDailyLog {
  id: string;
  logDate: string;
  weather: string;
  notes: string;
  crews: Array<{ partyId: string | null; trade: string; workers: number; hoursTenths: number }>;
}

/** Today as the `date` input wants it, in the person's own timezone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The daily report, as a form: the day, the weather, what happened, and who
 * was on site.
 *
 * **ONE REPORT PER DAY, so saving a day that exists edits it.** The action
 * upserts by (job, day); "Log today" twice is one report, not two, which is
 * what the person in the mud room at five wants without knowing to check.
 *
 * **WHO WAS ON SITE IS A HEADCOUNT**, one row per trade or subcontractor:
 * how many, and hours each. Not the company's own timecards — those are the
 * Time module's, to the minute, for wages. A row with no trade and no
 * subcontractor is the empty last row and is ignored.
 */
export function DailyLogForm({
  projectId,
  parties,
  existing,
  trigger,
}: {
  projectId: string;
  parties: Array<{ id: string; name: string }>;
  existing?: EditableDailyLog;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [logDate, setLogDate] = useState(existing?.logDate ?? today());
  const [weather, setWeather] = useState(existing?.weather ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const blank = (): CrewDraft => ({ partyId: NONE, trade: "", workers: "", hours: "" });
  const [crews, setCrews] = useState<CrewDraft[]>(() =>
    existing && existing.crews.length > 0
      ? existing.crews.map((c) => ({
          partyId: c.partyId ?? NONE,
          trade: c.trade,
          workers: String(c.workers),
          hours: tenthsToHours(c.hoursTenths),
        }))
      : [blank()],
  );

  function setCrew(i: number, patch: Partial<CrewDraft>) {
    setCrews((prev) => prev.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  }

  function submit() {
    startTransition(async () => {
      const result = await saveDailyLogAction({
        projectId,
        logDate,
        weather: weather.trim(),
        notes: notes.trim(),
        crews: crews.map((c) => ({
          partyId: c.partyId === NONE ? "" : c.partyId,
          trade: c.trade.trim(),
          workers: c.workers.trim() === "" ? 0 : Number(c.workers),
          hours: c.hours.trim(),
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Day saved" : "Day logged");
      setOpen(false);
      if (!editing) {
        setWeather("");
        setNotes("");
        setCrews([blank()]);
      }
      router.refresh();
    });
  }

  function remove() {
    if (!existing) return;
    if (!window.confirm(`Remove the report for ${existing.logDate}? Its photos stay in Documents.`)) return;
    startTransition(async () => {
      const result = await deleteDailyLogAction({ id: existing.id, projectId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Day removed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <ClipboardList className="mr-1.5 size-4" /> Log today
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Daily log · ${existing.logDate}` : "Daily log"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="dl-date">Day</Label>
                <Input
                  id="dl-date"
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  disabled={editing}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dl-weather">Weather</Label>
                <Input
                  id="dl-weather"
                  value={weather}
                  onChange={(e) => setWeather(e.target.value)}
                  placeholder="Clear, 78°. Rain after two."
                  maxLength={120}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dl-notes">What happened</Label>
              <Textarea
                id="dl-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="Poured the garage slab. Framers started the second floor. Inspector due Thursday."
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <Label>Who was on site</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCrews((prev) => [...prev, blank()])}
                >
                  <Plus className="mr-1.5 size-4" /> Add crew
                </Button>
              </div>
              {crews.map((c, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_5rem_5rem_2rem]">
                  <Input
                    aria-label={`Trade, crew ${i + 1}`}
                    value={c.trade}
                    onChange={(e) => setCrew(i, { trade: e.target.value })}
                    placeholder="Framing"
                    maxLength={120}
                  />
                  <Select value={c.partyId} onValueChange={(v) => setCrew(i, { partyId: v })}>
                    <SelectTrigger aria-label={`Subcontractor, crew ${i + 1}`}>
                      <SelectValue placeholder="Subcontractor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Own crew / not on file</SelectItem>
                      {parties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`Workers, crew ${i + 1}`}
                    value={c.workers}
                    onChange={(e) => setCrew(i, { workers: e.target.value })}
                    placeholder="How many"
                    inputMode="numeric"
                    className="text-right"
                  />
                  <Input
                    aria-label={`Hours each, crew ${i + 1}`}
                    value={c.hours}
                    onChange={(e) => setCrew(i, { hours: e.target.value })}
                    placeholder="Hours"
                    inputMode="decimal"
                    className="text-right"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={crews.length === 1}
                    onClick={() => setCrews((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Remove crew {i + 1}</span>
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                A trade or a subcontractor, how many people, and hours each. A
                row with neither is ignored. This is who was on the site — the
                company&apos;s own timecards are in Time.
              </p>
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            {editing ? (
              <Button variant="ghost" onClick={remove} disabled={pending}>
                Remove day
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={submit} disabled={pending || logDate === ""}>
              {pending ? "Saving…" : editing ? "Save day" : "Log it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
