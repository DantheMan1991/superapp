"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import {
  extractNoteAction,
  saveReviewedNoteAction,
} from "../note-actions";
import { NOTE_MAX_CHARS } from "../ai/note-shape";

const UNASSIGNED = "__unassigned__";

interface ReviewTask {
  title: string;
  dueOn: string | null;
  assigneeClerkUserId: string | null;
  /** The name the note used, when we could not place it. Shown, never guessed. */
  assigneeHint: string | null;
}

interface ReviewActivity {
  kind: "call" | "meeting" | "note";
  summary: string;
}

/**
 * Paste a note, review what was found, then save.
 *
 * THE REVIEW STEP IS THE FEATURE, not a courtesy. Nothing here writes until
 * somebody has read every row and pressed save — the extract call returns a
 * proposal and the save call takes only what survived this screen. A follow-up
 * created here lands in its assignee's morning digest, so an unreviewed one
 * would be the product inventing an obligation and then chasing somebody about
 * it.
 *
 * Every row is droppable and editable for the same reason: correcting a date
 * has to be cheaper than deleting the task and retyping it, or people will keep
 * the wrong date.
 */
export function NoteExtractor({
  partyId,
  members = [],
}: {
  partyId: string;
  members?: Array<{ clerkUserId: string; label: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();
  const [activities, setActivities] = useState<ReviewActivity[] | null>(null);
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);

  const reviewed = activities !== null && tasks !== null;
  const nameOf = new Map(members.map((m) => [m.clerkUserId, m.label]));

  function reset() {
    setNote("");
    setActivities(null);
    setTasks(null);
  }

  function extract() {
    if (note.trim().length === 0) return;
    startTransition(async () => {
      const result = await extractNoteAction({ partyId, note });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setActivities(result.proposal.activities);
      setTasks(result.proposal.tasks);
      if (
        result.proposal.activities.length === 0 &&
        result.proposal.tasks.length === 0
      ) {
        // An explicit message, not an empty panel: "nothing found" and "it
        // broke" must not look the same.
        toast.info("Nothing to record from that note.");
      }
    });
  }

  function save() {
    if (!reviewed) return;
    startSaving(async () => {
      const result = await saveReviewedNoteAction({
        partyId,
        activities,
        tasks: tasks.map((t) => ({
          title: t.title,
          dueOn: t.dueOn,
          assigneeClerkUserId: t.assigneeClerkUserId,
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const parts = [
        result.activities > 0 &&
          `${result.activities} ${result.activities === 1 ? "activity" : "activities"}`,
        result.tasks > 0 &&
          `${result.tasks} ${result.tasks === 1 ? "follow-up" : "follow-ups"}`,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? `Saved ${parts.join(" and ")}` : "Nothing to save");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="mr-2 size-4" />
        From a note
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record a note</DialogTitle>
            <DialogDescription>
              Paste what happened. You&apos;ll see what it found and can change
              anything before it saves.
            </DialogDescription>
          </DialogHeader>

          {!reviewed ? (
            <div className="space-y-2">
              <Label htmlFor="crm-note">The note</Label>
              <Textarea
                id="crm-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={10}
                maxLength={NOTE_MAX_CHARS}
                placeholder={
                  "Called Ash at Fulton Lumber about the split delivery. They want the second drop the week after next. Dave to send revised figures by Friday."
                }
              />
              <p className="text-xs text-muted-foreground">
                {note.length.toLocaleString()} / {NOTE_MAX_CHARS.toLocaleString()}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {activities.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">What happened</h3>
                  <ul className="space-y-2">
                    {activities.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <Badge variant="secondary" className="capitalize">
                            {a.kind}
                          </Badge>
                          <p className="text-sm">{a.summary}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          onClick={() =>
                            setActivities(activities.filter((_, j) => j !== i))
                          }
                        >
                          <X className="size-4" />
                          <span className="sr-only">Drop this activity</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {tasks.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Follow-ups</h3>
                  <ul className="space-y-2">
                    {tasks.map((t, i) => (
                      <li key={i} className="space-y-2 rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <Input
                            value={t.title}
                            onChange={(e) =>
                              setTasks(
                                tasks.map((x, j) =>
                                  j === i ? { ...x, title: e.target.value } : x,
                                ),
                              )
                            }
                            className="h-8"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            onClick={() =>
                              setTasks(tasks.filter((_, j) => j !== i))
                            }
                          >
                            <X className="size-4" />
                            <span className="sr-only">Drop this follow-up</span>
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="date"
                            value={t.dueOn ?? ""}
                            onChange={(e) =>
                              setTasks(
                                tasks.map((x, j) =>
                                  j === i
                                    ? { ...x, dueOn: e.target.value || null }
                                    : x,
                                ),
                              )
                            }
                            className="h-8 w-40"
                          />
                          {members.length > 0 && (
                            <Select
                              value={t.assigneeClerkUserId ?? UNASSIGNED}
                              onValueChange={(v) =>
                                setTasks(
                                  tasks.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          assigneeClerkUserId:
                                            v === UNASSIGNED ? null : v,
                                          assigneeHint: null,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger className="h-8 w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {members.map((m) => (
                                  <SelectItem
                                    key={m.clerkUserId}
                                    value={m.clerkUserId}
                                  >
                                    {m.label}
                                  </SelectItem>
                                ))}
                                <SelectItem value={UNASSIGNED}>
                                  Nobody yet
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          {t.assigneeClerkUserId && (
                            <span className="text-xs text-muted-foreground">
                              {nameOf.get(t.assigneeClerkUserId)}
                            </span>
                          )}
                        </div>
                        {/* Shown rather than swallowed: the note named somebody
                            we could not place, and the reviewer is the only one
                            who can say who was meant. */}
                        {t.assigneeHint && (
                          <p className="text-xs text-amber-600">
                            The note said &ldquo;{t.assigneeHint}&rdquo; — pick
                            who that is, or leave it unassigned.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {activities.length === 0 && tasks.length === 0 && (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nothing to record from that note.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {reviewed ? (
              <>
                <Button variant="ghost" onClick={reset} disabled={saving}>
                  Start over
                </Button>
                <Button
                  onClick={save}
                  disabled={
                    saving || (activities.length === 0 && tasks.length === 0)
                  }
                >
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={extract}
                  disabled={pending || note.trim().length === 0}
                >
                  {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {pending ? "Reading…" : "Read the note"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
