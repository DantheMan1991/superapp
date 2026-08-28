import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, ClipboardList, Factory, PackageOpen } from "lucide-react";
import { ProductionNav } from "@/packs/production/components/production-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/app/data-table";
import { Panel } from "@/components/app/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  balanceByLots,
  listLocations,
  listLots,
} from "@/packs/inventory/ops";
import { formatQuantity, getUnit } from "@/packs/inventory/core/units";
import { inputBlocks, listRunItems, runDetail } from "@/packs/production/ops";
import { AddOrderDialog } from "@/packs/production/components/order-controls";
import {
  COST_BASIS_LABELS,
  COST_BASIS_NOTES,
  RUN_STATUS_LABELS,
  INSPECTION_LABELS,
  inspectionNote,
  PATH_LABELS,
  processorHandlesFrom,
  slugLabel,
  type RunStatus,
} from "@/packs/production/vocabulary";
import {
  YIELD_REFUSALS,
  formatLb,
  formatRatio,
  yieldWarning,
} from "@/packs/production/core/yield";
import {
  LIVE_SOURCE_NOTES,
  STAGE_REFUSALS,
  formatCondemned,
  reasonLabel,
} from "@/packs/production/core/carcass";
import {
  AddInputForm,
  AddOutputForm,
  CompleteRunButton,
  RemoveOutputButton,
} from "@/packs/production/components/run-controls";
import {
  CarcassDialog,
  RemoveCarcassButton,
} from "@/packs/production/components/carcass-controls";
import { ReadKillSheetDialog } from "@/packs/production/components/paperwork-controls";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * One run: what went in, what came out, and the ratio between them.
 *
 * **THREE THINGS ON THIS PAGE ARE NOT AVAILABLE ANYWHERE ELSE IN THE APP**, and
 * each is a load-bearing part of the design:
 *
 *   - **The yield**, folded from the weights and refused with a reason when they
 *     are not all there.
 *   - **What the run is holding.** Between the animals leaving and the boxes
 *     landing, their cost is on no shelf — work in progress, which every
 *     accounting system models and no farm app does.
 *   - **Why a batch cannot go in.** The withdrawal clock has been loud on four
 *     livestock screens since it was built and has refused nothing, because
 *     nothing existed to refuse. It refuses here.
 */
/**
 * One stage ratio, or the sentence that stands where it would have been.
 *
 * **THE REFUSAL IS RENDERED AT THE SAME SIZE AS THE ANSWER**, which is the rule
 * `livestock` arrived at for FCR: for a farm's first season the reason is the
 * useful half, and *"the sheet accounts for fewer head than went in"* is an
 * instruction where a blank cell is a shrug.
 */
