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
  left,
}: {
  projectId: string;
  estimateId: string;
  outlines: { id: string; name: string; isDefault: boolean; steps: number }[];
  /** An interview already going on this estimate, if there is one. */
  running: { stepTitle: string; covered: number; steps: number } | null;
  /** What the last FINISHED walk left behind, when nothing is running. */
  left: { blocking: number; priced: number } | null;
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

  /**
   * **THE LAST WALK LEFT SOMETHING**, and the estimate is where somebody
   * finds out (X4). Running out of questions closes a walk; it does not
   * price a phase, send a bid request or fill in an allowance, and until
   * this the only screen that said so was one nobody could get back to.
   */
  if (left && left.blocking > 0) {
    return (
      <Panel className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <MessagesSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              The last walk left {left.blocking}{" "}
              {left.blocking === 1 ? "phase" : "phases"} unfinished
            </p>
            <p className="text-xs text-muted-foreground">
              {left.priced} {left.priced === 1 ? "phase is" : "phases are"} priced. The
              rest are answered and not priced, out for bid, or never reached.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.push(href)}>
          See what is left
        </Button>
      </Panel>
    );
  }

  /**
   * **GRANTED, AND NOTHING TO WALK.** This returned null, which is how the
   * founder came to be looking at an estimate on production with the feature
   * switched on and no sign of it anywhere — a screen that said nothing when
   * the only thing missing was one list. A business gets the grant before it
   * ever writes an outline, so this is the FIRST state it sees, not an edge.
   */
  if (outlines.length === 0) {
    return (
      <Panel className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <MessagesSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Walk it instead of typing it</p>
            <p className="text-xs text-muted-foreground">
              You have this turned on, but there is no outline to walk yet —
              the steps and questions a walk goes through. Start one from a
              cost code list and it writes most of itself.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => router.push("/dashboard/m/jobs/estimate-outlines")}
        >
          Set one up
        </Button>
      </Panel>
    );
  }

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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push(`/dashboard/m/jobs/${projectId}/bids`)}
        >
          Prices from subs
        </Button>
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
