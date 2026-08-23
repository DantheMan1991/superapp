import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listProcessors } from "@/packs/production/processor-ops";
import {
  INSPECTION_LABELS,
  inspectionNote,
  LABELLING_LABELS,
  RATING_LABELS,
  centsToDisplay,
  processorHandlesFrom,
  slugLabel,
} from "@/packs/production/vocabulary";
import { ReadPriceListDialog } from "@/packs/production/components/paperwork-controls";
import {
  AddCutDialog,
  AddProcessorDialog,
  EditProcessorDialog,
  HandleDialog,
  RemoveCutButton,
  RemoveHandleButton,
} from "@/packs/production/components/processor-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * The processor directory: who does the part of a run this business does not do
 * itself, and everything needed to choose between two of them.
 *
 * **THIS PAGE EXISTS BECAUSE THE CHOICE IS A REAL ONE AND IT IS MADE ON PAPER
 * TODAY.** The design records that the pilot already uses multiple butchers,
 * that the yield from an identical animal depends on where it went, and that
 * dates are booked six to twelve months ahead. All three are decisions somebody
 * makes from memory and a drawer of quotes.
 *
 * **WHAT IS DELIBERATELY NOT HERE YET: the measured half of a rating.** Dressing
 * percentage, condemnation rate and turnaround per processor are all ratios over
 * runs that already exist — but nothing yet says WHICH processor did a given
 * run, because that link arrives with the booking. So this screen shows the
 * farm's own view and says plainly that the measured comparison is not
 * available, rather than showing an empty chart that implies it is coming from
 * data nobody has.
 */
