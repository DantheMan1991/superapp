"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/components/app/panel";
import type { OutlineQuestionKind } from "@/db/schema";
import { moveItem } from "../estimate-order";
import {
  codeStanding,
  outlineIssue,
  stepsWithUnknownCode,
  summarizeOutline,
  type CodeStanding,
  type CostCodeBook,
  type OutlineStepShape,
} from "../outline-math";
import { saveOutlineAction } from "../outline-actions";

/**
 * THE OUTLINE EDITOR (X1, ADR 0098).
 *
 * ── THE WHOLE THING SAVES AT ONCE, AND UNSAVED IS DERIVED ───────────────────
 *
 * The estimate editor's rules, because this is the same kind of document and a
 * second answer would be a second thing to learn (ADR 0082). A row keeps its
 * id across a save, so the ids ride in the payload; unsaved is the payload
 * compared against what loaded, **with the version excluded**, so a save that
 * changed nothing does not leave the button lit.
 *
 * ── A STEP'S NUMBER IS ITS ADDRESS ──────────────────────────────────────────
 *
 * ADR 0087's idiom, and the founder's own words about the estimate: *"if a
 * group is #10 and I want it right after #2 I change the 10 to 3."* The same
 * box, the same arithmetic — `moveItem` is the estimate's own function, not a
 * second copy of it. Questions inside a step move with arrows instead: there
 * are rarely more than a handful, and two addressing schemes on one screen is
 * one too many.
 *
 * ── NO `sr-only`, DELIBERATELY ──────────────────────────────────────────────
 *
 * Every icon-only control here is labelled with `aria-label`. `sr-only` is
 * `position: absolute`, and with no positioned ancestor its containing block
 * is the PAGE — which is what dragged the estimate screen sideways to 1,220px
 * before E3a found it. This screen has no horizontal scroll to hide it in.
 */

/**
 * WHAT A TYPED COST CODE IS, against the lists this business keeps.
 *
 * Silent when the code is in every list, because the common case should say
 * nothing. `partial` is the sentence worth having — a code in one list and
 * not another comes out uncoded on a job using the other one, and nothing
 * else would ever tell you.
 */
function CodeNote({ standing }: { standing: CodeStanding }) {
  if (standing.state === "none") return null;
  if (standing.state === "missing") {
    return (
      <span className="text-xs text-warning-foreground">
        not in any of your cost code lists
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      {standing.name}
      {standing.state === "partial" && ` · not in ${standing.missingFrom.join(", ")}`}
    </span>
  );
}

const KINDS: { value: OutlineQuestionKind; label: string; hint: string }[] = [
  { value: "choice", label: "Pick one", hint: "Buttons. One option per line below." },
  { value: "yes_no", label: "Yes or no", hint: "Two buttons." },
  { value: "number", label: "A number", hint: "A quantity, in the unit you name." },
  { value: "money", label: "An amount", hint: "A price, a quote or an allowance." },
  { value: "text", label: "Anything", hint: "Typed, or said." },
];

interface QuestionDraft {
  key: string;
  id?: string;
  prompt: string;
  kind: OutlineQuestionKind;
  /** One option per line, which is how a choice is edited. */
  choicesText: string;
  unit: string;
  notes: string;
  alwaysAsk: boolean;
}

interface StepDraft {
  key: string;
  id?: string;
  title: string;
  costCode: string;
  guidance: string;
  questions: QuestionDraft[];
}

export interface LoadedStep {
  id: string;
  title: string;
  costCode: string;
  guidance: string;
  questions: {
    id: string;
    prompt: string;
    kind: string;
    choices: string[];
    unit: string;
    notes: string;
    alwaysAsk: boolean;
  }[];
}

let counter = 0;
function newKey(): string {
  counter += 1;
  return `n${counter}`;
}

function draftsFrom(steps: readonly LoadedStep[]): StepDraft[] {
  return steps.map((s) => ({
    key: s.id,
    id: s.id,
    title: s.title,
    costCode: s.costCode,
    guidance: s.guidance,
    questions: s.questions.map((q) => ({
      key: q.id,
      id: q.id,
      prompt: q.prompt,
      kind: q.kind as OutlineQuestionKind,
      choicesText: q.choices.join("\n"),
      unit: q.unit,
      notes: q.notes,
      alwaysAsk: q.alwaysAsk,
    })),
  }));
}

function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** What goes on the wire, and — with the name — what "unsaved" is measured on. */
function payloadOf(name: string, notes: string, steps: readonly StepDraft[]) {
  return {
    name: name.trim(),
    notes: notes.trim(),
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title.trim(),
      costCode: s.costCode.trim(),
      guidance: s.guidance.trim(),
      questions: s.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt.trim(),
        kind: q.kind,
        choices: q.kind === "choice" ? linesOf(q.choicesText) : [],
        unit: q.kind === "number" ? q.unit.trim() : "",
        notes: q.notes.trim(),
        alwaysAsk: q.alwaysAsk,
      })),
    })),
  };
}

