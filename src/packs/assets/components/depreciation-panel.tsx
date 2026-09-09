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
import {
  postDepreciationAction,
  recordAssetOpeningAction,
  updateAssetAction,
} from "../actions";
import { openingBlockedMessage } from "../vocabulary";

/**
 * What the asset page knows about putting something owned before the books
 * began onto them (ADR 0038). Absent when the tenant keeps no books.
 */
export interface AssetOpeningView {
  booksStartOn: string | null;
  /** The server's own reason, or null when it can be recorded. */
  blocked: string | null;
  /** Dollars as a string, for the field's starting value. */
  suggestionInput: string;
  /** Pre-formatted, like every other figure this component shows. */
  suggestionLabel: string;
  throughPeriod: string | null;
  costLabel: string;
  /** True once it is on the books — the section then states that and nothing more. */
  recorded: boolean;
}

export interface DepreciationView {
  method: string;
  inServiceOn: string | null;
  usefulLifeMonths: number | null;
  /** Dollars as a string for the number input. */
  salvageInput: string;
  /** Pre-formatted on the server — this component never formats money. */
  costLabel: string;
  postedToDateLabel: string | null;
  bookValueLabel: string | null;
  dueCount: number;
  dueTotalLabel: string | null;
  /** Of `dueCount`, how many fall before the close and collapse into one entry. */
  strandedCount: number;
  catchUpPeriod: string | null;
  /** `YYYY-MM` the tenant is currently in. */
  currentPeriod: string;
  scheduleLength: number;
  postedCount: number;
}

/**
 * Depreciation: what the schedule is, and posting what is due.
 *
 * Setting up a schedule lives here rather than in the main Edit dialog because
 * the four fields move together — the database refuses a method without an
 * in-service date, a life and a cost — and a form where three fields are
 * conditionally required on a fourth is a worse explanation than a separate
 * panel that is either configured or not.
 */
