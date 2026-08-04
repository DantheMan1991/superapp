"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Loader2, Plus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CrmDealOutcome, CrmPipelineStage } from "@/db/schema";
import {
  createStageAction,
  setStageArchivedAction,
  updateStageAction,
} from "../deal-actions";

const OUTCOME_LABELS: Record<CrmDealOutcome, string> = {
  open: "Still open",
  won: "Closes as won",
  lost: "Closes as lost",
};

export function PipelineManager({
  pipelineId,
  stages,
}: {
  pipelineId: string;
  stages: CrmPipelineStage[];
}) {
  const live = stages.filter((s) => !s.archivedAt);
  const archived = stages.filter((s) => s.archivedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Stages, in order</h2>
          <p className="text-xs text-muted-foreground">
            A deal starts in the first open stage.
          </p>
        </div>
        <StageDialog mode="create" pipelineId={pipelineId} />
      </div>

      <ul className="divide-y rounded-md border">
        {live.map((stage) => (
          <StageRow key={stage.id} stage={stage} pipelineId={pipelineId} />
        ))}
      </ul>

      {archived.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Archived</h2>
          <ul className="divide-y rounded-md border">
            {archived.map((stage) => (
              <StageRow key={stage.id} stage={stage} pipelineId={pipelineId} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StageRow({
  stage,
  pipelineId,
}: {
  stage: CrmPipelineStage;
  pipelineId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isArchived = !!stage.archivedAt;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{stage.name}</p>
        <p className="text-xs text-muted-foreground">
          {OUTCOME_LABELS[stage.outcome]}
          {stage.outcome === "open" && ` · ${stage.probability}% likely`}
        </p>
      </div>

      {stage.outcome !== "open" && (
        <Badge variant="outline">{stage.outcome === "won" ? "Won" : "Lost"}</Badge>
      )}

      {!isArchived && <StageDialog mode="edit" pipelineId={pipelineId} stage={stage} />}

      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setStageArchivedAction({
              stageId: stage.id,
              expectedVersion: stage.version,
              archived: !isArchived,
            });
            if ("error" in result) {
              // The interesting refusal is "still holds deals", which tells the
              // person what to do rather than that something went wrong.
              toast.error(result.error);
              return;
            }
            toast.success(isArchived ? "Stage restored" : "Stage archived");
            router.refresh();
          })
        }
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isArchived ? (
          <ArchiveRestore className="size-4" />
        ) : (
          <Archive className="size-4" />
        )}
      </Button>
    </li>
  );
}

function StageDialog({
  mode,
  pipelineId,
  stage,
}: {
  mode: "create" | "edit";
  pipelineId: string;
  stage?: CrmPipelineStage;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(stage?.name ?? "");
  const [outcome, setOutcome] = useState<CrmDealOutcome>(stage?.outcome ?? "open");
  const [probability, setProbability] = useState(String(stage?.probability ?? 0));
  const [pending, startTransition] = useTransition();

  function submit() {
    if (name.trim().length === 0) {
      toast.error("Give the stage a name");
      return;
    }
    const pct = Number(probability);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      toast.error("Likelihood must be a whole number from 0 to 100");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createStageAction({
              pipelineId,
              name: name.trim(),
              probability: pct,
              outcome,
            })
          : await updateStageAction({
              stageId: stage!.id,
              expectedVersion: stage!.version,
              name: name.trim(),
              probability: pct,
              outcome,
            });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Stage added" : "Stage saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 size-4" />
          Add a stage
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Add a stage" : "Edit stage"}
            </DialogTitle>
            <DialogDescription>
              Name it whatever this business actually calls it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="crm-stage-name">Name</Label>
              <Input
                id="crm-stage-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-stage-outcome">Reaching this stage means</Label>
              <Select
                value={outcome}
                onValueChange={(v) => setOutcome(v as CrmDealOutcome)}
              >
                <SelectTrigger id="crm-stage-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(OUTCOME_LABELS) as CrmDealOutcome[]).map((o) => (
                    <SelectItem key={o} value={o}>
                      {OUTCOME_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {outcome === "open" && (
              <div className="space-y-2">
                <Label htmlFor="crm-stage-probability">Likelihood</Label>
                <Input
                  id="crm-stage-probability"
                  inputMode="numeric"
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  0 to 100. Used to weight the pipeline total, not to decide
                  anything.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "create" ? "Add stage" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
