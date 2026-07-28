"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AuditMessage } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getInterview,
  sendInterviewMessage,
  startInterview,
  submitContact,
} from "./actions";

type Phase =
  | "idle"
  | "active"
  | "awaiting_contact"
  | "completed"
  | "unavailable";

const STORAGE_KEY = "yosher-health-check";

/** Keep in sync with INTERVIEW_MESSAGE_MAX in src/lib/interview-prompt.ts —
 * not imported so the prompt file never ships in the public bundle. */
const INTERVIEW_MESSAGE_MAX = 1000;

const WRAP_FALLBACK =
  "That's everything I need — your free health check is ready. Tell us where to send it below.";

export function HealthCheckChat() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AuditMessage[]>([]);
  const [assessment, setAssessment] = useState<string | null>(null);
  const [unavailableMsg, setUnavailableMsg] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Resume a session across refreshes.
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    startTransition(async () => {
      const res = await getInterview({ sessionId: stored });
      if ("error" in res) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      setSessionId(stored);
      setMessages(res.messages);
      setAssessment(res.assessment);
      setPhase(
        res.state === "active"
          ? "active"
          : res.state === "awaiting_contact"
            ? "awaiting_contact"
            : "completed",
      );
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase, pending]);

  const begin = () =>
    startTransition(async () => {
      const res = await startInterview();
      if ("error" in res) {
        setUnavailableMsg(res.error);
        setPhase("unavailable");
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, res.sessionId);
      setSessionId(res.sessionId);
      setMessages(res.messages);
      setPhase("active");
    });

  const send = () => {
    const message = draft.trim();
    if (!message || !sessionId || pending) return;
    startTransition(async () => {
      const res = await sendInterviewMessage({ sessionId, message });
      if ("error" in res) {
        if (res.retryable) toast.error(res.error);
        else {
          sessionStorage.removeItem(STORAGE_KEY);
          setUnavailableMsg(res.error);
          setPhase("unavailable");
        }
        return;
      }
      setDraft("");
      setMessages((m) => [
        ...m,
        { role: "user", content: message },
        { role: "assistant", content: res.reply || WRAP_FALLBACK },
      ]);
      if (res.done) setPhase("awaiting_contact");
    });
  };

  if (phase === "idle") {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Your free business health check</CardTitle>
          <CardDescription>
            About ten quick questions on how your business actually runs — the
            work, the crew, the paperwork. At the end you get a plain-language
            health check: where you&apos;re losing time and money, and what to
            fix first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={begin} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                Start the health check <ArrowRight className="size-4" />
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Free · no signup · no card · takes about five minutes
          </p>
        </CardContent>
      </Card>
    );
  }

  if (phase === "unavailable") {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {unavailableMsg}
        </CardContent>
      </Card>
    );
  }

  const questionNumber = Math.min(
    Math.floor(messages.length / 2) + 1,
    10,
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          {phase === "active" && (
            <p className="text-xs text-muted-foreground">
              Question {questionNumber} of ~10
            </p>
          )}
          <div className="space-y-3">
            {messages.map((m, i) =>
              m.role === "assistant" ? (
                <div
                  key={i}
                  className="prose prose-sm max-w-none rounded-lg bg-muted/60 px-4 py-3 dark:prose-invert"
                >
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <div
                  key={i}
                  className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                >
                  {m.content}
                </div>
              ),
            )}
            {pending && phase === "active" && (
              <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {phase === "active" && (
            <div className="space-y-1.5">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Type your answer…"
                maxLength={INTERVIEW_MESSAGE_MAX}
                rows={2}
                disabled={pending}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {draft.length}/{INTERVIEW_MESSAGE_MAX}
                </span>
                <Button size="sm" onClick={send} disabled={pending || !draft.trim()}>
                  Send
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {phase === "awaiting_contact" && sessionId && (
        <ContactGate
          sessionId={sessionId}
          onDone={(a) => {
            setAssessment(a);
            setPhase("completed");
          }}
          onExpired={(msg) => {
            sessionStorage.removeItem(STORAGE_KEY);
            setUnavailableMsg(msg);
            setPhase("unavailable");
          }}
        />
      )}

      {phase === "completed" && <AssessmentView assessment={assessment} />}
    </div>
  );
}

function ContactGate({
  sessionId,
  onDone,
  onExpired,
}: {
  sessionId: string;
  onDone: (assessment: string | null) => void;
  onExpired: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Your free health check is ready
        </CardTitle>
        <CardDescription>
          Tell us where to put your name on it — the written health check
          appears right here. No spam, no card.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) =>
            startTransition(async () => {
              const res = await submitContact({
                sessionId,
                contactName: String(formData.get("contactName") ?? ""),
                email: String(formData.get("email") ?? ""),
                businessName: String(formData.get("businessName") ?? ""),
              });
              if ("error" in res) {
                if (res.error.includes("expired")) onExpired(res.error);
                else toast.error(res.error);
                return;
              }
              onDone(res.assessment);
            })
          }
          className="space-y-2"
        >
          <Input name="contactName" placeholder="Your name" required maxLength={120} />
          <Input
            name="email"
            type="email"
            placeholder="you@business.com"
            required
            maxLength={254}
          />
          <Input
            name="businessName"
            placeholder="Business name"
            required
            minLength={2}
            maxLength={120}
          />
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Preparing your
                health check…
              </>
            ) : (
              "Show my health check"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AssessmentView({ assessment }: { assessment: string | null }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          {assessment ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{assessment}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your health check is being finished — we&apos;ll follow up at
              your email shortly.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-sm">
            Want this handled for you?{" "}
            <span className="text-muted-foreground">
              Or just reply when we reach out — we&apos;ll be in touch either
              way.
            </span>
          </p>
          <Button asChild size="sm">
            <Link href="/sign-up">
              Create your account <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
