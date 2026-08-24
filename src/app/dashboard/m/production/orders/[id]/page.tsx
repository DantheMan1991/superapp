import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { slugLabel } from "@/packs/production/vocabulary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrder } from "@/packs/production/order-ops";
import { getProcessor } from "@/packs/production/processor-ops";
import { runDetail } from "@/packs/production/ops";
import { CutSheet } from "@/packs/production/components/cut-sheet";
import {
  PrintOrderButton,
  RemoveOrderButton,
} from "@/packs/production/components/order-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * ONE CUT SHEET — the thing you hand the plant.
 *
 * **IT HAS ITS OWN PAGE BECAUSE IT EXISTS BEFORE THE RUN DOES.** The sheet goes
 * over with the animals at drop-off, and a run is not created until the day
 * happens. A sheet reachable only from a run would be a sheet written after the
 * animals were already cut — which is not when anybody writes one.
 *
 * **PRINTING IS THE POINT OF THE PAGE.** `print:` variants strip everything
 * that is not the sheet and reveal a header that exists only on paper. No
 * separate print route: the plant has to be handed exactly what the screen
 * says, and two copies of the same content is how those two drift apart.
 */
export default async function CutSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const detail = await getOrder(tx, ctx.tenant.id, id);
      if (!detail) return null;
      const [processor, pack] = await Promise.all([
        getProcessor(tx, ctx.tenant.id, detail.order.processorId),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
      ]);
      /**
       * The run's own fold, for the quantities. Fetched only once the sheet has
       * become a run — before that there is nothing to measure, and every line
       * priced per pound is honestly uncounted rather than nought.
       */
      const run = detail.order.runId
        ? await runDetail(tx, ctx.tenant.id, detail.order.runId, today)
        : null;
      /**
       * The day the sheet was written against comes with the order now —
       * `getOrder` resolves it, because every screen listing sheets needed the
       * same join and the printed header was doing it by hand.
       */
      return { detail, processor, pack, run, bookedFor: detail.bookedFor };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { detail, processor, pack, run, bookedFor } = data;
  const { order, lines, processorName } = detail;

  const sheetWord = labelFor(pack.labels, "cutSheet", "Order");
  const runWord = labelFor(pack.labels, "productionRun", "Run");
  const isOpen = run === null || run.run.status === "in_progress";

  const feeByLine = new Map(
    (run?.quotedFee?.lines ?? []).map((line) => [line.key, line]),
  );
  const lineIds = new Set(lines.map((l) => l.id));
  // This sheet's own share of the run's quote. A run can carry two sheets and
  // adding the other one's total in here would be this page claiming a figure
  // that belongs to somebody else's half of the animal.
  const mine = (run?.quotedFee?.lines ?? []).filter((l) => lineIds.has(l.key));
  const quotedCents = mine.reduce((total, l) => total + (l.cents ?? 0), 0);
  const uncounted = mine.filter(
    (l) => l.cents === null && feeByLine.get(l.key) !== undefined,
  );

  return (
    <div className="space-y-6">
      {/*
        THE PRINTED SHEET'S ONLY HEADER, and it exists nowhere on screen.
        Whoever is handed this needs to know whose animals these are and who it
        is for; the page's own header carries controls that mean nothing on
        paper.
      */}
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">
          {sheetWord} — {order.title || processorName}
        </h1>
        <p className="text-sm">
          For {processorName}
          {order.kind !== "" ? ` · ${slugLabel(order.kind)}` : ""}
          {order.headCount !== null ? ` · ${order.headCount} head` : ""}
        </p>
        {/*
          **THE DATE, AND IT WAS MISSING** — found by printing one on the live
          `Test` tenant, 2026-08-23. The header named the plant, the animal and
          the head count, and said WHEN only when a run already existed. A sheet
          written against a September booking printed with nothing on it to say
          which day it was for, which is the one fact a plant needs most: they
          are holding a date, and the paper that arrives with the animals has to
          match it.

          The run's day wins once there is one, because that is when the work
          actually happened; the booking's day is the promise it was written
          against. Both are printed when they differ, since a sheet written for
          the 10th and used on the 12th is a real thing to be able to see.
        */}
        <p className="text-sm">
          {run ? `${run.run.startedOn} · ${run.run.code}` : null}
          {run && bookedFor && bookedFor !== run.run.startedOn
            ? ` · booked for ${bookedFor}`
            : null}
          {!run && bookedFor ? `Booked for ${bookedFor}` : null}
          {!run && !bookedFor ? "No day set" : null}
        </p>
      </div>

      <div className="print:hidden">
        {/*
          BACK TO THE LIST THIS PAGE BELONGS TO, which until 2f did not exist —
          a sheet with no run sent you to Booked dates, which is where it was
          written rather than where it lives.
        */}
        <Link
          href={order.runId ? `${BASE}/${order.runId}` : `${BASE}/orders`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {order.runId ? runWord : `Every ${sheetWord.toLowerCase()}`}
        </Link>
      </div>

      <PageHeader
        className="print:hidden"
        title={order.title || sheetWord}
        description={`For ${processorName}${
          run
            ? ` · ${run.run.code} · ${run.run.startedOn}`
            : bookedFor
              ? ` · booked for ${bookedFor}`
              : " · not yet a processing day"
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PrintOrderButton id={order.id} sheetWord={sheetWord} />
            {isOpen && <RemoveOrderButton id={order.id} sheetWord={sheetWord} />}
          </div>
        }
      />

      <Card className="print:border-0 print:shadow-none">
        <CardHeader className="print:hidden">
          <CardTitle className="text-base">What they were asked to do</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CutSheet
            order={order}
            lines={lines}
            feeByLine={feeByLine}
            editable={isOpen}
            priceOptions={(processor?.priceItems ?? []).map((item) => ({
              id: item.id,
              kind: item.kind,
              category: item.category,
              label: item.label,
              variant: item.variant,
              headMin: item.headMin,
              headMax: item.headMax,
              priceCents: item.priceCents,
              unit: item.unit,
              minimumCents: item.minimumCents,
            }))}
            currencySymbol={currencySymbol}
            sheetWord={sheetWord}
          />

          {/*
            WHAT IT COMES TO — a QUOTE, and the copy says so in those words.
            Screen only: the plant knows its own rates, and printing the farm's
            running total onto a document handed across a counter is an
            unforced disclosure.
          */}
          {mine.length > 0 && (
            <div className="space-y-1 border-t pt-3 print:hidden">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">
                  {run ? "Quoted" : "Quoted, once there is a day to measure"}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(quotedCents, currencySymbol)}
                </span>
              </div>
              {uncounted.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {/*
                    **NO FULL STOP AFTER THE LIST** — a label routinely ends in
                    one ("Vacuum Shrink Pkg.") and the sentence added a second,
                    which is what a real rate sheet's own punctuation does to
                    copy that assumes it will not.
                  */}
                  {uncounted.length}{" "}
                  {uncounted.length === 1 ? "line has" : "lines have"} not been
                  counted — {uncounted.map((l) => l.label).join(", ")} — so the
                  real figure is higher than this.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  What their price list says this comes to. What they actually
                  billed is what goes on the {runWord.toLowerCase()}, and keeping
                  the two apart is what makes &ldquo;they charged more than they
                  said&rdquo; a question the data can answer.
                </p>
              )}
            </div>
          )}

          {!run && (
            <p className="text-xs text-muted-foreground print:hidden">
              <Badge variant="outline" className="mr-2">
                Not yet a {runWord.toLowerCase()}
              </Badge>
              Nothing charged per head or per pound can be worked out until the
              day happens and there are weights to measure against.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
