"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { statusLabel, kindLabel } from "@/lib/feedback/core";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  type FeedbackStatus,
} from "@/lib/feedback/vocabulary";
import {
  markSeenAction,
  replyFromConsoleAction,
  triageReportAction,
} from "./actions";

const KEEP = "__keep__";

/**
 * The console's controls. Three, and the split between them is the whole
 * design:
 *
 *   * ANSWER — types something the client reads, and may move the status in
 *     the same submit, because "here is my question" and "waiting on them" are
 *     one thought.
 *   * NOTE — types something only we read. Same box, one checkbox, because a
 *     separate notes panel means writing the note somewhere the thread is not.
 *   * MOVE / SEEN — changes nothing the client can read and says nothing.
 *
 * A status picker that always writes a line into the conversation was the
 * first version and it was wrong: "status changed to planned" between two
 * people talking is noise wearing the clothes of an answer.
 */
export function ConsoleReply({
  reportId,
  status,
}: {
  reportId: string;
  status: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState<string>(KEEP);
  const [pending, start] = useTransition();

  const send = () => {
    start(async () => {
      const result = await replyFromConsoleAction({
        reportId,
        body,
        internal,
        ...(nextStatus === KEEP ? {} : { status: nextStatus }),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBody("");
      setNextStatus(KEEP);
      toast.success(internal ? "Note saved." : "Sent to the client.");
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Textarea
        value={body}
        rows={4}
        maxLength={FEEDBACK_BODY_MAX}
        onChange={(event) => setBody(event.target.value)}
        placeholder={
          internal
            ? "A note only we can see."
            : "What you want the client to read."
        }
        aria-label={internal ? "Internal note" : "Reply to the client"}
        // The box itself says which of the two it is. A checkbox alone is not
        // enough of a signal for a control that decides whether a stranger
        // reads what you typed.
        className={internal ? "border-warning bg-warning/5" : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="feedback-internal"
            checked={internal}
            onCheckedChange={(value) => setInternal(value === true)}
          />
          <Label htmlFor="feedback-internal" className="text-sm font-normal">
            Internal note — the client never sees this
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Select value={nextStatus} onValueChange={setNextStatus}>
            <SelectTrigger className="w-48" aria-label="Set status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>
                Leave as {statusLabel(status, "operator")}
              </SelectItem>
              {FEEDBACK_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {statusLabel(value, "operator")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={pending || body.trim().length === 0}>
            {pending && <Loader2 className="animate-spin" />}
            {internal ? "Save note" : "Send"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Move it without saying anything. */
export function TriageControls({
  reportId,
  status,
  kind,
}: {
  reportId: string;
  status: string;
  kind: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const move = (patch: { status?: string; kind?: string }) => {
    start(async () => {
      const result = await triageReportAction({ reportId, ...patch });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={status}
        onValueChange={(value) => move({ status: value })}
        disabled={pending}
      >
        <SelectTrigger className="w-44" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FEEDBACK_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {statusLabel(value, "operator")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={kind}
        onValueChange={(value) => move({ kind: value })}
        disabled={pending}
      >
        <SelectTrigger className="w-36" aria-label="Kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FEEDBACK_KINDS.map((value) => (
            <SelectItem key={value} value={value}>
              {kindLabel(value, "operator")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/**
 * "Noted, nothing to say." Clears the row off the queue without pretending a
 * decision was made about it.
 */
export function MarkSeenButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markSeenAction(reportId);
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="animate-spin" />}
      Mark seen
    </Button>
  );
}

export type { FeedbackStatus };
