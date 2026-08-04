"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CrmPipelineStage } from "@/db/schema";
import { moveDealStageAction } from "../deal-actions";

/**
 * Move a deal to another stage.
 *
 * A MENU RATHER THAN DRAG AND DROP, deliberately. conventions §8 says a real
 * share of usage is one-handed, in the field, on a phone — and dragging a card
 * between columns that do not fit on the screen is the one board interaction
 * that has no good touch story. A menu also gives every destination a name,
 * which drag-and-drop only does once you are already holding the card.
 *
 * Server errors are surfaced verbatim, because the interesting ones are
 * specific: a required custom field unanswered, or a stage on another pipeline.
 */
export function MoveDealButton({
  dealId,
  dealVersion,
  partyId,
  currentStageId,
  stages,
  label,
}: {
  dealId: string;
  dealVersion: number;
  partyId: string;
  currentStageId: string;
  stages: CrmPipelineStage[];
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const destinations = stages.filter(
    (s) => !s.archivedAt && s.id !== currentStageId,
  );
  if (destinations.length === 0) return null;

  function move(toStageId: string) {
    startTransition(async () => {
      const result = await moveDealStageAction({
        dealId,
        expectedVersion: dealVersion,
        toStageId,
        partyId,
      });
      if ("error" in result) {
        // A required-field refusal arrives with per-field issues; the summary
        // alone would not say which field, and the board has nowhere to put an
        // inline message, so they are spelled out here.
        const detail = result.issues?.map((i) => i.label).join(", ");
        toast.error(detail ? `${result.error} ${detail}` : result.error);
        return;
      }
      toast.success("Moved");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              {label ?? "Move"}
              <ChevronRight className="ml-1 size-4" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {destinations.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => move(s.id)}>
            {s.name}
            {s.outcome !== "open" && (
              <span className="ml-2 text-xs text-muted-foreground">
                {s.outcome === "won" ? "closes as won" : "closes as lost"}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Switch which pipeline the board is showing. Pure navigation. */
export function PipelinePicker({
  pipelines,
  currentId,
}: {
  pipelines: { id: string; name: string }[];
  currentId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (pipelines.length < 2) return null;

  const current = pipelines.find((p) => p.id === currentId);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{current?.name ?? "Pipeline"}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {pipelines.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() =>
              router.push(`/dashboard/m/crm/deals?pipeline=${p.id}`)
            }
          >
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
