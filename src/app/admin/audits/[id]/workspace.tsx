"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { FileText, Loader2, MessageSquare, Send, Sparkles } from "lucide-react";
import type { AuditMessage } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  generateAuditReport,
  sendAuditMessage,
  setAuditStatus,
} from "../actions";

const STATUSES = ["open", "report_ready", "won", "lost"] as const;

export function AuditWorkspace({
  auditId,
  status,
  messages,
  report,
}: {
  auditId: string;
  status: string;
  messages: AuditMessage[];
  report: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [sending, startSending] = useTransition();
  const [reporting, startReporting] = useTransition();
  const [statusPending, startStatus] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  function send() {
    const message = draft.trim();
    if (!message || sending) return;
    startSending(async () => {
      const res = await sendAuditMessage({ auditId, message });
      if (res?.error) toast.error(res.error);
      else setDraft("");
    });
  }

  return (
    <Tabs defaultValue="conversation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="conversation">
            <MessageSquare className="size-4" /> Conversation
          </TabsTrigger>
          <TabsTrigger value="report">
            <FileText className="size-4" /> Report
            {report && <span className="ml-1 size-1.5 rounded-full bg-brand" />}
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2">
          <Select
            value={status}
            disabled={statusPending}
            onValueChange={(next) =>
              startStatus(async () => {
                const res = await setAuditStatus({
                  auditId,
                  status: next as (typeof STATUSES)[number],
                });
                if (res?.error) toast.error(res.error);
              })
            }
          >
            <SelectTrigger className="w-36 capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="secondary"
            disabled={reporting || messages.length === 0}
            onClick={() =>
              startReporting(async () => {
                const res = await generateAuditReport({ auditId });
                if (res?.error) toast.error(res.error);
                else toast.success("Report generated — see the Report tab");
              })
            }
          >
            {reporting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Working…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                {report ? "Regenerate report" : "Generate report"}
              </>
            )}
          </Button>
        </div>
      </div>

      <TabsContent value="conversation" className="mt-4 space-y-4">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Tell the copilot what you know or what the prospect said —
                  it will analyze the pain, do the ROI math, and suggest what
                  to ask next.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg px-4 py-3 text-sm",
                    m.role === "user"
                      ? "ml-8 bg-primary text-primary-foreground"
                      : "mr-8 border bg-muted/40",
                  )}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              ))}
              {sending && (
                <div className="mr-8 flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Analyzing…
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex items-end gap-2 border-t pt-4">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={3}
                maxLength={20000}
                placeholder='e.g. "He spends every Sunday doing quotes in Excel, about 5 hours. Loses maybe 1 in 3 jobs because he quotes too slow." (Ctrl+Enter to send)'
                disabled={sending}
              />
              <Button onClick={send} disabled={sending || !draft.trim()}>
                <Send className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="report" className="mt-4">
        <Card>
          <CardContent className="p-6">
          {report ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{report}</ReactMarkdown>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No report yet. Have the discovery conversation, then hit
              &ldquo;Generate report&rdquo; — you&apos;ll get the client-facing
              health check and your internal build spec.
            </p>
          )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
