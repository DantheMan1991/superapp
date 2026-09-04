"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkItemRow, type WorkRowView } from "@/components/app/work-item-row";
import {
  addMaintenanceScheduleAction,
  raiseMaintenanceWorkAction,
  recordMeterReadingAction,
  recordServiceAction,
} from "../actions";

export interface ScheduleView {
  id: string;
  name: string;
  summary: string;
  status: "no_baseline" | "ok" | "due";
  hasOpenWork: boolean;
}

export interface MaintenanceView {
  schedules: ScheduleView[];
  work: WorkRowView[];
  currentMeter: number | null;
  meterUnit: string;
  dueCount: number;
  /** The tenant's today, resolved on the server. */
  today: string;
}

/**
 * Maintenance on one asset.
 *
 * THE PACK HAS NO TASK ENGINE. Anything due is raised as an ordinary work item
 * and rendered with the SHARED row — the same component and the same verbs a
 * CRM follow-up gets. Done, reassign and re-due all happen here, on the asset,
 * so nobody is sent to Work to act on what the asset raised
 * (docs/extension-model.md §4b).
 */
export function MaintenancePanel({
  assetId,
  view,
  members,
  canEdit,
  canRecord,
}: {
  assetId: string;
  view: MaintenanceView;
  members: Array<{ clerkUserId: string; label: string }>;
  /** Owner: setting a schedule up, and raising jobs off one. */
  canEdit: boolean;
  /**
   * Member: recording that the work happened, and reading the meter. **NOT
   * `canEdit`** — the whole panel used to hang off that one prop, which meant
   * nobody but the owner could log an oil change, on a pack whose ops layer is
   * `member`-level for exactly that reason. See `maintenance-ops.ts:379-385`.
   */
  canRecord: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState("calendar");
  const revalidate = `/dashboard/m/assets/${assetId}`;

  function run(
    fn: () => Promise<{ error?: string } | { ok: boolean }>,
    ok: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(ok);
      setAddOpen(false);
      router.refresh();
    });
  }

  return (
    <Panel className="p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-semibold tracking-heading">
              Maintenance
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              What needs doing, and when it was last done.
            </p>
          </div>
          {canEdit && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Add schedule
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <form
                  action={(fd) =>
                    run(
                      () =>
                        addMaintenanceScheduleAction({
                          assetId,
                          name: String(fd.get("name") ?? ""),
                          kind,
                          intervalMonths:
                            kind === "calendar"
                              ? Number(fd.get("intervalMonths"))
                              : null,
                          intervalMeter:
                            kind === "meter"
                              ? Number(fd.get("intervalMeter"))
                              : null,
                          meterUnit: String(fd.get("meterUnit") ?? "hours"),
                        }),
                      "Schedule added",
                    )
                  }
                >
                  <DialogHeader>
                    <DialogTitle>Add a service schedule</DialogTitle>
                    <DialogDescription>
                      A calendar schedule comes round on a date. A meter one
                      comes round on hours run, so a machine that sat all winter
                      does not fall due.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="name">What needs doing</Label>
                      <Input id="name" name="name" required maxLength={200} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="kind">Comes round by</Label>
                      <Select value={kind} onValueChange={setKind}>
                        <SelectTrigger id="kind">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="calendar">Time</SelectItem>
                          <SelectItem value="meter">Hours or miles</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {kind === "calendar" ? (
                      <div className="grid gap-2">
                        <Label htmlFor="intervalMonths">Every (months)</Label>
                        <Input
                          id="intervalMonths"
                          name="intervalMonths"
                          type="number"
                          min="1"
                          defaultValue="12"
                          required
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="intervalMeter">Every</Label>
                          <Input
                            id="intervalMeter"
                            name="intervalMeter"
                            type="number"
                            min="1"
                            defaultValue="100"
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="meterUnit">Unit</Label>
                          <Input
                            id="meterUnit"
                            name="meterUnit"
                            defaultValue="hours"
                            maxLength={20}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={pending}>
                      {pending ? "Saving…" : "Add"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {view.schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No schedules yet. Add one for anything that comes round — a service,
            an inspection, a filter.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {view.schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <span
                  className={
                    s.status === "due"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {s.summary}
                </span>
                {s.hasOpenWork && <Badge variant="outline">raised</Badge>}
                {canRecord && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          recordServiceAction({
                            assetId,
                            scheduleId: s.id,
                            performedOn: view.today,
                            meterReading: view.currentMeter,
                          }),
                        "Recorded",
                      )
                    }
                  >
                    Mark done today
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {(canEdit || canRecord) && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            {/* Raising a job is the owner's, and reading the meter is not.
                They share a row because they are the two things you do at the
                foot of this panel, not because they share a rule. */}
            {canEdit && view.dueCount > 0 && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => raiseMaintenanceWorkAction({ assetId }), "Raised")
                }
              >
                {`Raise ${view.dueCount} due ${view.dueCount === 1 ? "job" : "jobs"}`}
              </Button>
            )}
            {canRecord && (
            <form
              className="flex items-end gap-2"
              action={(fd) =>
                run(
                  () =>
                    recordMeterReadingAction({
                      assetId,
                      readOn: view.today,
                      reading: Number(fd.get("reading")),
                      unit: view.meterUnit,
                    }),
                  "Reading recorded",
                )
              }
            >
              <div className="grid gap-1">
                <Label htmlFor="reading" className="text-xs">
                  {view.currentMeter === null
                    ? `Current ${view.meterUnit}`
                    : `Current ${view.meterUnit} (was ${view.currentMeter})`}
                </Label>
                <Input
                  id="reading"
                  name="reading"
                  type="number"
                  min="0"
                  className="h-8 w-32"
                  required
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={pending}
              >
                Record
              </Button>
            </form>
            )}
          </div>
        )}

        {view.work.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-medium">Raised from this asset</h3>
            {view.work.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{item.title}</span>
                {/* THE SHARED ROW — same component, same verbs, as a CRM
                    follow-up. Nothing about work was re-implemented here. */}
                <WorkItemRow
                  item={item}
                  members={members}
                  revalidate={revalidate}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
