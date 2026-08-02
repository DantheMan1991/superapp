"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import { saveRulesAction } from "./actions";
import type { RuleField } from "./compile";

/**
 * The rules editor.
 *
 * ONE FORM, ONE SAVE, for the whole list. Rules are order-dependent — `stop`
 * means "and nothing after this" — so a per-rule save would let somebody
 * publish rule 3 while rules 1 and 2 sat unsaved, and the script would sort
 * mail differently from the list they were looking at. Saving everything at
 * once is the only version where what is on screen is what is running.
 *
 * The mail server executes these. That is the whole feature: they apply to
 * mail arriving at 3am, and to the copy of the mailbox on somebody's phone.
 */

export interface EditorRule {
  name: string;
  isEnabled: boolean;
  matchMode: "all" | "any";
  tests: { field: RuleField; contains: string }[];
  fileIntoMailboxId: string | null;
  fileIntoName: string | null;
  markRead: boolean;
  flag: boolean;
  stopAfter: boolean;
}

const FIELD_LABELS: Record<RuleField, string> = {
  from: "From",
  to: "To or Cc",
  subject: "Subject",
};

function blankRule(): EditorRule {
  return {
    name: "",
    isEnabled: true,
    matchMode: "all",
    tests: [{ field: "from", contains: "" }],
    fileIntoMailboxId: null,
    fileIntoName: null,
    markRead: false,
    flag: false,
    stopAfter: true,
  };
}

