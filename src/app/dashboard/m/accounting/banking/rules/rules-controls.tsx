"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyRulesAction,
  confirmSuggestedRuleAction,
  createRuleAction,
  deleteRuleAction,
  dismissSuggestedRuleAction,
  reorderRulesAction,
  setRuleActiveAction,
  updateRuleAction,
} from "@/modules/accounting/banking/actions";
// rules-match.ts is pure — no `server-only` — so the form validates against
// exactly the schema the action will re-validate against.
import { ruleConditionsSchema } from "@/modules/accounting/banking/rules-match";

type AppliesTo = "money_in" | "money_out" | "both";
type MatchMode = "all" | "any";
type ConditionField = "description" | "amount";

interface Condition {
  field: ConditionField;
  op: string;
  value: string;
}

export interface RuleRow {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  isSuggested: boolean;
  appliesTo: AppliesTo;
  bankAccountId: string | null;
  appliedTo: string;
  matchMode: MatchMode;
  conditions: unknown;
  conditionsLabel: string;
  setAccountId: string;
  setVendorId: string | null;
  setsLabel: string;
  setMemo: string | null;
  autoPost: boolean;
}

interface Register {
  id: string;
  name: string;
}
interface Category {
  id: string;
  code: string;
  name: string;
}
interface Vendor {
  id: string;
  name: string;
}

const TEXT_OPS = [
  { value: "contains", label: "contains" },
  { value: "doesnt_contain", label: "doesn't contain" },
  { value: "is", label: "is exactly" },
  { value: "starts_with", label: "starts with" },
];
const AMOUNT_OPS = [
  { value: "gt", label: "is more than" },
  { value: "lt", label: "is less than" },
  { value: "eq", label: "equals" },
];

const ALL_REGISTERS = "__all__";

function emptyCondition(): Condition {
  return { field: "description", op: "contains", value: "" };
}

