"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Panel } from "@/components/app/panel";
import { startWalkAction } from "../walk-actions";

/**
 * THE WAY IN TO A WALK (X2a, ADR 0098), and it sits ABOVE the estimate editor
 * rather than inside it.
 *
 * Deliberate. `estimate-editor.tsx` already carries seven slices of behaviour
 * and the dossier warns anybody redesigning it that most of them are invisible
 * in a screenshot; the whole claim of this feature is that it is a LAYER, and
 * a layer that had to reach into the editor to exist would not be one. Turn
 * the grant off and this component is simply not rendered — the editor below
 * it is untouched, byte for byte.
 */
export function WalkStart({
  projectId,
  estimateId,
  outlines,
  running,
}: {
  projectId: string;
  estimateId: string;
  outlines: { id: string; name: string; isDefault: boolean; steps: number }[];
  /** An interview already going on this estimate, if there is one. */
  running: { stepTitle: string; covered: number; steps: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outlineId, setOutlineId] = useState(
    outlines.find((o) => o.isDefault)?.id ?? outlines[0]?.id ?? "",
  );
  const href = `/dashboard/m/jobs/${projectId}/estimates/${estimateId}/walk`;

  if (running) {
    return (
      <Panel className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <MessagesSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">A walk is part way through</p>
            <p className="text-xs text-muted-foreground">
              {running.covered} of {running.steps} steps done
              {running.stepTitle && ` — you are on ${running.stepTitle}`}.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => router.push(href)}>
          Pick it up
        </Button>
      </Panel>
    );
  }

  if (outlines.length === 0) return null;

  return (
    <Panel className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-start gap-3">
        <MessagesSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Walk it instead of typing it</p>
          <p className="text-xs text-muted-foreground">
            Go through the job step by step and answer questions. The lines
            below stay exactly as they are either way.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={outlineId} onValueChange={setOutlineId}>
          <SelectTrigger className="w-48" aria-label="Which outline to walk">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outlines.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name} · {o.steps} steps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={pending || outlineId === ""}
          onClick={() =>
            startTransition(async () => {
              const result = await startWalkAction({ projectId, estimateId, outlineId });
              if ("error" in result) {
                toast.error(result.error);
                return;
              }
              router.push(href);
            })
          }
        >
          {pending ? "Starting…" : "Start the walk"}
        </Button>
      </div>
    </Panel>
  );
}