export function DepreciationPanel({
  assetId,
  view,
  opening,
  canEdit,
}: {
  assetId: string;
  view: DepreciationView;
  opening?: AssetOpeningView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState(view.method);
  const [openingAmount, setOpeningAmount] = useState(
    opening?.suggestionInput ?? "",
  );

  const configured = view.method !== "none";

  function recordOpening() {
    const cents = Math.round(Number(openingAmount || "0") * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    startTransition(async () => {
      const result = await recordAssetOpeningAction({ id: assetId, accumulatedCents: cents });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Put on the books as of ${result.entryDate}`);
      setOpeningOpen(false);
      router.refresh();
    });
  }

  function saveSchedule(formData: FormData) {
    const rawSalvage = String(formData.get("salvage") ?? "").trim();
    const rawLife = String(formData.get("lifeYears") ?? "").trim();
    startTransition(async () => {
      const result = await updateAssetAction({
        id: assetId,
        depreciationMethod: method,
        // Years in the field, months on the wire. People think in years; a
        // 7-year life is 84 months and nobody wants to do that arithmetic.
        usefulLifeMonths:
          method === "none" || !rawLife ? null : Math.round(Number(rawLife) * 12),
        inServiceOn:
          method === "none" ? null : String(formData.get("inServiceOn") ?? ""),
        salvageValueCents:
          method === "none" || !rawSalvage
            ? null
            : Math.round(Number(rawSalvage) * 100),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(method === "none" ? "Depreciation turned off" : "Schedule saved");
      setSetupOpen(false);
      router.refresh();
    });
  }

  function post() {
    startTransition(async () => {
      const result = await postDepreciationAction({
        id: assetId,
        through: view.currentPeriod,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const n = result.postedPeriods?.length ?? 0;
      toast.success(
        n === 0
          ? "Nothing was due"
          : `Posted ${n} ${n === 1 ? "month" : "months"} of depreciation`,
      );
      router.refresh();
    });
  }

  return (
    <Panel className="p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-semibold tracking-heading">
              Depreciation
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {configured
                ? "Straight-line, posted a month at a time."
                : "Not depreciated."}
            </p>
          </div>
          {canEdit && (
            <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {configured ? "Edit schedule" : "Set up"}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <form action={saveSchedule}>
                  <DialogHeader>
                    <DialogTitle>Depreciation schedule</DialogTitle>
                    <DialogDescription>
                      Cost is {view.costLabel}. Depreciation writes that down to
                      the salvage value over the life, and stops there.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="method">Method</Label>
                      <Select value={method} onValueChange={setMethod}>
                        <SelectTrigger id="method">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            Not depreciated (land, held for resale)
                          </SelectItem>
                          <SelectItem value="straight_line">
                            Straight line
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {method !== "none" && (
                      <>
                        <div className="grid gap-2">
                          <Label htmlFor="inServiceOn">Placed in service</Label>
                          <Input
                            id="inServiceOn"
                            name="inServiceOn"
                            type="date"
                            defaultValue={view.inServiceOn ?? ""}
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            When it started being used — not necessarily when it
                            was bought.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="lifeYears">Useful life (years)</Label>
                            <Input
                              id="lifeYears"
                              name="lifeYears"
                              type="number"
                              min="0.5"
                              step="0.5"
                              defaultValue={
                                view.usefulLifeMonths
                                  ? String(view.usefulLifeMonths / 12)
                                  : ""
                              }
                              required
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="salvage">Salvage value</Label>
                            <Input
                              id="salvage"
                              name="salvage"
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={view.salvageInput}
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <DialogFooter>
                    <Button type="submit" disabled={pending}>
                      {pending ? "Saving…" : "Save"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            Land and anything held for resale are never written down. Everything
            else usually is.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-3 text-sm">
              <dt className="text-muted-foreground">In service</dt>
              <dd className="tabular-nums">{view.inServiceOn ?? "—"}</dd>

              <dt className="text-muted-foreground">Life</dt>
              <dd className="tabular-nums">
                {view.usefulLifeMonths
                  ? `${view.usefulLifeMonths / 12} years (${view.usefulLifeMonths} months)`
                  : "—"}
              </dd>

              <dt className="text-muted-foreground">Posted to date</dt>
              <dd className="tabular-nums">
                {view.postedToDateLabel ?? "—"}
                <span className="ml-2 text-xs text-muted-foreground">
                  {view.postedCount} of {view.scheduleLength} months
                </span>
              </dd>

              <dt className="text-muted-foreground">Book value</dt>
              <dd className="tabular-nums font-medium">
                {view.bookValueLabel ?? "—"}
              </dd>
            </dl>

            {canEdit && (
              <div className="mt-4 flex items-center gap-3 border-t pt-4">
                {view.dueCount === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Up to date through {view.currentPeriod}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Button onClick={post} disabled={pending} size="sm">
                        {pending
                          ? "Posting…"
                          : `Post ${view.dueCount} ${view.dueCount === 1 ? "month" : "months"}`}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {view.dueTotalLabel} due through {view.currentPeriod}
                      </span>
                    </div>
                    {view.strandedCount > 0 && (
                      // Said BEFORE the button is pressed. The first version of
                      // this shipped without it, offered "Post 3 months", and
                      // was refused by the ledger with a closed-period error.
                      <p className="text-xs text-muted-foreground">
                        {view.strandedCount}{" "}
                        {view.strandedCount === 1 ? "month falls" : "months fall"}{" "}
                        before your closing date and will be combined into one
                        catch-up entry dated {view.catchUpPeriod}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {view.postedCount > 0 && view.postedCount === view.scheduleLength && (
              <Badge variant="outline" className="mt-4">
                fully depreciated
              </Badge>
            )}
          </>
        )}

        {/**
         * OWNED BEFORE THE BOOKS BEGAN (ADR 0038). Outside the `configured`
         * branch on purpose: a barn that is never depreciated still has to
         * reach the balance sheet on day one. Shown only while it is a real
         * question — the tenant keeps books, and this is not already on them.
         */}
        {opening && opening.blocked !== "not_before_start" && (
          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-medium">Owned before your books began</h3>
            {opening.recorded ? (
              <p className="mt-1 text-sm text-muted-foreground">
                On the books as of {opening.booksStartOn}, at {opening.costLabel} less
                what had been written off by then.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  Put its cost and the depreciation already taken on the books, dated
                  {opening.booksStartOn ? ` ${opening.booksStartOn}` : " the day they begin"}.
                  {opening.throughPeriod
                    ? ` Months up to ${opening.throughPeriod} then count as already posted.`
                    : ""}
                </p>
                {opening.blocked ? (
                  <p className="mt-2 text-xs text-amber-600">
                    {openingBlockedMessage(opening.blocked)}
                  </p>
                ) : (
                  canEdit && (
                    <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="mt-3">
                          Put it on the books
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Owned before your books began</DialogTitle>
                          <DialogDescription>
                            Two entries dated {opening.booksStartOn}: its cost of{" "}
                            {opening.costLabel} against Opening Balance Equity, and what
                            had been written off by then against accumulated
                            depreciation. Nothing before that day is touched.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-2 py-4">
                          <Label htmlFor="openingAccumulated">
                            Depreciation already taken
                          </Label>
                          <Input
                            id="openingAccumulated"
                            type="number"
                            min="0"
                            step="0.01"
                            value={openingAmount}
                            onChange={(e) => setOpeningAmount(e.target.value)}
                            placeholder="0.00"
                          />
                          <p className="text-xs text-muted-foreground">
                            {opening.throughPeriod
                              ? `What your old books had written off by ${opening.booksStartOn}. This schedule would have taken ${opening.suggestionLabel} through ${opening.throughPeriod} — use your own figure if it differs, and the asset finishes that much above or below its salvage value.`
                              : "What your old books had written off by then. Leave it at zero if none was taken."}
                          </p>
                        </div>

                        <DialogFooter>
                          <Button
                            variant="ghost"
                            onClick={() => setOpeningOpen(false)}
                            disabled={pending}
                          >
                            Cancel
                          </Button>
                          <Button onClick={recordOpening} disabled={pending}>
                            {pending ? "Recording…" : "Put it on the books"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
