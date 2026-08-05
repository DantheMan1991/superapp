"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import type { ReportDefinition } from "../core/reports";
import { deleteReportAction, saveReportAction } from "../report-actions";

/**
 * Keeping a report.
 *
 * SAME SHAPE AS SAVING A VIEW, AND THAT IS THE POINT — somebody who has saved a
 * list view once should recognise this without reading it. Explore the report
 * by clicking the controls, and only save it once it answers something worth
 * asking again.
 *
 * The name placeholder asks for a QUESTION, because every built-in is one and
 * a list of questions is what makes the reports page readable. The database
 * does not insist on it: refusing to save "Q3 pipeline" for want of a question
 * mark would be a product telling its user how to write.
 */
export function SaveReport({
  definition,
  savedReportId,
  canDelete,
  total,
}: {
  definition: ReportDefinition;
  /** Set when looking at an already-saved report rather than a built-in. */
  savedReportId: string | null;
  canDelete: boolean;
  total: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);

  function save() {
    startTransition(async () => {
      const result = await saveReportAction({
        name: name.trim(),
        definition,
        isShared,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Report saved");
        setOpen(false);
        setName("");
        router.push(`/dashboard/m/crm/reports/${result.data!.reportId}`);
      }
    });
  }

  function remove() {
    if (!savedReportId) return;
    startTransition(async () => {
      const result = await deleteReportAction({ reportId: savedReportId });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Report deleted");
        router.push("/dashboard/m/crm/reports");
      }
    });
  }

  return (
    <>
      <span className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={() => setOpen(true)}
        >
          <Save className="size-3.5" />
          {savedReportId ? "Save as new" : "Save this report"}
        </Button>
        {canDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            disabled={pending}
            onClick={remove}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        )}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this report</DialogTitle>
            <DialogDescription>
              It answers {total === 1 ? "1 record" : `${total} records`} right
              now, and will re-run every time somebody opens it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-name">Name</Label>
              <Input
                id="report-name"
                value={name}
                placeholder="What is the open work worth?"
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Name it as a question if you can — it makes the list of reports
                easier to read.
              </p>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="report-shared">Share with the team</Label>
                <p className="text-xs text-muted-foreground">
                  Everyone gets the same question, answered from the records
                  they have access to.
                </p>
              </div>
              <Switch
                id="report-shared"
                checked={isShared}
                onCheckedChange={setIsShared}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
