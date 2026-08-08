"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CrmAutomationRule } from "@/db/schema";
import {
  ACTION_KINDS,
  MAX_DUE_DAYS,
  TRIGGER_DEFINITIONS,
  describeRule,
  ruleProblems,
  type ActionKind,
  type AutomationRule,
  type RuleAction,
  type Trigger,
} from "../core/automation";
import {
  createRuleAction,
  deleteRuleAction,
  setRuleActiveAction,
} from "../automation-actions";

/**
 * The rules, and the form for adding one.
 *
 * EVERY RULE IS SHOWN AS THE SENTENCE IT IS. "When a deal moves into a stage
 * that counts as won, set the stage to customer." — not a row of dropdowns
 * frozen at their saved values. Somebody scanning this page is asking "what is
 * this system doing to my data?", and a sentence answers that in one read where
 * a form does not.
 *
 * The same sentence appears live under the builder as it is filled in, so the
 * thing being agreed to and the thing being read back later are literally the
 * same string from the same function.
 *
 * PAUSING IS AS PROMINENT AS DELETING, because "make it stop" is the urgent
 * request and deleting loses what the rule said. A rule that has been switched
 * off can be read, understood and switched back on; a deleted one is a mystery
 * with no evidence.
 */
/** Empty assignee = "whoever owns the record", which Select needs a value for. */
const RECORD_OWNER = "__record_owner__";

export interface RuleMember {
  clerkUserId: string;
  label: string;
}

/** Present only while a rule is failing — absence means healthy. */
export interface RuleHealth {
  consecutiveFailures: number;
  lastError: string;
  lastErrorAt: string;
}

export function AutomationManager({
  rules,
  isOwner,
  members = [],
  health = {},
}: {
  rules: CrmAutomationRule[];
  isOwner: boolean;
  /**
   * The tenant's assignable roster, from the caller's own transaction.
   *
   * These rules create follow-ups, and follow-ups now route to a person's
   * daily digest — so an assignee typed by hand is not a cosmetic wart. A
   * mistyped Clerk id produces a task assigned to nobody real: invisible to
   * every digest, and indistinguishable from work nobody has picked up.
   */
  members?: RuleMember[];
  /**
   * Rule id → why it is failing. Keyed rather than a list because most rules
   * are absent from it: a row exists only while something is wrong.
   */
  health?: Record<string, RuleHealth>;
}) {
  const [open, setOpen] = useState(false);

  // Shared by the list and the live preview, so a rule reads the same way in
  // both. Falls through to the raw id for somebody who has since left — see
  // NameResolver.
  const byId = new Map(members.map((m) => [m.clerkUserId, m.label]));
  const resolveName = (id: string) => byId.get(id);

  return (
    <div className="space-y-4">
      {isOwner && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Add a rule
          </Button>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          No rules yet. A rule watches for something happening and then does one
          thing — like adding a follow-up when a record is created.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rules.map((row) => (
            <RuleRow
              key={row.id}
              row={row}
              isOwner={isOwner}
              resolveName={resolveName}
              health={health[row.id]}
            />
          ))}
        </ul>
      )}

      <RuleDialog open={open} onOpenChange={setOpen} members={members} />
    </div>
  );
}

function RuleRow({
  row,
  isOwner,
  resolveName,
  health,
}: {
  row: CrmAutomationRule;
  isOwner: boolean;
  resolveName: (clerkUserId: string) => string | undefined;
  health?: RuleHealth;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const definition = (row.definition ?? {}) as {
    conditions?: AutomationRule["conditions"];
    action?: RuleAction;
  };
  const rule: AutomationRule | null = definition.action
    ? {
        trigger: row.trigger as Trigger,
        conditions: definition.conditions ?? [],
        action: definition.action,
      }
    : null;
  // A rule whose stored shape no longer parses is SHOWN, clearly, rather than
  // hidden — the engine skips it, and somebody wondering why needs to be able
  // to see that it exists and is broken.
  const broken = !rule || ruleProblems(rule).length > 0;

  function toggle(isActive: boolean) {
    startTransition(async () => {
      const result = await setRuleActiveAction({ ruleId: row.id, isActive });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(isActive ? "Rule resumed" : "Rule paused");
        router.refresh();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteRuleAction({ ruleId: row.id });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Rule deleted");
        router.refresh();
      }
    });
  }

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {row.name}
          {!row.isActive && <Badge variant="outline">paused</Badge>}
          {broken && <Badge variant="outline">needs attention</Badge>}
          {/*
            DISTINCT FROM "needs attention", which means the rule no longer
            PARSES and is being skipped. This one parses fine and is being run —
            it is the running that keeps going wrong, which is a different
            problem with a different fix.
          */}
          {health && <Badge variant="destructive">failing</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {broken
            ? "This rule refers to something that no longer exists, so it is being skipped."
            : describeRule(rule!, resolveName)}
        </p>
        {health && (
          // The error verbatim rather than a friendly paraphrase: whoever can
          // fix this needs the actual message, and inventing a kinder one would
          // mean guessing at a cause we do not know.
          <p className="text-xs text-destructive">
            {health.consecutiveFailures === 1
              ? "Failed once — "
              : `Failed ${health.consecutiveFailures} times in a row — `}
            {health.lastError}{" "}
            <span className="text-muted-foreground">
              (last {new Date(health.lastErrorAt).toLocaleString()})
            </span>
          </p>
        )}
      </div>
      {isOwner && (
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={row.isActive}
            disabled={pending}
            onCheckedChange={toggle}
            aria-label={row.isActive ? "Pause this rule" : "Resume this rule"}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={pending}
            onClick={remove}
          >
            <Trash2 className="size-4" />
            <span className="sr-only">Delete {row.name}</span>
          </Button>
        </div>
      )}
    </li>
  );
}

