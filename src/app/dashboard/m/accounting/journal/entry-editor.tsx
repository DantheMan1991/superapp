"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEntry, updateEntry } from "@/modules/accounting/actions";
import {
  formatCents,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export interface EditorAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

export interface EditorEntry {
  id: string;
  version: number;
  entryDate: string;
  memo: string;
  lines: Array<{ accountId: string; amountCents: number; memo: string }>;
}

interface LineRow {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

function emptyRow(): LineRow {
  return { key: crypto.randomUUID(), accountId: "", debit: "", credit: "", memo: "" };
}

function rowFromLine(l: EditorEntry["lines"][number]): LineRow {
  return {
    key: crypto.randomUUID(),
    accountId: l.accountId,
    debit: l.amountCents > 0 ? formatCents(l.amountCents).replaceAll(",", "") : "",
    credit: l.amountCents < 0 ? formatCents(-l.amountCents).replaceAll(",", "") : "",
    memo: l.memo,
  };
}

/** Signed cents for a row; null when unparseable, 0 when empty. */
function rowCents(row: LineRow): number | null {
  if (row.debit === "" && row.credit === "") return 0;
  if (row.debit !== "") {
    const c = parseMoneyToCents(row.debit);
    return c === null || c === 0 ? null : c;
  }
  const c = parseMoneyToCents(row.credit);
  return c === null || c === 0 ? null : -c;
}

export function EntryEditor({
  accounts,
  entry,
  canPost,
  today,
}: {
  accounts: EditorAccount[];
  /** When set, the editor edits this entry instead of creating a new one. */
  entry?: EditorEntry;
  /** Owners can post; staff can only save drafts. */
  canPost: boolean;
  /** Today in the tenant's bookkeeping timezone (server-computed). */
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? today);
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [rows, setRows] = useState<LineRow[]>(
    entry ? entry.lines.map(rowFromLine) : [emptyRow(), emptyRow()],
  );
  // One key per editor mount: double-clicks and retries post exactly once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const filled = rows.filter((r) => r.accountId !== "" || r.debit !== "" || r.credit !== "");
  const parsed = filled.map((r) => ({ row: r, cents: rowCents(r) }));
  const invalid = parsed.some(
    (p) => p.cents === null || (p.cents !== 0 && p.row.accountId === ""),
  );
  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const p of parsed) {
      if (p.cents === null) continue;
      if (p.cents > 0) debit += p.cents;
      else credit += -p.cents;
    }
    return { debit, credit, diff: debit - credit };
  }, [parsed]);

  const completeLines = parsed.filter(
    (p) => p.cents !== null && p.cents !== 0 && p.row.accountId !== "",
  );
  const canSaveDraft = completeLines.length >= 1 && !invalid;
  const balanced = totals.diff === 0 && completeLines.length >= 2;
  const canSubmitPost = canPost && balanced && !invalid;

  function setRow(key: string, patch: Partial<LineRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function submit(status: "draft" | "posted") {
    const lines = completeLines.map((p) => ({
      accountId: p.row.accountId,
      amountCents: p.cents!,
      memo: p.row.memo.trim() || undefined,
    }));
    startTransition(async () => {
      const result = entry
        ? await updateEntry({
            entryId: entry.id,
            expectedVersion: entry.version,
            patch: { entryDate, memo: memo.trim(), lines },
          })
        : await createEntry({
            status,
            entryDate,
            memo: memo.trim() || undefined,
            idempotencyKey,
            lines,
          });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        entry ? "Entry updated" : status === "posted" ? "Entry posted" : "Draft saved",
      );
      router.push("/dashboard/m/accounting/journal");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="entry-date">Date</Label>
            <Input
              id="entry-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="entry-memo">Memo</Label>
            <Input
              id="entry-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="What is this entry for?"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[560px] space-y-2">
            <div className="grid grid-cols-[1fr_120px_120px_1fr_32px] gap-2 text-xs font-medium text-muted-foreground">
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span>Line memo</span>
              <span />
            </div>
            {rows.map((row) => {
              const cents = rowCents(row);
              const bad = cents === null;
              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[1fr_120px_120px_1fr_32px] items-center gap-2"
                >
                  <Select
                    value={row.accountId || undefined}
                    onValueChange={(v) => setRow(row.key, { accountId: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    inputMode="decimal"
                    className={`h-9 text-right font-mono ${bad && row.debit !== "" ? "border-destructive" : ""}`}
                    value={row.debit}
                    placeholder="0.00"
                    onChange={(e) =>
                      setRow(row.key, { debit: e.target.value, credit: "" })
                    }
                  />
                  <Input
                    inputMode="decimal"
                    className={`h-9 text-right font-mono ${bad && row.credit !== "" ? "border-destructive" : ""}`}
                    value={row.credit}
                    placeholder="0.00"
                    onChange={(e) =>
                      setRow(row.key, { credit: e.target.value, debit: "" })
                    }
                  />
                  <Input
                    className="h-9"
                    value={row.memo}
                    onChange={(e) => setRow(row.key, { memo: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={rows.length <= 2}
                    onClick={() =>
                      setRows((rs) => rs.filter((r) => r.key !== row.key))
                    }
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Remove line</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((rs) => [...rs, emptyRow()])}
        >
          <Plus className="mr-1.5 size-4" /> Add line
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex items-center gap-4 font-mono text-sm">
            <span>Dr {formatCents(totals.debit)}</span>
            <span>Cr {formatCents(totals.credit)}</span>
            {balanced ? (
              <span className="font-sans text-xs font-medium text-emerald-600">
                Balanced
              </span>
            ) : (
              <span className="font-sans text-xs font-medium text-destructive">
                Off by {formatCents(Math.abs(totals.diff))}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {!entry && (
              <Button
                type="button"
                variant="outline"
                disabled={pending || !canSaveDraft}
                onClick={() => submit("draft")}
              >
                Save draft
              </Button>
            )}
            {entry ? (
              <Button
                type="button"
                disabled={pending || invalid || completeLines.length < 1}
                onClick={() => submit("draft")}
              >
                {pending ? "Saving…" : "Save changes"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={pending || !canSubmitPost}
                onClick={() => submit("posted")}
                title={canPost ? undefined : "Only the business owner can post"}
              >
                {pending ? "Posting…" : "Post entry"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
