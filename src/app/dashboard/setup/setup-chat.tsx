"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/panel";
import { Textarea } from "@/components/ui/textarea";
import {
  sendSetupMessageAction,
  startSetupInterviewAction,
} from "@/lib/setup-interview/actions";
import { SETUP_MESSAGE_MAX, SETUP_WRAP_TARGET } from "@/lib/setup-interview/prompt";
import type { SetupInterviewView } from "@/lib/setup-interview/session";
import { cn } from "@/lib/utils";

/**
 * The setup interview, and the plan it ends with (ADR 0040).
 *
 * A CONVERSATION, NOT A WIZARD. A wizard asks everybody the same questions in
 * the same order and cannot skip what it can already see; this asks about the
 * business and stops when it has enough. The plan at the end is the artefact
 * — it stays on the page, and every step links to the screen that does it.
 */
export function SetupChat({ initial }: { initial: SetupInterviewView | null }) {
  const router = useRouter();
  const [view, setView] = useState<SetupInterviewView | null>(initial);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view?.messages.length]);

  function start() {
    startTransition(async () => {
      const result = await startSetupInterviewAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setView(result.data);
    });
  }

  function send() {
    if (message.trim() === "") return;
    const said = message;
    setMessage("");
    startTransition(async () => {
      const result = await sendSetupMessageAction({ message: said });
      if ("error" in result) {
        toast.error(result.error);
        setMessage(said);
        return;
      }
      setView(result.data);
      if (result.data.state === "done") router.refresh();
    });
  }

  if (!view) {
    return (
      <Panel className="p-6 text-center">
        <p className="text-sm text-muted-foreground">
          A few questions about how the business runs, then a written plan: what to do,
          in what order, with a link to each screen. It takes about five minutes.
        </p>
        <Button className="mt-4" onClick={start} disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          <Sparkles className="mr-2 size-4" />
          Start
        </Button>
      </Panel>
    );
  }

  const finished = view.state === "done";

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <ul className="space-y-3">
          {view.messages.map((m, i) => (
            <li
              key={i}
              className={cn(
                "max-w-[42rem] rounded-md px-3 py-2 text-sm",
                m.role === "assistant"
                  ? "bg-muted/60"
                  : "ml-auto bg-primary/10 text-right",
              )}
            >
              {m.content.split("\n").map((line, j) => (
                <p key={j} className={j > 0 ? "mt-2" : undefined}>
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <div ref={endRef} />

        {!finished && (
          <div className="mt-4 space-y-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              maxLength={SETUP_MESSAGE_MAX}
              placeholder="Type your answer…"
              disabled={pending}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {view.exchangeCount} of about {SETUP_WRAP_TARGET} questions. Enter sends.
              </p>
              <Button size="sm" onClick={send} disabled={pending || message.trim() === ""}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {pending ? "Thinking…" : "Send"}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {finished && view.plan && (
        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
            Your plan
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{view.plan.summary}</p>
          <ol className="mt-4 space-y-3">
            {view.plan.steps.map((step, i) => (
              <li key={i} className="flex gap-3 border-t pt-3 first:border-t-0 first:pt-0">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{step.why}</p>
                  {step.href && (
                    <Button asChild variant="outline" size="sm" className="mt-2">
                      <Link href={step.href}>
                        {step.screen}
                        <ArrowRight className="ml-1.5 size-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            The plan stays here. Nothing on it has been done for you, and nothing was
            changed by answering the questions — every step is a screen you go to.
          </p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={start} disabled={pending}>
            Go through it again
          </Button>
        </Panel>
      )}
    </div>
  );
}