export function RulesTable({
  rows,
  registers,
  categories,
  vendors,
  canAct,
}: {
  rows: RuleRow[];
  registers: Register[];
  categories: Category[];
  vendors: Vendor[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [creating, setCreating] = useState(false);

  function run(fn: () => Promise<{ ok: true } | { error: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(ok);
        router.refresh();
      }
    });
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...rows];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(
      () => reorderRulesAction({ ruleIds: next.map((r) => r.id) }),
      "Order updated",
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canAct && (
          <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
            <Plus className="size-4" />
            New rule
          </Button>
        )}
        {canAct && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || rows.length === 0}
            onClick={() =>
              startTransition(async () => {
                const result = await applyRulesAction({});
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                const r = result.data;
                const parts = [`${r?.matched ?? 0} matched`];
                if (r?.autoPosted) parts.push(`${r.autoPosted} posted`);
                if (r?.skippedLocked) {
                  parts.push(`${r.skippedLocked} left for review (period closed)`);
                }
                toast.success(parts.join(" · "));
                router.refresh();
              })
            }
          >
            <Wand2 className="size-4" />
            Apply to unreviewed
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No rules yet. Categorize a few transactions the same way and one
              will be suggested for you — or write one now.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Order</TableHead>
                  <TableHead className="min-w-[14rem]">Rule</TableHead>
                  <TableHead className="hidden lg:table-cell">Conditions</TableHead>
                  <TableHead className="hidden md:table-cell">Sets</TableHead>
                  <TableHead>Status</TableHead>
                  {canAct && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.id} className={row.isActive ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                        {canAct && (
                          <div className="flex flex-col">
                            <button
                              type="button"
                              aria-label="Move up"
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={pending || index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ChevronUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={pending || index === rows.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="block break-words text-sm font-medium">
                        {row.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {row.appliedTo}
                        {row.appliesTo !== "both" &&
                          ` · ${row.appliesTo === "money_in" ? "money in" : "money out"} only`}
                        {row.autoPost && " · posts automatically"}
                      </span>
                      {/* On narrow screens the two hidden columns fold to here,
                          so nothing is unreachable rather than merely off-screen. */}
                      <span className="mt-1 block break-words text-[11px] text-muted-foreground lg:hidden">
                        {row.conditionsLabel} → {row.setsLabel}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-[20rem] break-words align-top text-sm text-muted-foreground lg:table-cell">
                      {row.conditionsLabel}
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] break-words align-top text-sm text-muted-foreground md:table-cell">
                      {row.setsLabel}
                    </TableCell>
                    <TableCell className="align-top">
                      {row.isSuggested ? (
                        <Badge variant="outline">Suggested</Badge>
                      ) : row.isActive ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Off</Badge>
                      )}
                    </TableCell>
                    {canAct && (
                      <TableCell className="align-top text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {row.isSuggested && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () =>
                                      confirmSuggestedRuleAction({ ruleId: row.id }),
                                    "Rule kept",
                                  )
                                }
                              >
                                Keep
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () =>
                                      dismissSuggestedRuleAction({ ruleId: row.id }),
                                    "Suggestion dismissed",
                                  )
                                }
                              >
                                Dismiss
                              </Button>
                            </>
                          )}
                          {!row.isSuggested && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () =>
                                    setRuleActiveAction({
                                      ruleId: row.id,
                                      active: !row.isActive,
                                    }),
                                  row.isActive ? "Rule turned off" : "Rule turned on",
                                )
                              }
                            >
                              {row.isActive ? "Turn off" : "Turn on"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => setEditing(row)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${row.name}`}
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => deleteRuleAction({ ruleId: row.id }),
                                "Rule deleted",
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <RuleDialog
          rule={editing}
          registers={registers}
          categories={categories}
          vendors={vendors}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function conditionsOf(raw: unknown): Condition[] {
  if (!Array.isArray(raw) || raw.length === 0) return [emptyCondition()];
  return raw.map((c) => {
    const cond = c as Partial<Condition>;
    return {
      field: cond.field === "amount" ? "amount" : "description",
      op: typeof cond.op === "string" ? cond.op : "contains",
      value: typeof cond.value === "string" ? cond.value : "",
    };
  });
}

const NO_VENDOR = "__none__";

function RuleDialog({
  rule,
  registers,
  categories,
  vendors,
  onClose,
  onSaved,
}: {
  rule: RuleRow | null;
  registers: Register[];
  categories: Category[];
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(rule?.name ?? "");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(rule?.appliesTo ?? "both");
  const [bankAccountId, setBankAccountId] = useState<string>(
    rule?.bankAccountId ?? ALL_REGISTERS,
  );
  const [matchMode, setMatchMode] = useState<MatchMode>(rule?.matchMode ?? "all");
  const [conditions, setConditions] = useState<Condition[]>(
    rule ? conditionsOf(rule.conditions) : [emptyCondition()],
  );
  const [setAccountId, setSetAccountId] = useState(rule?.setAccountId ?? "");
  const [setVendorId, setSetVendorId] = useState(rule?.setVendorId ?? NO_VENDOR);
  const [setMemo, setSetMemo] = useState(rule?.setMemo ?? "");
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? false);

  function patch(index: number, next: Partial<Condition>) {
    setConditions((cs) =>
      cs.map((c, i) => {
        if (i !== index) return c;
        const merged = { ...c, ...next };
        // Switching field invalidates the operator — reset to that field's first.
        if (next.field && next.field !== c.field) {
          merged.op = next.field === "amount" ? "gt" : "contains";
        }
        return merged;
      }),
    );
  }

  function save() {
    if (name.trim() === "") {
      toast.error("Give the rule a name");
      return;
    }
    if (setAccountId === "") {
      toast.error("Pick a category");
      return;
    }
    if (conditions.some((c) => c.value.trim() === "")) {
      toast.error("Every condition needs a value");
      return;
    }
    // Validated with the SAME schema the action re-validates with, so the form
    // cannot construct a shape the server would reject — and an amount typed as
    // "fifty" is caught here rather than as a generic "Invalid input".
    const parsedConditions = ruleConditionsSchema.safeParse(
      conditions.map((c) => ({ ...c, value: c.value.trim() })),
    );
    if (!parsedConditions.success) {
      toast.error("Check the conditions — an amount must be a number like 50.00");
      return;
    }
    const payload = {
      name: name.trim(),
      appliesTo,
      bankAccountId: bankAccountId === ALL_REGISTERS ? null : bankAccountId,
      matchMode,
      conditions: parsedConditions.data,
      setAccountId,
      setVendorId: setVendorId === NO_VENDOR ? null : setVendorId,
      setMemo: setMemo.trim() === "" ? null : setMemo.trim(),
      autoPost,
    };
    startTransition(async () => {
      const result = rule
        ? await updateRuleAction({ ruleId: rule.id, ...payload })
        : await createRuleAction(payload);
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(rule ? "Rule saved" : "Rule created");
        onSaved();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle>
          <DialogDescription>
            Matching rows are pre-filled with this category. Rules are checked in
            list order and the first match wins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Rule name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Westfield as Insurance"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Apply to</Label>
              <Select
                value={appliesTo}
                onValueChange={(v) => setAppliesTo(v as AppliesTo)}
              >
                <SelectTrigger aria-label="Apply to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Money in and out</SelectItem>
                  <SelectItem value="money_in">Money in only</SelectItem>
                  <SelectItem value="money_out">Money out only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>In register</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger aria-label="In register">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_REGISTERS}>All registers</SelectItem>
                  {registers.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>When</Label>
              <Select
                value={matchMode}
                onValueChange={(v) => setMatchMode(v as MatchMode)}
              >
                <SelectTrigger className="h-8 w-32" aria-label="Match mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all of these</SelectItem>
                  <SelectItem value="any">any of these</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">are true</span>
            </div>

            {conditions.map((condition, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={condition.field}
                  onValueChange={(v) =>
                    patch(index, { field: v as ConditionField })
                  }
                >
                  <SelectTrigger className="h-9 w-36" aria-label={`Condition ${index + 1} field`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="description">Description</SelectItem>
                    <SelectItem value="amount">Amount</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={condition.op}
                  onValueChange={(v) => patch(index, { op: v })}
                >
                  <SelectTrigger className="h-9 w-40" aria-label={`Condition ${index + 1} operator`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(condition.field === "amount" ? AMOUNT_OPS : TEXT_OPS).map(
                      (op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Input
                  className="h-9 w-48"
                  value={condition.value}
                  onChange={(e) => patch(index, { value: e.target.value })}
                  placeholder={
                    condition.field === "amount" ? "50.00" : "WESTFIELD"
                  }
                  aria-label={`Condition ${index + 1} value`}
                />
                {conditions.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove condition ${index + 1}`}
                    onClick={() =>
                      setConditions((cs) => cs.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {conditions.length < 10 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConditions((cs) => [...cs, emptyCondition()])}
              >
                <Plus className="size-4" />
                Add condition
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Set category to</Label>
              <Select value={setAccountId} onValueChange={setSetAccountId}>
                <SelectTrigger aria-label="Set category to">
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
            </div>
            <div className="space-y-1.5">
              <Label>Set payee to (optional)</Label>
              <Select value={setVendorId} onValueChange={setSetVendorId}>
                <SelectTrigger aria-label="Set payee to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VENDOR}>Leave the payee alone</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-memo">Memo (optional)</Label>
              <Input
                id="rule-memo"
                value={setMemo}
                onChange={(e) => setSetMemo(e.target.value)}
                placeholder="Leave blank to keep the bank description"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch
              id="rule-autopost"
              checked={autoPost}
              onCheckedChange={setAutoPost}
            />
            <div>
              <Label htmlFor="rule-autopost">Post automatically</Label>
              <p className="text-xs text-muted-foreground">
                Matching transactions post to the ledger without review. Rows
                dated inside a closed period are always left for review instead.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {rule ? "Save rule" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