export function OutlineEditor({
  outlineId,
  initialName,
  initialNotes,
  initialSteps,
  initialVersion,
  canWrite,
  books,
}: {
  outlineId: string;
  initialName: string;
  initialNotes: string;
  initialSteps: LoadedStep[];
  initialVersion: number;
  canWrite: boolean;
  /** Every cost code list this business keeps, for checking a step's code. */
  books: CostCodeBook[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [steps, setSteps] = useState<StepDraft[]>(() => draftsFrom(initialSteps));
  const [version, setVersion] = useState(initialVersion);
  const [saved, setSaved] = useState(() =>
    JSON.stringify(payloadOf(initialName, initialNotes, draftsFrom(initialSteps))),
  );

  const payload = useMemo(() => payloadOf(name, notes, steps), [name, notes, steps]);
  const unsaved = JSON.stringify(payload) !== saved;
  const issue = useMemo(
    () => outlineIssue(payload.steps as OutlineStepShape[]),
    [payload],
  );
  const summary = useMemo(
    () => summarizeOutline(payload.steps as OutlineStepShape[]),
    [payload],
  );
  /**
   * Steps whose code NO list of this business has — a typo, and invisible
   * until a bid comes out with an uncoded line. A step with no code at all is
   * counted separately by `summarizeOutline`: that is a deliberate blank.
   */
  const unknownCodes = useMemo(
    () => stepsWithUnknownCode(payload.steps as OutlineStepShape[], books),
    [payload, books],
  );

  function patchStep(key: string, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function patchQuestion(stepKey: string, qKey: string, patch: Partial<QuestionDraft>) {
    setSteps((prev) =>
      prev.map((s) =>
        s.key === stepKey
          ? {
              ...s,
              questions: s.questions.map((q) =>
                q.key === qKey ? { ...q, ...patch } : q,
              ),
            }
          : s,
      ),
    );
  }

  function save() {
    startTransition(async () => {
      const result = await saveOutlineAction({ outlineId, ...payload, version });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setVersion(result.version);
      setSaved(JSON.stringify(payload));
      toast.success("Outline saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="outline-name">Name</Label>
            <Input
              id="outline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outline-notes">What it is for</Label>
            <Input
              id="outline-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canWrite}
              placeholder="Work in a building that already exists"
              maxLength={2000}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {summary.steps} {summary.steps === 1 ? "step" : "steps"}, {summary.questions}{" "}
            {summary.questions === 1 ? "question" : "questions"}
            {summary.silentSteps > 0 && ` · ${summary.silentSteps} asking nothing`}
            {summary.uncodedSteps > 0 && ` · ${summary.uncodedSteps} with no cost code`}
          </p>
          {unknownCodes > 0 && (
            <p className="text-sm text-warning-foreground">
              {unknownCodes === 1
                ? "1 step carries a code none of your cost code lists has."
                : `${unknownCodes} steps carry a code none of your cost code lists has.`}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            {issue && canWrite && (
              <p className="text-sm text-destructive">{issue}</p>
            )}
            {canWrite && (
              <Button onClick={save} disabled={pending || !unsaved || issue !== null}>
                {pending ? "Saving…" : unsaved ? "Save outline" : "Saved"}
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {steps.map((step, index) => (
        <Panel key={step.key} className="p-5">
          <div className="flex flex-wrap items-start gap-3">
            <Input
              className="w-14 text-center font-mono"
              defaultValue={index + 1}
              key={`${step.key}-${index}`}
              disabled={!canWrite}
              aria-label={`Position of ${step.title || "this step"}`}
              onBlur={(e) => {
                const wanted = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(wanted) || wanted === index + 1) {
                  e.target.value = String(index + 1);
                  return;
                }
                setSteps((prev) => moveItem(prev, index, wanted));
              }}
            />
            <Input
              className="min-w-48 flex-1"
              value={step.title}
              onChange={(e) => patchStep(step.key, { title: e.target.value })}
              disabled={!canWrite}
              placeholder="Foundation"
              aria-label="Step name"
              maxLength={200}
            />
            <Input
              className="w-32 font-mono text-xs"
              value={step.costCode}
              onChange={(e) => patchStep(step.key, { costCode: e.target.value })}
              disabled={!canWrite}
              placeholder="Cost code"
              aria-label="Cost code"
              maxLength={60}
            />
            <CodeNote standing={codeStanding(step.costCode, books)} />
            {canWrite && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${step.title || "this step"}`}
                onClick={() =>
                  setSteps((prev) => prev.filter((s) => s.key !== step.key))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>

          <Textarea
            className="mt-3 text-sm"
            rows={2}
            value={step.guidance}
            onChange={(e) => patchStep(step.key, { guidance: e.target.value })}
            disabled={!canWrite}
            placeholder="What has to be established here, in your own words. The interview reads this."
            aria-label="Guidance for this step"
            maxLength={4000}
          />

          <div className="mt-4 space-y-3">
            {step.questions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This step asks nothing, so the interview will pass straight
                through it.
              </p>
            )}
            {step.questions.map((question, qIndex) => (
              <div key={question.key} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Input
                    className="min-w-48 flex-1"
                    value={question.prompt}
                    onChange={(e) =>
                      patchQuestion(step.key, question.key, { prompt: e.target.value })
                    }
                    disabled={!canWrite}
                    placeholder="Block or poured?"
                    aria-label="Question"
                    maxLength={500}
                  />
                  <Select
                    value={question.kind}
                    onValueChange={(value) =>
                      patchQuestion(step.key, question.key, {
                        kind: value as OutlineQuestionKind,
                      })
                    }
                    disabled={!canWrite}
                  >
                    <SelectTrigger className="w-36" aria-label="Answer kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {canWrite && (
                    <div className="flex items-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Move this question up"
                        disabled={qIndex === 0}
                        onClick={() =>
                          patchStep(step.key, {
                            questions: moveItem(step.questions, qIndex, qIndex),
                          })
                        }
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Move this question down"
                        disabled={qIndex === step.questions.length - 1}
                        onClick={() =>
                          patchStep(step.key, {
                            questions: moveItem(step.questions, qIndex, qIndex + 2),
                          })
                        }
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove this question"
                        onClick={() =>
                          patchStep(step.key, {
                            questions: step.questions.filter(
                              (q) => q.key !== question.key,
                            ),
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {question.kind === "choice" && (
                  <Textarea
                    className="mt-2 font-mono text-xs"
                    rows={3}
                    value={question.choicesText}
                    onChange={(e) =>
                      patchQuestion(step.key, question.key, {
                        choicesText: e.target.value,
                      })
                    }
                    disabled={!canWrite}
                    placeholder={"Block\nPoured\nICF"}
                    aria-label="Options, one per line"
                    maxLength={1500}
                  />
                )}
                {question.kind === "number" && (
                  <Input
                    className="mt-2 w-32 text-xs"
                    value={question.unit}
                    onChange={(e) =>
                      patchQuestion(step.key, question.key, { unit: e.target.value })
                    }
                    disabled={!canWrite}
                    placeholder="lf, sf, ea"
                    aria-label="Unit"
                    maxLength={24}
                  />
                )}
                <Input
                  className="mt-2 text-xs"
                  value={question.notes}
                  onChange={(e) =>
                    patchQuestion(step.key, question.key, { notes: e.target.value })
                  }
                  disabled={!canWrite}
                  placeholder="When to ask it, what to watch for — the interview reads this, the client never sees it."
                  aria-label="Notes for the interviewer"
                  maxLength={2000}
                />
                <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    className="mt-0.5"
                    checked={question.alwaysAsk}
                    disabled={!canWrite}
                    onCheckedChange={(next) =>
                      patchQuestion(step.key, question.key, {
                        alwaysAsk: next === true,
                      })
                    }
                    aria-label="Always ask this question"
                  />
                  <span>
                    <span className="font-medium text-foreground">Always ask</span> —
                    the walk may never decide this one does not apply. For the
                    questions where being asked is the point: asbestos, a permit,
                    who carries the risk.
                  </span>
                </label>
              </div>
            ))}
            {canWrite && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  patchStep(step.key, {
                    questions: [
                      ...step.questions,
                      {
                        key: newKey(),
                        prompt: "",
                        kind: "text",
                        choicesText: "",
                        unit: "",
                        notes: "",
                        alwaysAsk: false,
                      },
                    ],
                  })
                }
              >
                <Plus className="mr-1.5 size-4" /> Add a question
              </Button>
            )}
          </div>
        </Panel>
      ))}

      {canWrite && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              setSteps((prev) => [
                ...prev,
                {
                  key: newKey(),
                  title: "",
                  costCode: "",
                  guidance: "",
                  questions: [],
                },
              ])
            }
          >
            <Plus className="mr-1.5 size-4" /> Add a step
          </Button>
          {unsaved && <Badge variant="secondary">Unsaved changes</Badge>}
        </div>
      )}
    </div>
  );
}
