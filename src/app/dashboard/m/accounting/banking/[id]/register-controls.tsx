"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  acceptSuggestionsAction,
  categorizeTransactionAction,
  excludeTransactionAction,
  restoreTransactionAction,
  suggestCategoriesAction,
} from "@/modules/accounting/banking/actions";
import { formatCents } from "@/modules/accounting/lib/money";

const ACCEPT_THRESHOLD = 0.7;

export function SuggestButton({
  bankAccountId,
  disabled,
}: {
  bankAccountId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await suggestCategoriesAction({ bankAccountId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { requested, returned } = result.data!;
      toast.success(
        requested === 0
          ? "Nothing new to suggest"
          : `Suggested categories for ${returned} of ${requested} transactions`,
      );
      router.refresh();
    });
  }

  return (
    <Button size="sm" onClick={run} disabled={disabled || pending}>
      <Sparkles className="mr-1.5 size-4" />
      {pending ? "Thinking…" : "Suggest categories"}
    </Button>
  );
}

export function RegisterTabs({
  bankAccountId,
  active,
  counts,
}: {
  bankAccountId: string;
  active: "unreviewed" | "all" | "excluded";
  counts: { unreviewed: number; all: number; excluded: number };
}) {
  const tabs = [
    { key: "unreviewed", label: `To review (${counts.unreviewed})` },
    { key: "all", label: `All (${counts.all})` },
    { key: "excluded", label: `Excluded (${counts.excluded})` },
  ] as const;
  return (
    <div className="flex gap-1 border-b pb-px print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`/dashboard/m/accounting/banking/${bankAccountId}?tab=${t.key}`}
          className={cn(
            "rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium",
            active === t.key
              ? "border-brand text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

interface ReviewRow {
  id: string;
  txnDate: string;
  description: string;
  amountCents: number;
  status: string;
  journalEntryId: string | null;
  source: string;
  suggestion: {
    accountId: string;
    accountCode: string;
    confidence: number;
    reason: string | null;
  } | null;
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

export function ReviewTable({
  tab,
  rows,
  categories,
  canAct,
}: {
  tab: "unreviewed" | "all" | "excluded";
  rows: ReviewRow[];
  categories: CategoryOption[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const acceptable = rows.filter(
    (r) =>
      r.status === "unreviewed" &&
      r.suggestion &&
      r.suggestion.confidence >= ACCEPT_THRESHOLD,
  );

  function categorize(row: ReviewRow) {
    const accountId = chosen[row.id] ?? row.suggestion?.accountId;
    if (!accountId) {
      toast.error("Pick a category first");
      return;
    }
    setBusyId(row.id);
    startTransition(async () => {
      const result = await categorizeTransactionAction({
        transactionId: row.id,
        accountId,
      });
      if ("error" in result) toast.error(result.error);
      else toast.success("Posted");
      setBusyId(null);
      router.refresh();
    });
  }

  function exclude(row: ReviewRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await excludeTransactionAction({ transactionId: row.id });
      if ("error" in result) toast.error(result.error);
      setBusyId(null);
      router.refresh();
    });
  }

  function restore(row: ReviewRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await restoreTransactionAction({ transactionId: row.id });
      if ("error" in result) toast.error(result.error);
      setBusyId(null);
      router.refresh();
    });
  }

  function acceptAll() {
    startTransition(async () => {
      const result = await acceptSuggestionsAction({
        transactionIds: acceptable.map((r) => r.id).slice(0, 50),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { posted, skipped, firstError } = result.data!;
      toast.success(
        `Posted ${posted}${skipped > 0 ? `, skipped ${skipped}` : ""}${firstError ? ` — ${firstError}` : ""}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canAct && tab === "unreviewed" && acceptable.length > 0 && (
        <div className="flex justify-end print:hidden">
          <Button size="sm" variant="outline" onClick={acceptAll} disabled={pending}>
            Accept {acceptable.length} suggestion{acceptable.length === 1 ? "" : "s"} (≥
            {Math.round(ACCEPT_THRESHOLD * 100)}%)
          </Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  {tab === "all" && <TableHead>Status</TableHead>}
                  {tab !== "all" && canAct && (
                    <TableHead className="min-w-56">Category</TableHead>
                  )}
                  {canAct && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {row.txnDate}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="block truncate text-sm">{row.description}</span>
                      {row.status === "unreviewed" && row.suggestion && (
                        <span
                          className={cn(
                            "mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                            row.suggestion.confidence >= ACCEPT_THRESHOLD
                              ? "bg-brand/10 text-brand"
                              : "bg-muted text-muted-foreground",
                          )}
                          title={row.suggestion.reason ?? undefined}
                        >
                          <Sparkles className="size-3" />
                          {row.suggestion.accountCode} ·{" "}
                          {Math.round(row.suggestion.confidence * 100)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.amountCents > 0 ? formatCents(row.amountCents) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.amountCents < 0 ? formatCents(-row.amountCents) : ""}
                    </TableCell>
                    {tab === "all" && (
                      <TableCell>
                        {row.status === "posted" && row.journalEntryId ? (
                          <Link
                            className="text-sm underline underline-offset-2"
                            href={`/dashboard/m/accounting/journal/${row.journalEntryId}`}
                          >
                            posted
                          </Link>
                        ) : (
                          <Badge variant={row.status === "excluded" ? "outline" : "secondary"}>
                            {row.status}
                          </Badge>
                        )}
                      </TableCell>
                    )}
                    {tab !== "all" && canAct && (
                      <TableCell>
                        {row.status === "unreviewed" && (
                          <Select
                            value={chosen[row.id] ?? row.suggestion?.accountId ?? undefined}
                            onValueChange={(v) =>
                              setChosen((c) => ({ ...c, [row.id]: v }))
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Pick category" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.code} · {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    )}
                    {canAct && (
                      <TableCell className="whitespace-nowrap text-right">
                        {row.status === "unreviewed" && tab === "unreviewed" && (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              className="h-8"
                              disabled={pending && busyId === row.id}
                              onClick={() => categorize(row)}
                            >
                              Post
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              disabled={pending && busyId === row.id}
                              onClick={() => exclude(row)}
                            >
                              Exclude
                            </Button>
                          </div>
                        )}
                        {row.status === "excluded" && tab === "excluded" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={pending && busyId === row.id}
                            onClick={() => restore(row)}
                          >
                            Restore
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
