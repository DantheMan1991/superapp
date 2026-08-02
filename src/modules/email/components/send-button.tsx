"use client";

import { useState } from "react";
import { Clock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  describeSendAt,
  MAX_SCHEDULE_DAYS,
  scheduleChoices,
  validateSendAt,
} from "../schedule/times";

/**
 * Send, or send later.
 *
 * The times are computed HERE, from the browser's own clock, and that is not an
 * implementation detail — "tomorrow morning" is a statement about the user's
 * calendar, and the server's clock is UTC. Resolving it server-side would
 * schedule mail for 08:00 UTC, which is the middle of the night for a good share
 * of the people being written to. The server bounds the instant it receives; it
 * cannot recompute it, because the timezone is not in the request.
 *
 * `new Date()` is read on OPEN rather than on render, so a composer left sitting
 * for an hour offers times relative to now rather than to when it was mounted.
 */
export function SendButton({
  busy,
  pending,
  onSend,
  onSchedule,
}: {
  busy: boolean;
  pending: boolean;
  onSend: () => void;
  onSchedule: (at: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [now, setNow] = useState(() => new Date());

  const customAt = custom ? new Date(custom) : null;
  const customProblem = customAt ? validateSendAt(customAt, now) : null;

  return (
    <div className="relative flex">
      <Button
        onClick={onSend}
        disabled={busy}
        size="sm"
        className="rounded-r-none pr-2.5"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        Send
      </Button>
      <Button
        size="sm"
        disabled={busy}
        aria-label="Schedule send"
        aria-expanded={open}
        onClick={() => {
          // Re-read the clock every time it opens.
          setNow(new Date());
          setOpen((o) => !o);
        }}
        className={cn("rounded-l-none border-l border-l-white/25 px-2")}
      >
        <Clock className="size-4" />
      </Button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-md border bg-background p-1.5 shadow-md">
          <p className="px-1.5 pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
            Send later
          </p>
          {scheduleChoices(now).map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onSchedule(choice.at);
              }}
              className="flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-1.5 text-left hover:bg-secondary"
            >
              <span className="text-sm">{choice.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {describeSendAt(choice.at, now)}
              </span>
            </button>
          ))}

          <div className="mt-1 border-t pt-1.5">
            <label
              htmlFor="mail-schedule-custom"
              className="px-1.5 text-[0.65rem] text-muted-foreground"
            >
              Or pick a time
            </label>
            <div className="mt-1 flex items-center gap-1.5 px-1.5">
              {/* datetime-local hands back WALL-CLOCK time with no zone, which
                  is exactly right: the person means their own clock. `new Date`
                  on that string resolves it in their timezone. */}
              <input
                id="mail-schedule-custom"
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="h-7 min-w-0 flex-1 rounded-sm border bg-background px-1.5 text-xs outline-none"
              />
              <button
                type="button"
                disabled={!customAt || Boolean(customProblem)}
                onClick={() => {
                  if (!customAt || customProblem) return;
                  setOpen(false);
                  onSchedule(customAt);
                }}
                className="shrink-0 rounded-sm border px-2 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-40"
              >
                Set
              </button>
            </div>
            {customProblem && (
              <p className="px-1.5 pt-1 text-[0.65rem] text-muted-foreground">
                {customProblem === "too far ahead"
                  ? `Up to ${MAX_SCHEDULE_DAYS} days ahead.`
                  : customProblem === "too soon"
                    ? "Pick a time at least a minute away."
                    : "Pick a time in the future."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
