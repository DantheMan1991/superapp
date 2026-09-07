"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filter, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox, type ComboboxOption } from "@/components/app/combobox";
import { DataTable } from "@/components/app/data-table";
import {
  DimensionTags,
  type DimensionTypeOption,
} from "@/components/app/dimension-tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  acceptSuggestionsAction,
  categorizeTransactionAction,
  splitTransactionAction,
  excludeTransactionAction,
  matchTransactionToEntryAction,
  restoreTransactionAction,
  setBankAccountActiveAction,
  suggestCategoriesAction,
  undoCategorizeTransactionAction,
  unmatchTransactionAction,
} from "@/modules/accounting/banking/actions";
import { formatCents, parseMoneyToCents } from "@/modules/accounting/lib/money";
import { useConfirm } from "@/components/app/use-confirm";

const ACCEPT_THRESHOLD = 0.7;

/**
 * How long the Undo stays on a "Posted" or "Excluded" toast. Long enough to
 * read the message and change your mind, short enough that the toast is gone
 * before the next row's arrives on top of it.
 */
const UNDO_WINDOW_MS = 8_000;

/**
 * Close a register, or reopen one.
 *
 * `setBankAccountActiveAction` has existed since session 3 and NOTHING called
 * it, so `is_active` could only be changed by reaching into the database —
 * which is how a closed account with four rows stuck in "to review", no way to
 * reconcile and no way back was found in the first place. A state the app can
 * enter and cannot leave is worse than a state it does not have.
 */
