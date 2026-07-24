import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, CircleAlert, PenLine } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  LedgerError,
  getClose,
  type CloseChecklist,
} from "@/modules/accounting/core";
import type { CloseNarrative } from "@/modules/accounting/ai/narrative-validate";
import {
  AddNoteForm,
  GenerateNarrativeButton,
  SignOffButton,
} from "./review-controls";

export const dynamic = "force-dynamic";

export default async function CloseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let data;
  try {
    data = await withTenant(ctx.tenant.id, async (tx) => {
      const { close, notes } = await getClose(tx, ctx.tenant.id, id);
      const userIds = [
        ...new Set(
          [close.completedByClerkUserId, close.signedOffByClerkUserId,
           close.reopenedByClerkUserId].filter((v): v is string => !!v),
        ),
      ];
      const people = userIds.length
        ? await tx
            .select({
              clerkUserId: schema.profiles.clerkUserId,
              name: schema.profiles.name,
              email: schema.profiles.email,
            })
            .from(schema.profiles)
            .where(inArray(schema.profiles.clerkUserId, userIds))
        : [];
      return { close, notes, people };
    });
  } catch (err) {
    if (err instanceof LedgerError && err.code === "CLOSE_NOT_FOUND") notFound();
    throw err;
  }

  const { close, notes } = data;
  const who = (clerkUserId: string | null): string => {
    if (!clerkUserId) return "";
    const p = data.people.find((x) => x.clerkUserId === clerkUserId);
    return p?.name || p?.email || "member";
  };

  const checklist = close.checklist as unknown as CloseChecklist;
  const narrative = close.narrative as unknown as CloseNarrative | null;
  const canReview = ctx.role === "owner" || ctx.role === "expert";
  const completed = close.status === "completed";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link
              href="/dashboard/m/accounting/close"
              className="underline-offset-2 hover:underline"
            >
              Close
            </Link>{" "}
            / {close.periodEnd}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Close through {close.periodEnd}
          </h1>
          <p className="text-sm text-muted-foreground">
            Completed by {who(close.completedByClerkUserId)} on{" "}
            {close.completedAt.toISOString().slice(0, 10)}
            {close.status === "reopened" &&
              ` · reopened by ${who(close.reopenedByClerkUserId)}${
                close.reopenedAt
                  ? ` on ${close.reopenedAt.toISOString().slice(0, 10)}`
                  : ""
              }`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {completed ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600">Completed</Badge>
          ) : (
            <Badge variant="secondary">Reopened</Badge>
          )}
          {close.signedOffAt && (
            <Badge variant="outline">
              <PenLine className="mr-1 h-3 w-3" />
              Signed off · {who(close.signedOffByClerkUserId)}
            </Badge>
          )}
        </div>
      </div>

      <AccountingNav />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Checklist snapshot</CardTitle>
              <CardDescription>
                As recorded when the books were closed
                {checklist?.computedAt
                  ? ` (${checklist.computedAt.slice(0, 10)})`
                  : ""}
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {(checklist?.items ?? []).map((item) => (
                  <li key={item.key} className="flex items-center gap-2.5 py-2">
                    {item.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <span className="text-sm">
                      {item.label}
                      {!item.ok && item.count > 0 && (
                        <span className="ml-1.5 font-medium">({item.count})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Review</CardTitle>
                <CardDescription>
                  Sign-off and notes — the owner ↔ accountant dialogue.
                </CardDescription>
              </div>
              {canReview && completed && !close.signedOffAt && (
                <SignOffButton closeId={close.id} version={close.version} />
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <ul className="space-y-3">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        {n.authorName || n.authorEmail || "member"} ·{" "}
                        {n.createdAt.toISOString().slice(0, 10)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {canReview && <AddNoteForm closeId={close.id} />}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Close narrative</CardTitle>
              <CardDescription>
                {narrative
                  ? `Generated ${
                      close.narrativeGeneratedAt
                        ? close.narrativeGeneratedAt.toISOString().slice(0, 10)
                        : ""
                    } · ${close.narrativeModel ?? ""} — AI-written, review before relying on it.`
                  : "A plain-English summary of the period, written by AI."}
              </CardDescription>
            </div>
            {canReview && completed && (
              <GenerateNarrativeButton
                closeId={close.id}
                hasNarrative={!!narrative}
              />
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!narrative ? (
              <p className="text-sm text-muted-foreground">
                No narrative yet.
                {completed
                  ? " Generate one to get the month in plain English."
                  : ""}
              </p>
            ) : (
              <>
                {narrative.highlights.length > 0 && (
                  <ul className="space-y-1.5">
                    {narrative.highlights.map((h, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{h.title}</span>
                        {h.detail && (
                          <span className="text-muted-foreground"> — {h.detail}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{narrative.narrative}</ReactMarkdown>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/m/accounting/close">Back to Close</Link>
        </Button>
      </div>
    </div>
  );
}