export default async function ProcessorsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");

  const { processors, pack } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [processors, pack] = await Promise.all([
        listProcessors(tx, ctx.tenant.id, { includeInactive: true }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
      ]);
      return { processors, pack };
    },
    { role: ctx.role },
  );

  const word = labelFor(pack.labels, "processor", "Processor");
  const kindOptions = processorHandlesFrom(pack.config);
  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={BASE}>
            <ChevronLeft className="size-4" />
            Production
          </Link>
        </Button>
      </div>

      {/* NEVER PLURALISE A LABEL — the rule `ProductionModule` records, learned
          when `+ "s"` rendered "No batchs yet" on the first screen anybody
          looked at. The word is the tenant's to rename and no code here knows
          how to make a plural of it, so the heading puts it in front of a noun
          that is already plural-safe and the empty state avoids it entirely. */}
      <PageHeader
        title={`${word} directory`}
        description={`Who does the work you do not do yourself — what they take, what they charge, how they are inspected, and what you think of them.`}
        actions={isOwner ? <AddProcessorDialog word={word} /> : null}
      />

      {processors.length === 0 ? (
        <EmptyState
          title="Nobody on the list yet"
          description={`Add the places you send work to. Dates at a good one go six to twelve months ahead, so the list is worth having well before the season it is needed for.`}
        />
      ) : (
        <div className="space-y-4">
          {processors.map(({ processor, name, handles, cuts }) => (
            <Card key={processor.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    {name}
                    {!processor.isActive && (
                      <Badge variant="outline">Not in use</Badge>
                    )}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge
                      variant={
                        processor.inspection === "unknown"
                          ? "outline"
                          : "secondary"
                      }
                    >
                      {INSPECTION_LABELS[processor.inspection]}
                    </Badge>
                    {processor.establishmentNumber !== "" && (
                      <span className="text-muted-foreground">
                        {processor.establishmentNumber}
                      </span>
                    )}
                    <Badge variant="outline">
                      {LABELLING_LABELS[processor.customLabelling]}
                    </Badge>
                    {processor.leadTimeDays !== null && (
                      <span className="text-muted-foreground">
                        Books {processor.leadTimeDays} days ahead
                      </span>
                    )}
                  </div>
                </div>
                {isOwner && (
                  <EditProcessorDialog
                    id={processor.id}
                    word={word}
                    initial={{
                      name,
                      inspection: processor.inspection,
                      establishmentNumber: processor.establishmentNumber,
                      customLabelling: processor.customLabelling,
                      labellingNotes: processor.labellingNotes,
                      leadTimeDays:
                        processor.leadTimeDays?.toString() ?? "",
                      rating: processor.rating?.toString() ?? "",
                      goodAt: processor.goodAt,
                      notes: processor.notes,
                    }}
                  />
                )}
              </CardHeader>

              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  {inspectionNote(processor.inspection, word)}
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">What they take</h3>
                    {isOwner && (
                      <div className="flex items-center gap-2">
                        <ReadPriceListDialog
                          processorId={processor.id}
                          kindOptions={kindOptions}
                          word={word}
                        />
                        <HandleDialog
                        processorId={processor.id}
                          kindOptions={kindOptions.filter(
                            (k) => !handles.some((h) => h.kind === k),
                          )}
                        />
                      </div>
                    )}
                  </div>
                  {handles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nobody has recorded what they will take. It is the
                      difference between a place that does birds and a place that
                      does everything.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {handles.map((handle) => {
                        const kill = centsToDisplay(handle.killFeeCents);
                        const cut = centsToDisplay(handle.cutWrapCentsPerLb);
                        const cutHead = centsToDisplay(
                          handle.cutFeeCentsPerHead,
                        );
                        return (
                          <li
                            key={handle.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1"
                          >
                            <span className="font-medium">
                              {slugLabel(handle.kind)}
                            </span>
                            {handle.capacityPerDay !== null && (
                              <span className="text-muted-foreground">
                                {handle.capacityPerDay}/day
                              </span>
                            )}
                            {/* A missing fee reads as a question, never as $0.00. */}
                            <span className="text-muted-foreground">
                              {kill ? `${kill} a head` : "Kill fee not quoted"}
                            </span>
                            {/* Whichever ways they quoted. A plant that gave
                                neither says so once, not twice. */}
                            {cut && (
                              <span className="text-muted-foreground">
                                {cut} a lb cut and wrap
                              </span>
                            )}
                            {cutHead && (
                              <span className="text-muted-foreground">
                                {cutHead} a head to cut
                              </span>
                            )}
                            {!cut && !cutHead && (
                              <span className="text-muted-foreground">
                                Cutting not quoted
                              </span>
                            )}
                            {handle.priceNotes !== "" && (
                              <span className="text-muted-foreground">
                                {handle.priceNotes}
                              </span>
                            )}
                            {isOwner && (
                              <span className="ml-auto flex items-center">
                                <HandleDialog
                                  processorId={processor.id}
                                  kindOptions={kindOptions}
                                  existing={{
                                    id: handle.id,
                                    kind: handle.kind,
                                    capacityPerDay: handle.capacityPerDay,
                                    killFeeCents: handle.killFeeCents,
                                    cutWrapCentsPerLb:
                                      handle.cutWrapCentsPerLb,
                                    cutFeeCentsPerHead:
                                      handle.cutFeeCentsPerHead,
                                    priceNotes: handle.priceNotes,
                                  }}
                                />
                                <RemoveHandleButton id={handle.id} />
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">Cuts they do</h3>
                    {isOwner && (
                      <AddCutDialog
                        processorId={processor.id}
                        kindOptions={kindOptions}
                      />
                    )}
                  </div>
                  {cuts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing recorded.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {cuts.map((cut) => (
                        <li
                          key={cut.id}
                          className="flex flex-wrap items-center gap-x-3"
                        >
                          <span>{cut.name}</span>
                          {cut.kind !== "" && (
                            <Badge variant="outline">
                              {slugLabel(cut.kind)} only
                            </Badge>
                          )}
                          {cut.notes !== "" && (
                            <span className="text-muted-foreground">
                              {cut.notes}
                            </span>
                          )}
                          {isOwner && (
                            <span className="ml-auto">
                              <RemoveCutButton id={cut.id} />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-medium">What you think</h3>
                  {processor.rating === null && processor.goodAt === "" ? (
                    <p className="text-sm text-muted-foreground">
                      No view recorded.
                    </p>
                  ) : (
                    <p className="text-sm">
                      {processor.rating !== null && (
                        <span className="font-medium">
                          {processor.rating} — {RATING_LABELS[processor.rating]}
                          {processor.goodAt !== "" ? ". " : ""}
                        </span>
                      )}
                      {processor.goodAt}
                    </p>
                  )}
                  {/*
                    Said out loud rather than shown as an empty panel. Nothing
                    yet records WHICH processor did a given run, so a measured
                    comparison would have no data behind it — and a chart with
                    no data reads as "no difference" rather than "not asked".
                  */}
                  <p className="text-xs text-muted-foreground">
                    Your view, and the only one available yet. Yield,
                    condemnation rate and turnaround can only be compared once a
                    run says which {word.toLowerCase()} did it, which arrives
                    with booking.
                  </p>
                </div>

                {processor.labellingNotes !== "" && (
                  <p className="text-sm text-muted-foreground">
                    Labels: {processor.labellingNotes}
                  </p>
                )}
                {processor.notes !== "" && (
                  <p className="text-sm text-muted-foreground">
                    {processor.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
