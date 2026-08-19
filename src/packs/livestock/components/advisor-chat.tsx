"use client";

import { useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askAdvisorAction } from "../actions";

/**
 * Keep in sync with `ADVISOR_QUESTION_MAX` in `../ai/advisor.ts` — deliberately
 * not imported, so the system prompt never ships in the public bundle. Same
 * convention the health-check chat follows.
 */
const QUESTION_MAX = 2000;

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Ask the advisor. The other half of the day-one wedge: **ask it things, tell
 * it things** — the round makes telling cheap, this makes asking possible on a
 * farm with no history at all.
 *
 * **THE CONVERSATION LIVES HERE, NOT IN A TABLE.** Slice 1b needed no
 * migration, and that is a deliberate trade rather than an oversight: an
 * orienting answer is read once and acted on, so persisting it would add a
 * table, a retention question and a second place for farm facts to sit stale.
 * The cost is that a refresh clears the thread, which is recorded as an open
 * item rather than hidden.
 */
export function AdvisorChat({ starters }: { starters: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLTextAreaElement>(null);

  function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    // The history sent is what was on screen BEFORE this question, which is
    // what the server expects: it appends the question itself.
    const history = turns;
    setTurns([...history, { role: "user", content: trimmed }]);
    setDraft("");
    startTransition(async () => {
      const result = await askAdvisorAction({ question: trimmed, history });
      if ("error" in result) {
        toast.error(result.error);
        // The question stays on screen. Losing what somebody typed because the
        // key was missing is the same failure the move dialog has, and there is
        // no reason to repeat it here.
        setDraft(trimmed);
        setTurns(history);
        return;
      }
      setTurns((current) => [
        ...current,
        { role: "assistant", content: result.answer ?? "" },
      ]);
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
                disabled={pending}
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
          placeholder="How much should a 3-month pig be eating?"
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {/* Stated on the screen, not only in the prompt. The design's rule
                is that being confidently wrong about a dose or a withdrawal is
                worse than having no feature at all. */}
            Rules of thumb, anchored to your own records. It will not give you a
            medication dose or a withdrawal period — the label and your vet
            decide those.
          </p>
          <Button type="submit" disabled={pending || !draft.trim()}>
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