function StageRatio({
  title,
  ratio,
  detail,
  refusal,
  caveat,
}: {
  title: string;
  ratio: number | null;
  detail: string;
  refusal: string | null;
  caveat?: string | null;
}) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {ratio === null ? (
        <>
          <div className="mt-1 text-2xl font-semibold text-muted-foreground">—</div>
          <p className="mt-1 text-xs text-muted-foreground">{refusal}</p>
        </>
      ) : (
        <>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatRatio(ratio)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          {caveat && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
              {caveat}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default async function ProductionRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  // Only signpost a module this tenant actually has — the "button that leads to
  // a 404" mistake `land` made with its parcel finder.
  const inventoryEnabled = await isModuleEnabled(ctx.tenant.id, "inventory");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const detail = await runDetail(tx, ctx.tenant.id, id, today);
      if (!detail) return null;

      const [items, lots, locations, pack] = await Promise.all([
        listRunItems(tx, ctx.tenant.id),
        listLots(tx, ctx.tenant.id, { status: "open" }),
        listLocations(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
      ]);

      const lotIds = lots.map((l) => l.id);
      const [balances, blocks] = await Promise.all([
        balanceByLots(tx, ctx.tenant.id, lotIds),
        // Asked for EVERY open batch, not only the ones already on the run, so
        // the picker can grey out a blocked pen instead of accepting it and
        // then refusing.
        inputBlocks(tx, ctx.tenant.id, lotIds, today),
      ]);

      return { detail, items, lots, locations, pack, balances, blocks };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { detail, items, lots, locations, pack, balances, blocks } = data;
  const { run, inputs, outputs, yieldResult, carcasses, tally } = detail;
  const isOwner = ctx.role === "owner";
  const isOpen = run.status === "in_progress";
  const runWord = labelFor(pack.labels, "productionRun", "Run");
  /**
   * **THE ONE PLACE THIS PACK SAYS SOMETHING INDUSTRY-SHAPED OUT LOUD**, and it
   * is a label rather than a rule, which is the cheapest form for it to take. A
   * profile whose runs are bakes overrides it and nothing else changes; the
   * fallback is here rather than in `vocabulary.ts` so it stays visible.
   */
  const sheetWord = labelFor(pack.labels, "killSheet", "Kill sheet");
  const cutSheetWord = labelFor(pack.labels, "cutSheet", "Order");
  const processorWord = labelFor(pack.labels, "processor", "Processor");
  const kindOptions = processorHandlesFrom(pack.config);
  // One lookup rather than a find() per line — the fee was already folded once
  // and looking it up twice is how a screen ends up printing two different
  // answers to the same question.
  const feeByLine = new Map(
    (detail.quotedFee?.lines ?? []).map((line) => [line.key, line]),
  );

  const carcassInputs = inputs.map((row) => ({
    id: row.id,
    label: `${row.lotCode ?? "—"} · ${row.itemName} · ${formatQuantity(
      row.quantity,
      row.unit,
    )}`,
  }));
  const carcassById = new Map(carcassInputs.map((i) => [i.id, i.label]));
  // Both are null together — there is nothing to reconcile a sheet against when
  // no input on the run is counted. Pulled out so the narrowing survives into
  // the JSX below.
  const headIn = tally.headIn;
  const headUnaccounted = tally.headUnaccounted;

  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemOptions = items.map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.stockingUnit,
    // A mass-stocked item needs no separate weight: the quantity already is one.
    weighed: getUnit(i.stockingUnit)?.dimension === "mass",
  }));
  const lotOptions = lots.map((l) => {
    const block = blocks.get(l.id);
    const item = itemById.get(l.itemId);
    return {
      id: l.id,
      itemId: l.itemId,
      code: l.code,
      balanceLabel: formatQuantity(
        balances.get(l.id) ?? null,
        item?.stockingUnit ?? "each",
      ),
      blockedBecause: block?.reason ?? null,
      blockedHeadline: block?.headline ?? null,
    };
  });
  const places = locations.map((l) => ({ id: l.id, name: l.name }));

  // What the run is still holding: it took this much cost out of stock and has
  // put this much back. Zero on both sides of a finished run is the honest
  // answer for a run over stock nobody ever put a price on.
  const heldCents = detail.potCents - detail.landedCents;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Factory />}
        title={run.code}
        description={`${slugLabel(run.runKind)} · started ${run.startedOn}${
          run.completedOn ? ` · finished ${run.completedOn}` : ""
        }${run.performedBy ? ` · ${run.performedBy}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isOpen ? "default" : "outline"}>
              {RUN_STATUS_LABELS[run.status as RunStatus] ?? run.status}
            </Badge>
            {/*
              THE PROCESSING PATH, beside the status because it is the other
              thing that governs what came out of this run. Derived from whether
              a processor is named — never a column of its own, because two
              answers to one question disagree.
            */}
            <Badge variant="outline">
              {detail.processorName
                ? `${PATH_LABELS.sent_out} · ${detail.processorName}`
                : PATH_LABELS.on_farm}
            </Badge>
            {run.inspection && (
              <Badge
                variant={
                  run.inspection === "uninspected" ||
                  run.inspection === "unknown"
                    ? "outline"
                    : "secondary"
                }
              >
                {INSPECTION_LABELS[run.inspection] ?? run.inspection}
              </Badge>
            )}
            {isOpen && (
              <>
                <AddInputForm
                  runId={run.id}
                  items={itemOptions}
                  lots={lotOptions}
                  today={today}
                />
                <AddOutputForm
                  runId={run.id}
                  runCode={run.code}
                  items={itemOptions}
                  locations={places}
                  /* Creating a stock line is `createItem`, which is owner-only
                     because an item is a thing the business is made of rather
                     than a thing that happened to it. Offering the option to
                     somebody who would be refused is the half-thing
                     `inventory`'s own kind picker had to close. */
                  canCreateItem={isOwner}
                />
                {isOwner && (
                  <CompleteRunButton
                    runId={run.id}
                    runWord={runWord}
                    outputCount={outputs.length}
                    potCents={detail.potCents}
                    currencySymbol={currencySymbol}
                    today={today}
                    processorName={detail.processorName}
                    quotedFeeCents={detail.quotedFee?.cents ?? null}
                    quotedFeeUnpriced={detail.quotedFee?.unpriced.length ?? 0}
                  />
                )}
              </>
            )}
          </div>
        }
      />

      <ProductionNav
        sheetWord={cutSheetWord}
        processorWord={processorWord}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="p-5">
          <p className="text-[13px] text-muted-foreground">
              Yield
          </p>
          <div className="mt-1">
            {yieldResult.yield ? (
              <>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatRatio(yieldResult.yield.ratio)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatLb(yieldResult.yield.outLb)} out of{" "}
                  {formatLb(yieldResult.yield.inLb)} in. Measured on this run —
                  never a stored factor, because the next one will differ.
                </p>
                {/* **OVER 100% IS NOT A GOOD DAY** (livestock slice 8d, applied
                    where the number lives). Weight is not created by cutting an
                    animal up, so this is an unweighed input, an output weighed
                    in its packaging, or somebody else's cuts on this run. Said
                    rather than suppressed: the fold already refuses partial
                    weights, so anything reaching here is honestly reporting
                    what was entered. */}
                {yieldWarning(yieldResult.yield.ratio) && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    {yieldWarning(yieldResult.yield.ratio)}
                  </p>
                )}
                {/**
                 * **THE DENOMINATOR STILL SAYS EVERYTHING THAT WENT IN, and the
                 * sheet does not change it.** That was slice 0's call and it was
                 * the right one: a run that lost one to condemnation should read
                 * as a low yield that is visible, not a normal one with a hidden
                 * correction. What was missing was the explanation, and the
                 * sheet is it — so the number stays put and gains a sentence.
                 */}
                {tally.headCondemned > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
                    {formatCondemned(tally)}, and they are still in the pounds
                    that went in. This number is meant to read low when that
                    happens — the {sheetWord.toLowerCase()} below says by how
                    much and why.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="text-2xl font-semibold text-muted-foreground">
                  —
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {YIELD_REFUSALS[yieldResult.refusedBecause]}
                </p>
              </>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <p className="text-[13px] text-muted-foreground">
              Cost in
          </p>
          <div className="mt-1">
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(detail.potCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {/* NOT AN ERROR TALLY. Raised stock has no purchase basis and an
                  invoice can be late; the design is explicit that a model
                  insisting every input has a price will be lied to. */}
              {detail.unpricedInputs > 0
                ? `${detail.unpricedInputs} of ${inputs.length} carried no price at all — real stock with no invoice behind it, not an error.`
                : "What the batches that went in had accumulated, stamped as they left."}
            </p>
            {/**
             * **WHY THIS CAN BE LESS THAN THE BATCH APPEARS TO HAVE COST.**
             *
             * Found by driving on a real pen: its own page showed $141.67 of
             * feed and the run carried $43.15, with nothing anywhere to get from
             * one figure to the other. Only cost that was STAMPED on a movement
             * can travel — an estimate worked out at read time was never money
             * on the ledger, and turning it into a stamped receipt here would
             * make an estimate permanent.
             *
             * Deliberately worded without naming what the estimate is OF. A
             * shared feeder is `livestock`'s idea and this pack must not know
             * what one is; the batch's own page says that half, in the words of
             * the pack that owns the distinction.
             */}
            {inputs.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Only cost stamped on the ledger travels. Anything a batch carries
                as an estimate stays with the batch.
              </p>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <p className="text-[13px] text-muted-foreground">
              {isOpen ? "Held by this run" : "Landed in stock"}
          </p>
          <div className="mt-1">
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(isOpen ? heldCents : detail.landedCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isOpen
                ? "Off the shelf and not yet on another one — work in progress. It lands when the run is finished."
                : run.costBasis
                  ? `${COST_BASIS_LABELS[run.costBasis] ?? run.costBasis}. ${
                      COST_BASIS_NOTES[run.costBasis] ?? ""
                    }`
                  : "Landed."}
            </p>
          </div>
        </Panel>
      </div>

      {/*
        THE CUT SHEETS — what this farm asked the plant to do, and what it comes
        to. **THE WHOLE CARD IS `print:` VISIBLE AND EVERYTHING ELSE ON THE PAGE
        IS NOT**, which is what makes Print hand over the sheet rather than the
        page: the yields, the ledger figures and the controls are the farm's
        business, and the plant needs the instructions and nothing else.
      */}
      {/*
        THE CUT SHEETS ON THIS RUN — what the plant was asked to do, and what
        that comes to.

        **A SUMMARY THAT LINKS OUT RATHER THAN THE SHEET ITSELF**, because the
        sheet has its own page: it exists before the run does (it goes over with
        the animals at drop-off) and it has to be printable on its own. Two
        renderings of the same lines is how a farm ends up handing over a sheet
        that says something the app no longer thinks it says.
      */}
      {(detail.orders.length > 0 || (isOpen && run.processorId)) && (
        <Panel className="p-5">
          <div className="flex flex-row items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-base font-semibold tracking-heading">
                {cutSheetWord}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                What {detail.processorName ?? "they"} were asked to do. One
                animal can carry two — a half sold to a customer is cut to their
                instructions, and the retained half to yours.
              </p>
            </div>
            {isOpen && run.processorId && (
              <AddOrderDialog
                processorId={run.processorId}
                processorName={detail.processorName ?? processorWord}
                runId={run.id}
                kindOptions={kindOptions}
                sheetWord={cutSheetWord}
              />
            )}
          </div>
          <div className="mt-4 space-y-3">
            {detail.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing asked for yet. What they cut is what you told them to
                cut, and the plant reads this rather than guessing.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.orders.map(({ order, lines }) => {
                  const mine = lines
                    .map((l) => feeByLine.get(l.id))
                    .filter((l) => l !== undefined);
                  const cents = mine.reduce(
                    (total, l) => total + (l.cents ?? 0),
                    0,
                  );
                  return (
                    <li
                      key={order.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 last:border-0"
                    >
                      <Link
                        href={`${BASE}/orders/${order.id}`}
                        className="font-medium hover:underline"
                      >
                        {order.title || cutSheetWord}
                      </Link>
                      {order.kind !== "" && (
                        <Badge variant="outline">{slugLabel(order.kind)}</Badge>
                      )}
                      <span className="text-muted-foreground">
                        {lines.length}{" "}
                        {lines.length === 1 ? "line" : "lines"}
                      </span>
                      {order.headCount !== null && (
                        <span className="text-muted-foreground">
                          {order.headCount} head
                        </span>
                      )}
                      <span className="ml-auto tabular-nums">
                        {formatMoney(cents, currencySymbol)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/*
              WHAT THE SHEETS COME TO — a QUOTE, in those words. It is what the
              finish dialog offers as a starting figure; what reaches the ledger
              is what somebody typed after reading the plant's actual bill, and
              keeping the two apart is what makes "they charged more than they
              quoted" answerable.
            */}
            {detail.quotedFee && detail.quotedFee.unpriced.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {detail.quotedFee.unpriced.length}{" "}
                {detail.quotedFee.unpriced.length === 1 ? "line" : "lines"} could
                not be worked out because nobody has counted them —{" "}
                {detail.quotedFee.unpriced.map((l) => l.label).join(", ")} —
                so the real figure is higher than what is shown.
              </p>
            )}
            {run.processingFeeCents !== null && (
              <p className="text-xs text-muted-foreground">
                {formatMoney(run.processingFeeCents, currencySymbol)} was
                recorded as what they charged, and it is in the cost of the meat
                with the feed.
              </p>
            )}
          </div>
        </Panel>
      )}

      <section>
        <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
          What went in
        </h2>
        <DataTable
          isEmpty={inputs.length === 0}
          empty={
            <EmptyState
              icon={<PackageOpen className="h-5 w-5" />}
              title="Nothing has gone in yet"
              description="Adding an input takes it out of stock on the date you give, and carries what that batch had accumulated onto the run."
            />
          }
        >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Live weight</TableHead>
                  <TableHead className="text-right">Cost carried</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inputs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {inventoryEnabled ? (
                        <Link
                          href={`/dashboard/m/inventory/${row.itemId}`}
                          className="hover:underline"
                        >
                          {row.itemName}
                        </Link>
                      ) : (
                        row.itemName
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lotCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.occurredOn}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(row.quantity, row.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatLb(
                        row.weightLb ??
                          (getUnit(row.unit)?.dimension === "mass"
                            ? row.quantity
                            : null),
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.costCents === null
                        ? "—"
                        : formatMoney(row.costCents, currencySymbol)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </DataTable>
      </section>

      {/**
       * THE CARCASS STAGE, BETWEEN THE ANIMAL AND THE BOX — and it sits between
       * them on the page for the same reason it sits between them in the model.
       *
       * Everything here is folded from the sheet's own rows. Nothing on it is
       * stored: not the dressing percentage, not the cutting yield, not the
       * condemnation rate. A stored one would be a factor, and a factor is the
       * unauditable fudge this pack was built to refuse.
       */}
      <Panel className="p-5">
        <div className="flex flex-row items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-base font-semibold tracking-heading">
              {sheetWord}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              What hung, what was condemned, and the two ratios that need a
              carcass to exist between the animal and the box.
            </p>
          </div>
          {/* Reading the page and typing it in sit side by side on purpose:
              the reader is a shortcut through the same form, not a second way
              of recording a carcass. */}
          <ReadKillSheetDialog
            runId={run.id}
            inputs={carcassInputs}
            sheetWord={sheetWord}
          />
          <CarcassDialog
            runId={run.id}
            inputs={carcassInputs}
            sheetWord={sheetWord}
            trigger={
              <Button variant="outline" size="sm">
                Add a line
              </Button>
            }
          />
        </div>
        <div className="mt-4 space-y-4">
          {carcasses.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-5 w-5" />}
              title={`No ${sheetWord.toLowerCase()} yet`}
              description={
                inputs.length === 0
                  ? "Nothing has gone into this run, so there are no carcasses to record. Add what went in first."
                  : "The sheet usually arrives days after the run, sometimes by post — so this can be filled in long after the boxes have landed, and nothing about the cost moves when it is. Until then the overall yield is the only ratio this run can state."
              }
            />
          ) : (
            <>
              {/**
               * **THE RECONCILIATION LINE IS ALWAYS ON, AND IT IS FIRST.** Both
               * ratios refuse while the sheet does not account for what went in,
               * so a person needs to see the gap before they see two dashes and
               * conclude the feature is broken.
               */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">
                  {tally.headOnSheet} head on the sheet
                </span>
                {headIn !== null && headUnaccounted !== null && (
                  <span
                    className={
                      headUnaccounted === 0
                        ? "text-muted-foreground"
                        : "text-amber-700 dark:text-amber-500"
                    }
                  >
                    {headUnaccounted === 0
                      ? `matches the ${headIn} that went in`
                      : headUnaccounted > 0
                        ? `${headUnaccounted} of the ${headIn} that went in are not on it yet`
                        : `${Math.abs(headUnaccounted)} more than the ${headIn} that went in`}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {tally.headPassed} passed
                </span>
                <span
                  className={
                    tally.headCondemned > 0
                      ? "font-medium text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {formatCondemned(tally)}
                </span>
              </div>

              {/**
               * **THE CAUSES LEAD WHEN THERE ARE ANY**, above the ratios and
               * above the list — `inventory`'s counting page made the same call
               * and the reasoning carries: three birds condemned is a number,
               * and the same cause twice is the thing to act on. The unstated
               * ones are counted in rather than dropped, so the causes always
               * add up to the count beside them.
               */}
              {tally.headCondemned > 0 && (
                <div className="rounded-md border border-destructive/40 p-3">
                  <p className="text-sm font-medium">Why they were condemned</p>
                  <ul className="mt-2 space-y-1">
                    {tally.byReason.map((group) => (
                      <li
                        key={group.reason || "__unstated__"}
                        className="flex items-baseline justify-between gap-4 text-sm"
                      >
                        <span
                          className={
                            group.reason === "" ? "text-muted-foreground" : ""
                          }
                        >
                          {reasonLabel(group.reason)}
                        </span>
                        <span className="tabular-nums">{group.head} head</span>
                      </li>
                    ))}
                  </ul>
                  {tally.headCondemnedUnstated > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      A cause nobody wrote down is still a condemnation. It is
                      counted here rather than guessed at.
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <StageRatio
                  title="Dressing percentage"
                  ratio={detail.dressing.dressing?.ratio ?? null}
                  detail={
                    detail.dressing.dressing
                      ? `${formatLb(detail.dressing.dressing.toLb)} hanging out of ${formatLb(
                          detail.dressing.dressing.fromLb,
                        )} live. ${LIVE_SOURCE_NOTES[detail.dressing.dressing.liveSource]}`
                      : ""
                  }
                  refusal={
                    detail.dressing.refusedBecause
                      ? STAGE_REFUSALS[detail.dressing.refusedBecause]
                      : null
                  }
                  /* A low ratio with a hidden reason is how a real condemnation
                     gets read as a bad kill, every time, forever. */
                  caveat={
                    detail.dressing.dressing?.includesCondemned
                      ? `${tally.headCondemned} condemned head are still in the live weight, because only the farm's own scale covered them — so this reads low by about that much. Per-carcass live weights from the plant would take them out properly.`
                      : null
                  }
                />
                <StageRatio
                  title="Cutting yield"
                  ratio={detail.cutting.cutting?.ratio ?? null}
                  detail={
                    detail.cutting.cutting
                      ? `${formatLb(detail.cutting.cutting.toLb)} packaged out of ${formatLb(
                          detail.cutting.cutting.fromLb,
                        )} hanging. What the cutting room did, with the animal's own conformation out of it.`
                      : ""
                  }
                  refusal={
                    detail.cutting.refusedBecause
                      ? STAGE_REFUSALS[detail.cutting.refusedBecause]
                      : null
                  }
                />
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead>Came out of</TableHead>
                    <TableHead className="text-right">Head</TableHead>
                    <TableHead className="text-right">Live (plant)</TableHead>
                    <TableHead className="text-right">Hanging</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carcasses.map((row) => {
                    const condemned = row.disposition === "condemned";
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.tag || (
                            <span className="text-muted-foreground">
                              Batch line
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {carcassById.get(row.runInputId) ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.headCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatLb(row.liveLb)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatLb(row.hangingLb)}
                        </TableCell>
                        <TableCell>
                          {condemned ? (
                            <span className="text-sm text-destructive">
                              Condemned
                              {row.condemnReason ? ` · ${row.condemnReason}` : ""}
                            </span>
                          ) : (
                            <Badge variant="outline">Passed</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {/* Editable and removable on a FINISHED run too. The
                              sheet is a transcription of somebody else's paper,
                              not a ledger entry, and it routinely arrives after
                              the boxes have landed. */}
                          <div className="flex justify-end gap-1">
                            <CarcassDialog
                              runId={run.id}
                              inputs={carcassInputs}
                              sheetWord={sheetWord}
                              existing={{
                                id: row.id,
                                runInputId: row.runInputId,
                                tag: row.tag,
                                headCount: row.headCount,
                                liveLb: row.liveLb,
                                hangingLb: row.hangingLb,
                                condemned,
                                condemnReason: row.condemnReason,
                                notes: row.notes,
                              }}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground"
                                >
                                  Correct
                                </Button>
                              }
                            />
                            <RemoveCarcassButton id={row.id} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      </Panel>

      <section>
        <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
          What came out
        </h2>
        <div className="space-y-3">
          {/*
            WHERE THIS MEAT MAY BE SOLD, said beside the boxes rather than only
            as a badge at the top. The design calls this the existential one:
            "retail should refuse to list a lot into a channel that is not legal
            for it. Selling uninspected product through the wrong channel can end
            a poultry enterprise, and nothing on the market prevents it."

            The same value is stamped onto each output lot as it lands, so the
            eligibility travels with the meat rather than having to be re-derived
            from a plant's paperwork a year later. `retail`'s refusal is the next
            consumer of it and is not built yet.
          */}
          {run.inspection && outputs.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {inspectionNote(
                run.inspection,
                labelFor(pack.labels, "processor", "Processor"),
              )}
            </p>
          )}
          <DataTable
            isEmpty={outputs.length === 0}
            empty={
              <EmptyState
                icon={<Boxes className="h-5 w-5" />}
                title="Nothing has come out yet"
                description="Record boxes as they come off. They land in Inventory together when the run is finished, so the cost split across them adds up to what went in."
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>In stock</TableHead>
                  {isOpen && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {outputs.map((row) => (
                  <TableRow key={row.output.id}>
                    <TableCell className="font-medium">
                      {inventoryEnabled ? (
                        <Link
                          href={`/dashboard/m/inventory/${row.output.itemId}`}
                          className="hover:underline"
                        >
                          {row.itemName}
                        </Link>
                      ) : (
                        row.itemName
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.output.lotCode}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(row.output.quantity, row.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatLb(row.weightLb)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.costCents === null
                        ? "—"
                        : formatMoney(row.costCents, currencySymbol)}
                    </TableCell>
                    <TableCell>
                      {row.output.inventoryMovementId ? (
                        <Badge variant="outline">Landed</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          On the run
                        </span>
                      )}
                    </TableCell>
                    {isOpen && (
                      <TableCell className="text-right">
                        <RemoveOutputButton id={row.output.id} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </div>
      </section>

      {run.notes && (
        <Panel className="p-5">
          <h2 className="mb-3 font-heading text-base font-semibold tracking-heading">
            Notes
          </h2>
          <div className="whitespace-pre-wrap text-sm text-muted-foreground">
            {run.notes}
          </div>
        </Panel>
      )}

      {(run.crewSize !== null || run.labourHours !== null) && (
        <p className="text-sm text-muted-foreground">
          {run.crewSize !== null && `${run.crewSize} on the crew`}
          {run.crewSize !== null && run.labourHours !== null && " · "}
          {run.labourHours !== null && `${run.labourHours} hours`}
          {". Recorded, not costed — turning hours into money needs a decision about what an hour is worth."}
        </p>
      )}
    </div>
  );
}
