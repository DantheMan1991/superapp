"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/app/use-confirm";
import { askAdvisorAction, removeAdvisorThreadAction } from "../actions";

/**
 * Keep in sync with `ADVISOR_QUESTION_MAX` in `../ai/advisor.ts` — deliberately
 * not imported, so the system prompt never ships in the public bundle. Same
 * convention the health-check chat follows.
 */
const QUESTION_MAX = 2000;

const BASE = "/dashboard/m/livestock";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Ask the advisor. The other half of the day-one wedge: **ask it things, tell
 * it things** — the round makes telling cheap, this makes asking possible on a
 * farm with no history at all.
 *
 * **THE CONVERSATION IS A ROW NOW, AND THE BROWSER SENDS ONLY THE QUESTION.**
 * Slice 1b kept the thread in this component's state, which is what made it
 * migration-free and what lost it on every refresh. Since 2026-09-08 the
 * thread is `livestock_advisor_threads`, the turns are read back on the
 * server, and the history the model sees comes from there rather than from
 * whatever this component posted — the same rule the digest has always had.
 * What this component holds is a copy for the screen, and the thread's id.
 */
export function AdvisorChat({
  starters,
  threadId: initialThreadId,
  initialTurns,
  capMessage,
}: {
  starters: string[];
  /** The thread on screen, or null for a fresh one — the first question starts it. */
  threadId: string | null;
  initialTurns: Turn[];
  /** Set when the farm has reached its daily cap. The box says so and closes. */
  capMessage: string | null;
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const capped = capMessage !== null;

  function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending || capped) return;
    const before = turns;
    setTurns([...before, { role: "user", content: trimmed }]);
    setDraft("");
    startTransition(async () => {
      const result = await askAdvisorAction({ question: trimmed, threadId });
      if ("error" in result) {
        toast.error(result.error);
        // The question stays on screen. Losing what somebody typed because the
        // key was missing is the same failure the move dialog has, and there is
        // no reason to repeat it here.
        setDraft(trimmed);
        setTurns(before);
        return;
      }
      setTurns((current) => [
        ...current,
        { role: "assistant", content: result.answer ?? "" },
      ]);
      // A first question made the thread. The address follows it, so a
      // reload lands on this conversation rather than on a fresh one — and
      // the list at the side learns about it.
      if (!threadId && result.threadId) {
        setThreadId(result.threadId);
        router.replace(`${BASE}/ask?thread=${result.threadId}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {turns.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {/* The cold start applies to the advisor too: somebody who has
                never asked a farm question of software does not know what it
                will answer. Starters are the cheapest way to show the range. */}
            Ask anything about your animals. It knows what you have recorded —
            head, losses, ages, which paddock they are on and how long each one
            has rested — and it answers the rest from general husbandry.
          </p>
          <div className="flex flex-wrap gap-2">
            {starters.map((starter) => (
              <Button
                key={starter}
                variant="outline"
                size="sm"
                onClick={() => ask(starter)}
                disabled={pending || capped}
              >
                {starter}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {turns.map((turn, i) => (
            <div key={i} className="space-y-1">
              {turn.role === "user" ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium">
                  {turn.content}
                </p>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                  <ReactMarkdown>{turn.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}
          {pending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(draft);
        }}
        className="space-y-2"
      >
        <Textarea
          ref={boxRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a new line. A farm question is one
            // sentence far more often than it is a paragraph.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(draft);
            }
          }}
          rows={3}
          maxLength={QUESTION_MAX}
          placeholder={capped ? capMessage : "How much should a 3-month pig be eating?"}
          disabled={pending || capped}
        />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {/* Stated on the screen, not only in the prompt. The design's rule
                is that being confidently wrong about a dose or a withdrawal is
                worse than having no feature at all. */}
            {capped
              ? capMessage
              : "Rules of thumb, anchored to your own records. It will not give you a medication dose or a withdrawal period — the label and your vet decide those."}
          </p>
          <Button type="submit" disabled={pending || capped || !draft.trim()}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Take a thread off the list. Asks first — a conversation is the one thing on
 * this screen nobody can re-derive from the farm's records.
 */
export function RemoveThreadButton({
  threadId,
  title,
  current,
}: {
  threadId: string;
  title: string;
  /** True when this is the thread on screen: removing it lands on a fresh one. */
  current: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  async function submit() {
    if (
      !(await confirm({
        title: `Remove "${title}"?`,
        description: "The questions and the answers in it go. Nothing in your records changes.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await removeAdvisorThreadAction({ id: threadId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Thread removed");
      if (current) router.push(`${BASE}/ask?thread=new`);
      else router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={submit}
        disabled={pending}
        aria-label={`Remove the thread ${title}`}
      >
        Remove
      </Button>
      {confirmDialog}
    </>
  );
}