const ACTION_LABELS: Record<ActionKind, string> = {
  create_task: "Add a follow-up",
  set_lifecycle_stage: "Set the stage",
  assign_record: "Assign the record",
};

function RuleDialog({
  open,
  onOpenChange,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: RuleMember[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  // Same lookup the list uses, so the live preview and the saved rule read
  // identically — the property the comment on the preview claims.
  const byId = new Map(members.map((m) => [m.clerkUserId, m.label]));
  const [trigger, setTrigger] = useState<Trigger>("record_created");
  const [action, setAction] = useState<RuleAction>({
    kind: "create_task",
    title: "",
    dueInDays: 1,
    assignee: "",
  });

  // No condition builder in this first pass — see the dossier. A rule with no
  // conditions is the one most people want, and the filter UI already exists on
  // the records list to be reused when somebody asks for it.
  const rule: AutomationRule = { trigger, conditions: [], action };
  const problems = ruleProblems(rule);

  function save() {
    startTransition(async () => {
      const result = await createRuleAction({
        name: name.trim(),
        rule,
        isActive: true,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Rule added");
        onOpenChange(false);
        setName("");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a rule</DialogTitle>
          <DialogDescription>
            It runs as whoever triggers it, so it can only ever change records
            that person could change themselves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              placeholder="Welcome new customers"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-trigger">When</Label>
            <select
              id="rule-trigger"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as Trigger)}
            >
              {TRIGGER_DEFINITIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-action">Then</Label>
            <select
              id="rule-action"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={action.kind}
              onChange={(e) =>
                // Changing the KIND resets the rest: a title means nothing to an
                // assignment, and carrying it over would show a form whose
                // fields do not belong to the action it claims to be.
                setAction(
                  e.target.value === "create_task"
                    ? { kind: "create_task", title: "", dueInDays: 1, assignee: "" }
                    : { kind: e.target.value as ActionKind, stage: "", assignee: "" },
                )
              }
            >
              {ACTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ACTION_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>

          {action.kind === "create_task" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rule-title">Follow-up</Label>
                <Input
                  id="rule-title"
                  value={action.title ?? ""}
                  placeholder="Call to say hello"
                  onChange={(e) => setAction({ ...action, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-due">Due in (days)</Label>
                <Input
                  id="rule-due"
                  type="number"
                  min={0}
                  max={MAX_DUE_DAYS}
                  value={action.dueInDays ?? 0}
                  onChange={(e) =>
                    setAction({
                      ...action,
                      dueInDays: Number.parseInt(e.target.value, 10) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-assignee">For</Label>
                {members.length > 0 ? (
                  <Select
                    value={action.assignee || RECORD_OWNER}
                    onValueChange={(v) =>
                      setAction({
                        ...action,
                        assignee: v === RECORD_OWNER ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger id="rule-assignee" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* First, because it is the sensible default and the one
                          that keeps working when people join or leave. */}
                      <SelectItem value={RECORD_OWNER}>
                        Whoever owns the record
                      </SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Whoever owns the record.
                  </p>
                )}
              </div>
            </div>
          )}

          {action.kind === "set_lifecycle_stage" && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-stage">Stage</Label>
              <Input
                id="rule-stage"
                value={action.stage ?? ""}
                placeholder="customer"
                onChange={(e) => setAction({ ...action, stage: e.target.value })}
              />
            </div>
          )}

          {action.kind === "assign_record" && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-owner">Assign to</Label>
              {/* No "whoever owns the record" here — that IS the thing being
                  set, so the empty case would be a rule that does nothing. */}
              <Select
                value={action.assignee ?? ""}
                onValueChange={(v) => setAction({ ...action, assignee: v })}
              >
                <SelectTrigger id="rule-owner" className="w-full">
                  <SelectValue placeholder="Choose a colleague" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/*
            The rule read back as a sentence, live. It is the SAME function that
            renders it in the list afterwards, so what somebody agrees to and
            what they later read cannot drift apart.
          */}
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-sm">
              {problems.length === 0
                ? describeRule(rule, (id) => byId.get(id))
                : problems[0]}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending || !name.trim() || problems.length > 0}
          >
            {pending ? "Adding…" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
