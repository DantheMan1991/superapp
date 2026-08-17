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
  /**
   * Set when this account is a REGISTER, naming the company that owns it
   * (ADR 0010). Undefined for every ordinary chart account, which is most of
   * them — AR, AP and the expense accounts are shared, and only a register has
   * an owner.
   */
  registerEntityId?: string;
}

export interface EditorEntry {
  id: string;
  version: number;
  /** Read-only here: shown on an edit, never changed. */
  entityId?: string;
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
  entities,
  defaultEntityId,
  entry,
  canPost,
  today,
}: {
  accounts: EditorAccount[];
  /**
   * The tenant's legal entities (ADR 0010). The control renders only at TWO or
   * more — the single-company client never learns the concept.
   *
   * The journal is the ONE write path in slice 1 that can choose: an invoice, a
   * bill and a bank row have no company of their own yet, so they land in the
   * default. That makes a hand-written journal the way a two-company tenant
   * puts anything into the second set of books today.
   */
  entities?: Array<{ id: string; name: string }>;
  defaultEntityId?: string;
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
  // An EXISTING entry's company is fixed — moving a posted entry between two
  // balance sheets is a transfer to record, not a field to edit — so the
  // control is only offered when creating.
  const [entityId, setEntityId] = useState(entry?.entityId ?? defaultEntityId ?? "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [rows, setRows] = useState<LineRow[]>(
    entry ? entry.lines.map(rowFromLine) : [emptyRow(), emptyRow()],
  );
  // One key per editor mount: double-clicks and retries post exactly once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  /**
   * The account the server refused, and why.
   *
   * A toast says the entry was rejected; on a twelve-line journal it does not
   * say WHICH line to fix, and the account list is long enough that hunting is
   * real work. The server sends the account id back for exactly this.
   */
  const [rejected, setRejected] = useState<{ accountId: string; message: string } | null>(null);

  /**
   * A register owned by ANOTHER company is not offered at all.
   *
   * `postEntry` refuses such a line anyway, so this is not what makes the
   * ledger safe — it is what stops the form offering a choice that always
   * fails, the same fix the invoice's Deposit-to picker got. Everything else in
   * the chart stays: a journal has to be able to name any account, and only a
   * register is owned.
   */
  const selectableAccounts = accounts.filter(
    (a) => !a.registerEntityId || !entityId || a.registerEntityId === entityId,
  );

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
    setRejected(null);
  }

  /**
   * Changing the company clears any line that had picked a register belonging
   * to the company you just left. Leaving it selected would show an account
   * that is no longer in the list — a stale value the dropdown cannot even
   * render a label for.
   */
  function chooseEntity(next: string) {
    setEntityId(next);
    setRejected(null);
    setRows((rs) =>
      rs.map((r) => {
        const acct = accounts.find((a) => a.id === r.accountId);
        return acct?.registerEntityId && acct.registerEntityId !== next
          ? { ...r, accountId: "" }
          : r;
      }),
    );
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
            entityId: entityId || undefined,
            entryDate,
            memo: memo.trim() || undefined,
            idempotencyKey,
            lines,
          });
      if ("error" in result) {
        // The toast still fires — it is what tells you something happened at
        // all. `accountId` adds WHERE, which the toast cannot.
        toast.error(result.error);
        if (result.accountId) {
          setRejected({ accountId: result.accountId, message: result.error });
        }
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
        {!entry && entities && entities.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="entry-entity">Company</Label>
            <Select value={entityId || undefined} onValueChange={chooseEntity}>
              <SelectTrigger id="entry-entity" className="h-9 w-full sm:w-72">
                <SelectValue placeholder="Which company's books?" />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
              // The line the server named, if it named one.
              const refused = rejected?.accountId === row.accountId;
              return (
                <div key={row.key} className="space-y-1">
                <div
                  className="grid grid-cols-[1fr_120px_120px_1fr_32px] items-center gap-2"
                >
                  <Select
                    value={row.accountId || undefined}
                    onValueChange={(v) => setRow(row.key, { accountId: v })}
                  >
                    <SelectTrigger
                      className={`h-9 ${refused ? "border-destructive" : ""}`}
                    >
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableAccounts.map((a) => (
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
                {refused && (
                  <p className="text-xs text-destructive">{rejected!.message}</p>
                )}
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
