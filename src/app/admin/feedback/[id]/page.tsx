import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Lock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import {
  FeedbackKindChip,
  FeedbackStatusChip,
} from "@/components/app/feedback-chips";
import { AttachmentList } from "@/components/app/attachment-list";
import { requireSuperAdmin } from "@/lib/auth";
import { getReportForConsole } from "@/lib/feedback/read";
import {
  formatWhen,
  fullRoute,
  isSameOriginPath,
  needsOperator,
  screenLabel,
} from "@/lib/feedback/core";
import { cn } from "@/lib/utils";
import { ConsoleReply, MarkSeenButton, TriageControls } from "../controls";

export const dynamic = "force-dynamic";

/** One fact about where the report came from. */
function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm" title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * ONE REPORT, THE WHOLE THREAD — internal notes included, which is what makes
 * this page different from the client's copy of the same conversation.
 *
 * `requireSuperAdmin()` on the page as well as the layout: same reasoning as
 * the list. The read is `withSystem` and spans every workspace, so the gate
 * must be attached to the thing that reads, not inherited from a file
 * somebody may later move.
 */
export default async function AdminFeedbackThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;
  const found = await getReportForConsole(id);
  if (!found) notFound();
  const { report, messages, userAgent, viewport } = found;
  // THE CLIENT'S CLOCK, not ours. Somebody writing "this happened at 8am"
  // means 8am where they were standing.
  const zone = report.tenantTimezone;
  const where = fullRoute(report.route, report.routeQuery);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/feedback"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Feedback
      </Link>

      <PageHeader
        title={report.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <FeedbackStatusChip status={report.status} side="operator" />
            <FeedbackKindChip kind={report.kind} side="operator" />
            <span>
              <Link
                href={`/admin/tenants/${report.tenantId}`}
                className="font-medium underline underline-offset-2"
              >
                {report.tenantName}
              </Link>
              {report.isOperatorTenant && " (us)"} ·{" "}
              {/* Name AND address only when we have both. A workspace whose
                  members have never set a name renders `profiles.name` empty,
                  and the first version printed "somebody · them@example.com" —
                  a placeholder standing next to the answer it was standing in
                  for. The list page's fallback chain, copied. */}
              {report.reporterName
                ? `${report.reporterName}${report.reporterEmail ? ` · ${report.reporterEmail}` : ""}`
                : report.reporterEmail || "somebody"}
            </span>
          </span>
        }
        actions={needsOperator(report) ? <MarkSeenButton reportId={report.id} /> : null}
      />

      {/* WHAT THE BUTTON KNEW, which is the half of a bug report nobody types
          well. `route` is a string a browser handed us, so it is a link only
          once `isSameOriginPath` agrees — and a link into the CLIENT's
          workspace is not one this console can follow anyway without a support
          view, so it is rendered as the path it is. */}
      <Panel className="p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Screen" value={screenLabel(report.route)} />
          <Fact
            label="Path"
            value={isSameOriginPath(where) ? where : `${where} (not a path)`}
          />
          <Fact
            label="Where from"
            value={
              report.surface === "app"
                ? `Mobile app ${report.appVersion || "(no version)"}`
                : "Browser"
            }
          />
          <Fact label="Viewport" value={viewport} />
          {/* No "Module" row. `feature_slug` is stored and is what the list
              groups by, but showing it here said "accounting" directly under a
              Screen reading "Accounting" — two facts that look like a
              disagreement and are the same word twice. The slug is in `Path`
              anyway, in full, on hover. */}
          <Fact label="Sent" value={formatWhen(report.createdAt, zone)} />
          <div className="col-span-2 min-w-0 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Browser</dt>
            <dd className="truncate text-sm" title={userAgent}>
              {userAgent || "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          To see this screen the way they see it, open a{" "}
          <Link
            href={`/admin/tenants/${report.tenantId}`}
            className="underline underline-offset-2"
          >
            support view
          </Link>{" "}
          of {report.tenantName} — read-only, time-limited, and it says so on
          every page they load.
        </p>
      </Panel>

      <Panel className="divide-y divide-divider">
        {messages.map((message) => {
          const ours = message.side === "operator";
          return (
            <div
              key={message.id}
              className={cn(
                "px-4 py-3",
                // An internal note is tinted the whole width of the row. A
                // small "internal" tag would be a thing to miss, and the cost
                // of missing it is pasting a private note into a reply.
                message.internal && "bg-warning/5",
              )}
            >
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {message.internal && (
                  <Lock className="size-3 text-warning-foreground" />
                )}
                <span
                  className={cn(
                    "font-medium",
                    ours ? "text-primary" : "text-foreground",
                  )}
                >
                  {message.internal
                    ? `${message.authorName || "Note"} — internal`
                    : ours
                      ? "Yosher"
                      : message.authorName || "Client"}
                </span>
                {" · "}
                {formatWhen(message.createdAt, zone)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
              <AttachmentList attachments={message.attachments} />
            </div>
          );
        })}
      </Panel>

      <Panel className="space-y-4 p-4">
        <ConsoleReply reportId={report.id} status={report.status} />
        <div className="border-t border-border pt-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Move it without saying anything — the client sees the status on
            their own copy, and nothing is written into the conversation.
          </p>
          <TriageControls
            reportId={report.id}
            status={report.status}
            kind={report.kind}
          />
        </div>
      </Panel>
    </div>
  );
}
