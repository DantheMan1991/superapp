"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  markReportReadAction,
  replyToReportAction,
} from "@/lib/feedback/actions";
import { FEEDBACK_BODY_MAX } from "@/lib/feedback/vocabulary";

/**
 * The client's half of a thread: marking it read, and answering.
 *
 * MARKING READ IS AN EFFECT ON THE PAGE, not something the server component
 * does while rendering. A server component that wrote on render would mark a
 * report read on every prefetch, including the ones Next fires for links the
 * person never follows — the dot would clear for an answer nobody opened. Here
 * it runs once, after the page is actually on screen.
 *
 * `router.refresh()` afterwards, because the DOT LIVES IN THE LAYOUT and the
 * layout is what has to recount. Without it the page says read and the button
 * beside it still says unread, which is the kind of small lie that makes people
 * stop trusting a badge.
 */
export function MarkRead({ reportId }: { reportId: string }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markReportReadAction(reportId).then(() => router.refresh());
  }, [reportId, router]);

  return null;
}

export function ReplyBox({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const send = () => {
    start(async () => {
      const result = await replyToReportAction({ reportId, body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Textarea
        value={body}
        rows={3}
        maxLength={FEEDBACK_BODY_MAX}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Add anything else that would help — or answer the question above."
        aria-label="Your reply"
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          {pending && <Loader2 className="animate-spin" />}
          Send
        </Button>
      </div>
    </form>
  );
}