export function BankAccountActiveToggle({
  bankAccountId,
  version,
  active,
}: {
  bankAccountId: string;
  version: number;
  active: boolean;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  async function toggle() {
    const asked = active
      ? await confirm({
          title: "Close this account?",
          description:
            "Nothing is deleted and no balance changes — the account stops taking new transactions, imports and reconciliations. You can reopen it whenever you like.",
          confirmLabel: "Close account",
        })
      : await confirm({
          title: "Reopen this account?",
          description:
            "It starts taking new transactions, imports and reconciliations again.",
          confirmLabel: "Reopen account",
        });
    if (!asked) return;
    startTransition(async () => {
      const result = await setBankAccountActiveAction({
        bankAccountId,
        expectedVersion: version,
        active: !active,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(active ? "Account closed" : "Account reopened");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={toggle} disabled={pending}>
        {active ? "Close account" : "Reopen account"}
      </Button>
      {confirmDialog}
    </>
  );
}

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
  term = "",
}: {
  bankAccountId: string;
  active: "unreviewed" | "all" | "excluded";
  counts: { unreviewed: number; all: number; excluded: number };
  /** The search term in force, carried from tab to tab; the page is not. */
  term?: string;
}) {
  const q = term ? `&q=${encodeURIComponent(term)}` : "";
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
          href={`/dashboard/m/accounting/banking/${bankAccountId}?tab=${t.key}${q}`}
          className={cn(
            "rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium",
            active === t.key
              ? "border-module-accent text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

interface MatchCandidate {
  entryId: string;
  entryDate: string;
  memo: string;
  source: string;
  label: string;
}

/** One line of a split being drafted: the category and the amount as typed. */
interface SplitDraftLine {
  key: string;
  accountId: string;
  amount: string;
}

interface ReviewRow {
  id: string;
  attachmentCount: number;
  txnDate: string;
  description: string;
  amountCents: number;
  status: string;
  journalEntryId: string | null;
  /**
   * True when this row POSTED its entry (a categorization), false when it
   * only matched one — a payment, a hand-written entry, the other side of a
   * transfer. Decides which road back is offered: a posting is undone by
   * voiding, a match by Unmatch.
   */
  postedHere: boolean;
  source: string;
  suggestion: {
    accountId: string;
    accountCode: string;
    confidence: number;
    reason: string | null;
  } | null;
  ruleSuggestion: {
    ruleName: string;
    accountId: string;
    accountCode: string;
  } | null;
  /** Who was paid, once a rule or a person has said so. */
  payee: string | null;
  matchCandidates: MatchCandidate[];
}

/**
 * A rule beats the model. It is a decision the owner already made, it cannot
 * drift between runs, and it can say why — so where both have an opinion, the
 * rule is the one shown and the one the Accept button would post.
 */
function preferredAccountId(row: ReviewRow): string | undefined {
  return row.ruleSuggestion?.accountId ?? row.suggestion?.accountId;
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

/** The RULE or AI chip under a description, or nothing. Rule first. */
function suggestionChip(row: ReviewRow): ReactNode {
  if (row.status !== "unreviewed") return null;
  if (row.ruleSuggestion) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-module-accent/10 px-2 py-0.5 text-[11px] text-module-accent"
        title={row.ruleSuggestion.ruleName}
      >
        <Filter className="size-3" />
        RULE · {row.ruleSuggestion.accountCode}
      </span>
    );
  }
  if (row.suggestion) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
          row.suggestion.confidence >= ACCEPT_THRESHOLD
            ? "bg-module-accent/10 text-module-accent"
            : "bg-muted text-muted-foreground",
        )}
        title={row.suggestion.reason ?? undefined}
      >
        <Sparkles className="size-3" />
        AI · {row.suggestion.accountCode} ·{" "}
        {Math.round(row.suggestion.confidence * 100)}%
      </span>
    );
  }
  return null;
}

/** On `All`: a link to the entry for a posted row, a badge otherwise. */
function statusMark(row: ReviewRow): ReactNode {
  return row.status === "posted" && row.journalEntryId ? (
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
  );
}

/**
 * The review queue: a table on a wide screen, a card per transaction on a
 * phone.
 *
 * **BOTH LAYOUTS RENDER FROM ONE SET OF STATE, AND CSS PICKS.** The table is
 * about 700px wide with its category picker and buttons, and the phone the
 * founder reads this on is 375px, so those two columns sat off the right edge
 * and were reachable only by dragging sideways — measured in the Browser pane,
 * not guessed. A `matchMedia` hook would render one layout, but its server
 * snapshot has to assume a width, and the wrong assumption flashes the table
 * on exactly the device this exists for. `md:hidden` and `hidden md:block`
 * cost a second subtree per row and no flash; `chosen` and `tags` are keyed by
 * row id, so a category picked in one layout is still picked after a rotation
 * into the other.
 *
 * `md`, not `sm`: below `lg` the rail is a drawer and the content column is
 * the viewport, so at 768px the table has the 720px it needs and at 640px it
 * does not.
 */
interface TransferTarget {
  /** The other register's LEDGER account — what the transfer line is coded to. */
  accountId: string;
  name: string;
}

export function ReviewTable({
  tab,
  rows,
  categories,
  transferTargets,
  dimensionTypes,
  canAct,
}: {
  tab: "unreviewed" | "all" | "excluded";
  rows: ReviewRow[];
  categories: CategoryOption[];
  /**
   * The same company's other registers. Offered at the end of the category
   * list as `Transfer to …` on a money-out row and `Transfer from …` on a
   * money-in row; posting one writes the transfer entry, and the other
   * register's row then MATCHES it instead of posting again.
   */
  transferTargets: TransferTarget[];
  /** Active members, grouped by type. Empty renders no tag control at all. */
  dimensionTypes: DimensionTypeOption[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  /**
   * **PER ROW, and keyed the same way `chosen` is.** Categorising is a list
   * activity — a person works down twenty rows without leaving the page — so the
   * tags have to belong to a row rather than to the table, exactly as the
   * category selection already does.
   */
  const [tags, setTags] = useState<Record<string, string[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * `keywords` carries the account type so "expense" or "income" narrows the
   * list too, the way the chart of accounts page groups it. The code is in the
   * label, so "63" finds the 6300s without a second field.
   */
  const categoryOptions = useMemo<ComboboxOption[]>(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: `${c.code} · ${c.name}`,
        keywords: c.accountType.replaceAll("_", " "),
      })),
    [categories],
  );
  /**
   * Two lists, one per direction, so the label says what the posting will
   * mean: money leaving this account and arriving in Savings is "Transfer to
   * Savings" here and "Transfer from Checking" over there. Last in the list —
   * the ordinary categories stay first, and "trans" finds these.
   */
  const transferOptions = useMemo(() => {
    const build = (word: string): ComboboxOption[] =>
      transferTargets.map((t) => ({
        value: t.accountId,
        label: `Transfer ${word} ${t.name}`,
        keywords: "transfer",
      }));
    return { out: build("to"), in: build("from") };
  }, [transferTargets]);
  const optionsFor = (row: ReviewRow): ComboboxOption[] => [
    ...categoryOptions,
    ...(row.amountCents < 0 ? transferOptions.out : transferOptions.in),
  ];

  const acceptable = rows.filter(
    (r) =>
      r.status === "unreviewed" &&
      (r.ruleSuggestion !== null ||
        (r.suggestion !== null && r.suggestion.confidence >= ACCEPT_THRESHOLD)),
  );

  /**
   * The Undo voids the entry the row just posted and puts the row back — the
   * same two statements the journal's void runs, reached from here. The toast
   * closes over the row, so it still works after the refresh has taken the
   * row out of the list.
   */
  function undoPost(row: ReviewRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await undoCategorizeTransactionAction({
        transactionId: row.id,
      });
      if ("error" in result) toast.error(result.error);
      else toast.success("Undone — back in review");
      setBusyId(null);
      router.refresh();
    });
  }

  function categorize(row: ReviewRow) {
    const accountId = chosen[row.id] ?? preferredAccountId(row);
    if (!accountId) {
      toast.error("Pick a category first");
      return;
    }
    // A transfer's memo names both ends, because the entry lands in two
    // registers and the other one's reader did not see this row.
    const transfer = transferTargets.find((t) => t.accountId === accountId);
    const memo = transfer
      ? `Transfer ${row.amountCents < 0 ? "to" : "from"} ${transfer.name} · ${row.description}`.slice(0, 500)
      : undefined;
    setBusyId(row.id);
    startTransition(async () => {
      const result = await categorizeTransactionAction({
        transactionId: row.id,
        accountId,
        memo,
        // Undefined rather than an empty array when nothing is tagged: the
        // action's schema treats the field as optional and `postEntry` writes
        // no `line_dimensions` rows for it, which is what "untagged" means.
        dimensionMemberIds: tags[row.id]?.length ? tags[row.id] : undefined,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(
          transfer ? "Posted — match the other account's row when it arrives" : "Posted",
          {
            action: { label: "Undo", onClick: () => undoPost(row) },
            duration: UNDO_WINDOW_MS,
          },
        );
      }
      setBusyId(null);
      router.refresh();
    });
  }

  function restore(row: ReviewRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await restoreTransactionAction({ transactionId: row.id });
      if ("error" in result) toast.error(result.error);
      else toast.success("Back in review");
      setBusyId(null);
      router.refresh();
    });
  }

  function exclude(row: ReviewRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await excludeTransactionAction({ transactionId: row.id });
      if ("error" in result) toast.error(result.error);
      else {
        // Restore already existed; the Undo is only a shorter road to it.
        toast.success("Excluded", {
          action: { label: "Undo", onClick: () => restore(row) },
          duration: UNDO_WINDOW_MS,
        });
      }
      setBusyId(null);
      router.refresh();
    });
  }

  const [matchFor, setMatchFor] = useState<ReviewRow | null>(null);

  // A split: one row, several categories, still one entry (review.ts). The
  // dialog keeps the lines as typed and the arithmetic below says whether
  // they add up, so the button is gray until they do rather than red after.
  const [splitFor, setSplitFor] = useState<ReviewRow | null>(null);
  const [splitLines, setSplitLines] = useState<SplitDraftLine[]>([]);
  const splitMagnitude = splitFor ? Math.abs(splitFor.amountCents) : 0;
  const splitCents = splitLines.map((l) => parseMoneyToCents(l.amount));
  const splitAssigned = splitCents.reduce<number>((s, c) => s + (c ?? 0), 0);
  const splitRemaining = splitMagnitude - splitAssigned;
  const splitValid =
    splitLines.length >= 2 &&
    splitRemaining === 0 &&
    splitLines.every((l, i) => l.accountId !== "" && (splitCents[i] ?? 0) > 0);

  function openSplit(row: ReviewRow) {
    // The first line starts as the whole row on its suggested category, so
    // the common split — most of it here, the rest there — is one edit.
    setSplitLines([
      {
        key: crypto.randomUUID(),
        accountId: chosen[row.id] ?? preferredAccountId(row) ?? "",
        amount: (Math.abs(row.amountCents) / 100).toFixed(2),
      },
      { key: crypto.randomUUID(), accountId: "", amount: "" },
    ]);
    setSplitFor(row);
  }

  function setSplitLine(key: string, patch: Partial<SplitDraftLine>) {
    setSplitLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function postSplit() {
    const row = splitFor;
    if (!row || !splitValid) return;
    setBusyId(row.id);
    startTransition(async () => {
      const result = await splitTransactionAction({
        transactionId: row.id,
        lines: splitLines.map((l) => ({
          accountId: l.accountId,
          amountCents: parseMoneyToCents(l.amount)!,
          // The row's tag goes on every line: one delivery, one enterprise.
          dimensionMemberIds: tags[row.id]?.length ? tags[row.id] : undefined,
        })),
      });
      if ("error" in result) toast.error(result.error);
      else {
        setSplitFor(null);
        toast.success(`Posted — ${splitLines.length} lines`, {
          action: { label: "Undo", onClick: () => undoPost(row) },
          duration: UNDO_WINDOW_MS,
        });
      }
      setBusyId(null);
      router.refresh();
    });
  }

  function matchTo(entryId: string) {
    if (!matchFor) return;
    setBusyId(matchFor.id);
    startTransition(async () => {
      const result = await matchTransactionToEntryAction({
        transactionId: matchFor.id,
        journalEntryId: entryId,
      });
      if ("error" in result) toast.error(result.error);
      else toast.success("Matched — nothing new was posted");
      setMatchFor(null);
      setBusyId(null);
      router.refresh();
    });
  }

  function unmatch(row: ReviewRow) {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await unmatchTransactionAction({ transactionId: row.id });
      if ("error" in result) toast.error(result.error);
      else toast.success("Unmatched — back in review");
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

  /** The category and, under it, the tag — shown while a row is still to review. */
  function pickerFor(row: ReviewRow): ReactNode {
    if (tab === "all" || !canAct || row.status !== "unreviewed") return null;
    return (
      <>
        <Combobox
          options={optionsFor(row)}
          value={chosen[row.id] ?? preferredAccountId(row)}
          onValueChange={(v) => setChosen((c) => ({ ...c, [row.id]: v }))}
          placeholder="Pick category"
          searchPlaceholder="Type a code or a name…"
          emptyText="No account matches."
          aria-label={`Category for ${row.description}`}
          className="h-8"
        />
        {/*
          UNDER the category, not beside it: the category is required and the
          tag is not, and a row where both look equally mandatory is a row
          people stop filling in. Renders nothing at all when the business has
          no dimensions, which is most of them.
        */}
        <DimensionTags
          types={dimensionTypes}
          value={tags[row.id] ?? []}
          onValue={(v) => setTags((t) => ({ ...t, [row.id]: v }))}
          triggerClassName="h-7 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
        />
      </>
    );
  }

  /**
   * What a row can have done to it on the current tab. Primary last, the way
   * `PageHeader` orders its actions — on a phone that puts Post under the
   * thumb, and the table follows so the two layouts read the same.
   */
  function buttonsFor(row: ReviewRow): ReactNode {
    if (!canAct) return null;
    const busy = pending && busyId === row.id;
    if (row.status === "unreviewed" && tab === "unreviewed") {
      return (
        <>
          {row.matchCandidates.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy}
              onClick={() => setMatchFor(row)}
            >
              Match
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() => openSplit(row)}
          >
            Split
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={busy}
            onClick={() => exclude(row)}
          >
            Exclude
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={() => categorize(row)}
          >
            Post
          </Button>
        </>
      );
    }
    if (row.status === "posted" && tab === "all" && row.journalEntryId && !row.postedHere) {
      return (
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          disabled={busy}
          onClick={() => unmatch(row)}
          title="Send this transaction back to review (the entry stays posted)"
        >
          Unmatch
        </Button>
      );
    }
    if (row.status === "excluded" && tab === "excluded") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={busy}
          onClick={() => restore(row)}
        >
          Restore
        </Button>
      );
    }
    return null;
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
      <Dialog open={matchFor !== null} onOpenChange={(o) => !o && setMatchFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Match to an existing entry</DialogTitle>
            <DialogDescription>
              This deposit looks like it was already recorded. Matching links
              the feed row to the entry below — nothing new is posted.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y">
            {matchFor?.matchCandidates.map((c) => (
              <li key={c.entryId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.entryDate}
                  </span>{" "}
                  <span className="truncate">{c.label}</span>
                </span>
                <Button
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={pending}
                  onClick={() => matchTo(c.entryId)}
                >
                  Match
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={splitFor !== null} onOpenChange={(o) => !o && setSplitFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Split {splitFor ? formatCents(Math.abs(splitFor.amountCents)) : ""} across
              categories
            </DialogTitle>
            <DialogDescription>
              One entry posts, with a line per category. The lines must add up
              to the transaction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {splitLines.map((line, index) => (
              <div
                key={line.key}
                className="grid grid-cols-[1fr_110px_32px] items-center gap-2"
              >
                <Combobox
                  options={categoryOptions}
                  value={line.accountId || undefined}
                  onValueChange={(v) => setSplitLine(line.key, { accountId: v })}
                  placeholder="Pick category"
                  searchPlaceholder="Type a code or a name…"
                  emptyText="No account matches."
                  aria-label={`Category for split line ${index + 1}`}
                  className="h-8"
                />
                <Input
                  inputMode="decimal"
                  className="h-8 text-right font-mono"
                  value={line.amount}
                  placeholder="0.00"
                  aria-label={`Amount for split line ${index + 1}`}
                  onChange={(e) => setSplitLine(line.key, { amount: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  disabled={splitLines.length <= 2}
                  aria-label="Remove line"
                  onClick={() =>
                    setSplitLines((ls) => ls.filter((l) => l.key !== line.key))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() =>
                setSplitLines((ls) => [
                  ...ls,
                  { key: crypto.randomUUID(), accountId: "", amount: "" },
                ])
              }
            >
              <Plus className="size-4" /> Add line
            </Button>
            <p
              className={cn(
                "text-sm tabular-nums",
                splitRemaining === 0 ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {splitRemaining === 0
                ? "Balanced"
                : splitRemaining > 0
                  ? `${formatCents(splitRemaining)} left to assign`
                  : `${formatCents(-splitRemaining)} too much`}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={postSplit} disabled={pending || !splitValid}>
              Post split
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phone: one card per transaction. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => {
          const chip = suggestionChip(row);
          const picker = pickerFor(row);
          const buttons = buttonsFor(row);
          const money = row.amountCents > 0;
          return (
            <li
              key={row.id}
              className="rounded-2xl bg-card p-4 shadow-elevation-1"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{row.description}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{row.txnDate}</span>
                    {row.payee && <span>{row.payee}</span>}
                    {row.attachmentCount > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5"
                        title="Attached receipts"
                      >
                        <Paperclip className="size-3" />
                        {row.attachmentCount}
                      </span>
                    )}
                  </p>
                </div>
                {/* One figure, signed, in place of the In and Out columns:
                    money in is green with a plus, money out plain with a
                    minus, so a card never needs a column heading to say
                    which way it went. */}
                <p
                  className={cn(
                    "shrink-0 font-mono text-sm tabular-nums",
                    money && "text-success-foreground",
                  )}
                >
                  {money ? "+" : "−"}
                  {formatCents(Math.abs(row.amountCents))}
                </p>
              </div>
              {(chip || tab === "all") && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {chip}
                  {tab === "all" && statusMark(row)}
                </div>
              )}
              {picker && <div className="mt-3 space-y-2">{picker}</div>}
              {buttons && (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {buttons}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Wide screen: the table. */}
      <div className="hidden md:block">
        <DataTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Payee</TableHead>
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
              {rows.map((row) => {
                const chip = suggestionChip(row);
                const picker = pickerFor(row);
                const buttons = buttonsFor(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {row.txnDate}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="flex items-center gap-1.5 truncate text-sm">
                        {row.description}
                        {row.attachmentCount > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
                            title="Attached receipts"
                          >
                            <Paperclip className="size-3" />
                            {row.attachmentCount}
                          </span>
                        )}
                      </span>
                      {chip && <span className="mt-0.5 inline-flex">{chip}</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.payee ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.amountCents > 0 ? formatCents(row.amountCents) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.amountCents < 0 ? formatCents(-row.amountCents) : ""}
                    </TableCell>
                    {tab === "all" && <TableCell>{statusMark(row)}</TableCell>}
                    {tab !== "all" && canAct && (
                      <TableCell>
                        {picker && <div className="space-y-1">{picker}</div>}
                      </TableCell>
                    )}
                    {canAct && (
                      <TableCell className="whitespace-nowrap text-right">
                        {buttons && (
                          <div className="flex justify-end gap-1.5">{buttons}</div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
      </div>
    </div>
  );
}
