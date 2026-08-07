"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import type { CrmActivityKind, CrmTask } from "@/db/schema";
import { dueBucket } from "../core/timeline";
import {
  createTaskAction,
  deleteActivityAction,
  logActivityAction,
  setTaskCompleteAction,
} from "../timeline-actions";

const KIND_LABELS: Record<CrmActivityKind, string> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
};

/** Today in the BROWSER's timezone — the only one whose "today" the user means. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Log what happened.
 *
 * The date defaults to today but is editable, because writing up Friday's site
 * visit on Monday is the normal case and a timeline that reads Monday for it is
 * quietly wrong about the order things happened in.
 */
export function LogActivityButton({
  partyId,
  dealId,
}: {
  partyId: string;
  dealId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CrmActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayLocal());
  const [pending, startTransition] = useTransition();

  function submit() {
    if (subject.trim().length === 0 && body.trim().length === 0) {
      toast.error("Write something first");
      return;
    }
    startTransition(async () => {
      const result = await logActivityAction({
        partyId,
        dealId: dealId ?? null,
        kind,
        subject: subject.trim(),
        body,
        occurredOn,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Logged");
      setOpen(false);
      setSubject("");
      setBody("");
      setKind("note");
      setOccurredOn(todayLocal());
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-4" />
        Log
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log what happened</DialogTitle>
            <DialogDescription>
              A note, a call or a meeting. It lands on the timeline at the date
              you give it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="crm-activity-kind">Kind</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as CrmActivityKind)}
                >
                  <SelectTrigger id="crm-activity-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KIND_LABELS) as CrmActivityKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-activity-date">When</Label>
                <Input
                  id="crm-activity-date"
                  type="date"
                  value={occurredOn}
                  onChange={(e) => setOccurredOn(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-activity-subject">Summary (optional)</Label>
              <Input
                id="crm-activity-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="One line, if it helps"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-activity-body">What happened</Label>
              <Textarea
                id="crm-activity-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Log it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The picker's value for "nobody yet" — empty string, since Select needs one. */
const UNASSIGNED = "__unassigned__";

/**
 * Add a follow-up. `partyId` null is a standalone task — see the RLS note.
 *
 * `members` and `currentUserId` came from the server so the picker cannot
 * reveal anybody the caller could not already see: the query behind them runs
 * in the caller's own tenant transaction.
 *
 * THE DEFAULT IS YOU, and that is the fix rather than an incidental choice.
 * The column, the ops and the digest's per-person scoping all existed already
 * — what did not exist was any UI that set an assignee, so every follow-up in
 * the product was unassigned, and a digest built on "each person sees their own
 * work" had nothing to give anybody but the owner. Defaulting to the person
 * adding it makes the common case correct without a decision; "Nobody yet"
 * stays available for work that genuinely has no owner, which is what the
 * digest's unassigned roll-up is for.
 */
export function AddTaskButton({
  partyId,
  dealId,
  label,
  members = [],
  currentUserId,
}: {
  partyId?: string | null;
  dealId?: string | null;
  label?: string;
  members?: Array<{ clerkUserId: string; label: string }>;
  currentUserId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [assignee, setAssignee] = useState<string>(currentUserId ?? UNASSIGNED);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (title.trim().length === 0) {
      toast.error("Give it a name");
      return;
    }
    startTransition(async () => {
      const result = await createTaskAction({
        partyId: partyId ?? null,
        dealId: dealId ?? null,
        title: title.trim(),
        notes,
        dueOn: dueOn || null,
        assigneeClerkUserId: assignee === UNASSIGNED ? null : assignee,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Follow-up added");
      setOpen(false);
      setTitle("");
      setNotes("");
      setDueOn("");
      setAssignee(currentUserId ?? UNASSIGNED);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-4" />
        {label ?? "Follow-up"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a follow-up</DialogTitle>
            <DialogDescription>
              A date is optional. Without one it sits under &ldquo;someday&rdquo;
              rather than going overdue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="crm-task-title">What needs doing</Label>
              <Input
                id="crm-task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Send the revised figures"
              />
            </div>
            {members.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="crm-task-assignee">Who is doing it</Label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger id="crm-task-assignee" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                        {m.clerkUserId === currentUserId ? `${m.label} (you)` : m.label}
                      </SelectItem>
                    ))}
                    {/* Last, not first: an owner is the exception, not the
                        default. Work with nobody's name on it is what the
                        digest rolls up to the owner separately. */}
                    <SelectItem value={UNASSIGNED}>Nobody yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="crm-task-due">By when (optional)</Label>
              <Input
                id="crm-task-due"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-task-notes">Notes (optional)</Label>
              <Textarea
                id="crm-task-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Tick or untick one follow-up. */
export function TaskToggle({ task }: { task: CrmTask }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const done = !!task.completedAt;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
      onClick={() =>
        startTransition(async () => {
          const result = await setTaskCompleteAction({
            taskId: task.id,
            expectedVersion: task.version,
            complete: !done,
            partyId: task.partyId,
            dealId: task.dealId,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(done ? "Reopened" : "Done");
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : done ? (
        <Undo2 className="size-4" />
      ) : (
        <Check className="size-4" />
      )}
    </Button>
  );
}

/** Remove a logged entry. See `deleteActivity` for why this one is deletable. */
export function DeleteActivityButton({
  activityId,
  partyId,
}: {
  activityId: string;
  partyId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label="Delete this entry"
      onClick={() =>
        startTransition(async () => {
          const result = await deleteActivityAction({ activityId, partyId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Deleted");
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </Button>
  );
}

/** The urgency chip on a follow-up. Computed in the BROWSER's today. */
export function DueBadge({ dueOn }: { dueOn: string | null }) {
  const bucket = dueBucket(dueOn, todayLocal());
  if (bucket === "someday") return null;
  if (bucket === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  if (bucket === "today") return <Badge>Today</Badge>;
  return (
    <span className="text-xs text-muted-foreground">{dueOn}</span>
  );
}