export function RulesEditor({
  mailboxId,
  folders,
  initial,
  closeHref,
}: {
  mailboxId: string;
  folders: JmapMailbox[];
  initial: EditorRule[];
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState<EditorRule[]>(initial);

  function patch(index: number, change: Partial<EditorRule>) {
    setRules((prior) =>
      prior.map((rule, i) => (i === index ? { ...rule, ...change } : rule)),
    );
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= rules.length) return;
    setRules((prior) => {
      const next = [...prior];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  /**
   * What the server would refuse, said before anybody presses Save.
   *
   * The compiler drops a rule with no tests rather than emitting one, because
   * a test-less rule matches EVERY message. Silently dropping it is safe but
   * baffling — so the reason is shown here instead.
   */
  function problemWith(rule: EditorRule): string | null {
    if (rule.name.trim() === "") return "Give it a name.";
    if (rule.tests.some((t) => t.contains.trim() === "")) {
      return "Fill in what to look for, or remove the condition.";
    }
    if (!rule.fileIntoMailboxId && !rule.markRead && !rule.flag) {
      return "Choose what happens when it matches.";
    }
    return null;
  }

  const problems = rules.map(problemWith);
  const blocked = problems.some((p) => p !== null);

  function save() {
    if (blocked) {
      toast.error("Some rules aren't finished.");
      return;
    }
    startTransition(async () => {
      const result = await saveRulesAction({
        mailboxId,
        rules: rules.map((rule) => ({
          ...rule,
          name: rule.name.trim(),
          tests: rule.tests.map((t) => ({ ...t, contains: t.contains.trim() })),
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const inert = result.data?.inert ?? [];
      if (inert.length > 0) {
        toast.warning(`Saved, but these do nothing: ${inert.join(", ")}.`);
      } else {
        toast.success(`${result.data?.published ?? 0} rules are running.`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <h2 className="text-sm font-medium">Rules</h2>
        <Link
          href={closeHref}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        <p className="text-sm text-muted-foreground">
          These run on the mail server as messages arrive — so they apply at 3am,
          and on your phone, not just here. Rules run top to bottom.
        </p>

        {rules.length === 0 && (
          <p className="rounded border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No rules yet.
          </p>
        )}

        {rules.map((rule, index) => (
          <div key={index} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rule.isEnabled}
                onChange={(e) => patch(index, { isEnabled: e.currentTarget.checked })}
                className="size-4 accent-current"
                aria-label={`Enable ${rule.name || "rule"}`}
              />
              <Input
                value={rule.name}
                maxLength={120}
                placeholder="Name this rule"
                onChange={(e) => patch(index, { name: e.currentTarget.value })}
                className="h-8 flex-1"
              />
              {/* Order is semantic, not cosmetic: `stop` means "and nothing
                  after this", so moving a rule changes where mail lands. */}
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={index === rules.length - 1}
                onClick={() => move(index, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => setRules(rules.filter((_, i) => i !== index))}
                aria-label="Delete rule"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <div className="space-y-2">
              {rule.tests.map((test, ti) => (
                <div key={ti} className="flex items-center gap-2">
                  <span className="w-10 text-xs text-muted-foreground">
                    {ti === 0 ? "If" : rule.matchMode === "all" ? "and" : "or"}
                  </span>
                  <select
                    value={test.field}
                    onChange={(e) =>
                      patch(index, {
                        tests: rule.tests.map((t, i) =>
                          i === ti
                            ? { ...t, field: e.currentTarget.value as RuleField }
                            : t,
                        ),
                      })
                    }
                    className="h-8 rounded-md border bg-transparent px-2 text-sm"
                  >
                    {(Object.keys(FIELD_LABELS) as RuleField[]).map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">contains</span>
                  <Input
                    value={test.contains}
                    maxLength={200}
                    placeholder="acme.com"
                    onChange={(e) =>
                      patch(index, {
                        tests: rule.tests.map((t, i) =>
                          i === ti ? { ...t, contains: e.currentTarget.value } : t,
                        ),
                      })
                    }
                    className="h-8 flex-1"
                  />
                  {rule.tests.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() =>
                        patch(index, {
                          tests: rule.tests.filter((_, i) => i !== ti),
                        })
                      }
                      aria-label="Remove condition"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 pl-12">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rule.tests.length >= 10}
                  onClick={() =>
                    patch(index, {
                      tests: [...rule.tests, { field: "from", contains: "" }],
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  Condition
                </Button>
                {rule.tests.length > 1 && (
                  <select
                    value={rule.matchMode}
                    onChange={(e) =>
                      patch(index, {
                        matchMode: e.currentTarget.value as "all" | "any",
                      })
                    }
                    className="h-8 rounded-md border bg-transparent px-2 text-xs"
                  >
                    <option value="all">Match all conditions</option>
                    <option value="any">Match any condition</option>
                  </select>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <Label className="text-xs text-muted-foreground">Then</Label>
              <select
                value={rule.fileIntoMailboxId ?? ""}
                onChange={(e) => {
                  const id = e.currentTarget.value || null;
                  patch(index, {
                    fileIntoMailboxId: id,
                    fileIntoName: folders.find((f) => f.id === id)?.name ?? null,
                  });
                }}
                className="h-8 rounded-md border bg-transparent px-2 text-sm"
              >
                <option value="">Leave in place</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    Move to {folder.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={rule.markRead}
                  onChange={(e) => patch(index, { markRead: e.currentTarget.checked })}
                  className="size-3.5 accent-current"
                />
                Mark read
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={rule.flag}
                  onChange={(e) => patch(index, { flag: e.currentTarget.checked })}
                  className="size-3.5 accent-current"
                />
                Flag
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rule.stopAfter}
                  onChange={(e) => patch(index, { stopAfter: e.currentTarget.checked })}
                  className="size-3.5 accent-current"
                />
                Stop here
              </label>
            </div>

            {problems[index] && (
              <p className="text-sm text-destructive">{problems[index]}</p>
            )}
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          disabled={rules.length >= 50}
          onClick={() => setRules([...rules, blankRule()])}
        >
          <Plus className="size-4" />
          Add a rule
        </Button>
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <Button onClick={save} disabled={pending || blocked}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save and publish
        </Button>
        {/* Saying what Save actually does. These stop being a list in a form
            the moment it is pressed, and start being a program on a server. */}
        <span className="text-xs text-muted-foreground">
          Replaces the rules running on the mail server.
        </span>
      </div>
    </div>
  );
}
