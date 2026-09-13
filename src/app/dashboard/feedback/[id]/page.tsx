import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import {
  FeedbackKindChip,
  FeedbackStatusChip,
} from "@/components/app/feedback-chips";
import { requireTenant } from "@/lib/auth";
import { getMyReport } from "@/lib/feedback/read";
import {
  formatWhen,
  fullRoute,
  isClosedStatus,
  isSameOriginPath,
  screenLabel,
} from "@/lib/feedback/core";
import { cn } from "@/lib/utils";
import { MarkRead, ReplyBox } from "../thread";

export const dynamic = "force-dynamic";

/**
 * ONE REPORT AND ITS CONVERSATION, the reporter's copy.
 *
 * `getMyReport` returns null for a report that is not theirs — including one in
 * another workspace, which RLS refuses before the query's own clause gets a
 * look — and null is a 404 rather than a message, because "that is not yours"
 * and "that does not exist" should be indistinguishable from outside.
 */
export default async function FeedbackThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  const found = await getMyReport(ctx, id);
  if (!found) notFound();
  const { report, messages } = found;
  const zone = ctx.tenant.timezone;
  const where = fullRoute(report.route, report.routeQuery);
  const closed = isClosedStatus(report.status);

  return (
    <div className="space-y-6">
      <MarkRead reportId={report.id} />

      <Link
        href="/dashboard/feedback"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Your reports
      </Link>

      <PageHeader
        title={report.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <FeedbackKindChip kind={report.kind} side="client" />
            <FeedbackStatusChip status={report.status} side="client" />
            <span>
              Sent {formatWhen(report.createdAt, zone)} from{" "}
              {/* The route is a string the browser handed us. Rendered as a
                  link only once `isSameOriginPath` agrees it is one — a
                  protocol-relative "//somewhere" would otherwise be a link off
                  the site, on a page the user themselves filled in. */}
              {isSameOriginPath(where) ? (
                <Link href={where} className="underline underline-offset-2">
                  {screenLabel(report.route)}
                </Link>
              ) : (
                screenLabel(report.route)
              )}
            </span>
          </span>
        }
      />

      <Panel className="divide-y divide-divider">
        {messages.map((message) => {
          const mine = message.side === "client";
          return (
            <div key={message.id} className="px-4 py-3">
              <p className="text-xs text-muted-foreground">
                <span
                  className={cn(
                    "font-medium",
                    mine ? "text-foreground" : "text-primary",
                  )}
                >
                  {mine ? (message.authorName || "You") : "Yosher"}
                </span>
                {" · "}
                {formatWhen(message.createdAt, zone)}
              </p>
              {/* `whitespace-pre-wrap`, not markdown: this is what somebody
                  typed into a box, and rendering it as markup would let a
                  stray underscore eat half a sentence. */}
              <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
            </div>
          );
        })}
      </Panel>

      {/* A CLOSED REPORT STILL TAKES A REPLY. "It is still happening" is the
          most valuable sentence this box ever receives, and a thread that locks
          on `done` is a thread that never hears it. The console sees the reply
          as waiting on us whatever the status says (see `needsOperator`). */}
      <div className="space-y-2">
        {closed && (
          <p className="text-sm text-muted-foreground">
            We marked this{" "}
            {report.status === "done" ? "done" : "not planned"}. If that is not
            right, say so — we will pick it back up.
          </p>
        )}
        <ReplyBox reportId={report.id} />
      </div>
    </div>
  );
}
