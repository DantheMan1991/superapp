"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CornerDownRight, Import } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyQuestionsAction, proposeQuestionMergeAction } from "../outline-actions";

/**
 * BRINGING ANOTHER OUTLINE'S QUESTIONS ONTO THIS ONE'S STEPS.
 *
 * **EVERY ROW IS CONFIRMED BEFORE ANYTHING IS WRITTEN.** The matcher is
 * guesswork over two people's names for the same phase — measured against
 * the pilot's own pair it got 25 of 33, and several of those were NEARLY
 * right rather than right. So this screen shows one row per step, with the
 * match already chosen, and every row can be pointed somewhere else or
 * dropped. `outline-merge.ts` has the measurements.
 *
 * Nothing is replaced: borrowed questions are appended after whatever the
 * step already asks, and a prompt it already carries is skipped.
 */

const SKIP = "__skip__";

interface Proposal {
  sourceId: string;
  sourceTitle: string;
  sourceQuestions: number;
  targetId: string | null;
  targetTitle: string;
  reason: string | null;
}

interface Target {
  id: string;
  title: string;
  section: string;
  questions: number;
}

export function BringQuestionsButton({
  outlineId,
  others,
}: {
  outlineId: string;
  /** The tenant's other outlines, to borrow from. */
  others: { id: string; name: string; steps: number; questions: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [names, setNames] = useState({ from: "", into: "" });
  const [pending, startTransition] = useTransition();

  if (others.length === 0) return null;

  function look(id: string) {
    setFromId(id);
    setProposals(null);
    startTransition(async () => {
      try {
        const result = await proposeQuestionMergeAction({
          fromOutlineId: id,
          intoOutlineId: outlineId,
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setProposals(result.proposals as Proposal[]);
        setTargets(result.targets as Target[]);
        setNames({ from: result.fromName as string, into: result.intoName as string });
        const start: Record<string, string> = {};
        for (const p of result.proposals as Proposal[]) {
          start[p.sourceId] = p.targetId ?? SKIP;
        }
        setChoice(start);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  const ticked = Object.values(choice).filter((v) => v !== SKIP).length;

  function copy() {
    startTransition(async () => {
      try {
        const pairs = Object.entries(choice)
          .filter(([, intoStepId]) => intoStepId !== SKIP)
          .map(([fromStepId, intoStepId]) => ({ fromStepId, intoStepId }));
        const result = await copyQuestionsAction({
          fromOutlineId: fromId,
          intoOutlineId: outlineId,
          pairs,
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success(
          `${result.copied} ${result.copied === 1 ? "question" : "questions"} onto ${result.steps} ${
            result.steps === 1 ? "step" : "steps"
          }` + (result.skipped > 0 ? `, ${result.skipped} already there` : ""),
        );
        setOpen(false);
        setProposals(null);
        setFromId("");
        router.refresh();
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Import className="mr-1.5 size-4" /> Bring questions in
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bring questions in from another outline</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="from-outline">Take the questions from</Label>
              <Select value={fromId} onValueChange={look}>
                <SelectTrigger id="from-outline" className="w-full">
                  <SelectValue placeholder="Pick an outline" />
                </SelectTrigger>
                <SelectContent>
                  {others.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name} · {o.steps} steps, {o.questions} questions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {pending && !proposals && (
              <p className="text-sm text-muted-foreground">Matching the steps up…</p>
            )}

            {proposals && proposals.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {names.from} has no questions to bring across.
              </p>
            )}

            {proposals && proposals.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Matched on the names, so{" "}
                  <span className="font-medium text-foreground">check each one</span>.
                  Anything it could not place is set to leave alone; point it at a step
                  yourself, or leave it.
                </p>
                <ul className="max-h-[22rem] overflow-y-auto rounded-md border">
                  {proposals.map((p) => (
                    <li
                      key={p.sourceId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b p-2.5 last:border-b-0"
                    >
                      <div className="min-w-44 flex-1">
                        <p className="text-sm">{p.sourceTitle}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.sourceQuestions}{" "}
                          {p.sourceQuestions === 1 ? "question" : "questions"}
                          {p.reason && ` · matched on ${p.reason}`}
                          {!p.reason && " · nothing looked close"}
                        </p>
                      </div>
                      <CornerDownRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Select
                        value={choice[p.sourceId] ?? SKIP}
                        onValueChange={(v) =>
                          setChoice((was) => ({ ...was, [p.sourceId]: v }))
                        }
                      >
                        <SelectTrigger
                          className="w-64"
                          aria-label={`Where ${p.sourceTitle}'s questions go`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SKIP}>Leave alone</SelectItem>
                          {targets.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.section ? `${t.section} · ` : ""}
                              {t.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Questions are added after what a step already asks. One it already
                  carries is skipped, so doing this twice changes nothing the second
                  time. {names.from} is not altered.
                </p>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={copy} disabled={pending || ticked === 0}>
              {pending
                ? "Copying…"
                : `Copy onto ${ticked} ${ticked === 1 ? "step" : "steps"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
