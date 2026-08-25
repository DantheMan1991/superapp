import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  matchableProcessorBillLines,
  openProcessingAccruals,
  runsWithUnmovedCost,
} from "@/packs/production/billing-ops";
import {
  CorrectRunCostButton,
  MatchBillLineDialog,
  UnmatchBillLineButton,
} from "@/packs/production/components/billing-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * **WHAT THE PLANTS HAVE NOT INVOICED, AND WHAT THEY HAVE.** Slice 2d.
 *
 * Completing a run puts the fee into the meat's cost and credits `2060 Services
 * Received Not Invoiced`, because nobody had billed for it yet. Until this page
 * nothing ever took it off again — the dossier called the growing balance a
 * feature in the meantime, and it was: a non-zero `2060` per plant IS the list
 * of processing nobody has invoiced you for. This is where that list stops being
 * a side effect of the ledger and becomes a screen.
 *
 * **BOTH HALVES ON ONE PAGE, deliberately, and for the reason the GRNI screen
 * gives:** "processing with no invoice" and "a plant's bill with no processing"
 * are the same question asked from opposite ends, and a reconciliation split
 * across two screens is one nobody finishes.
 *
 * **NOT ON THE INVENTORY MATCHING PAGE**, which is the other reconciliation.
 * 2c deliberately kept this out of `2050` so the stock one stays explainable by
 * its own workings; putting the two on one screen would re-mix what that
 * decision separated.
 *
 * **THE THIRD SECTION IS AN OFFER, NOT AN OBLIGATION.** Once a bill is matched
 * the books are right — the difference went to the P&L. Whether the MEAT should
 * carry it too is a separate question, and a farm that never answers it is not
 * wrong.
 */
export default async function ProcessingBillsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");
  const currencySymbol = ctx.tenant.currencySymbol;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(
        tx,
        ctx.tenant.id,
        ctx.tenant.industry,
        "production",
      );
      /**
       * **EVERY READ HERE CAN FAIL FOR ONE HONEST REASON: no chart of accounts.**
       * `resolveServicesAccruedAccount` refuses when `2060` is missing, which is
       * every tenant that has not provisioned the books. That is not an error
       * worth a stack trace — there is simply nothing to reconcile — so it reads
       * as an empty page rather than a broken one.
       */
      try {
        const [open, lines, unmoved] = await Promise.all([
          openProcessingAccruals(tx, ctx.tenant.id),
          matchableProcessorBillLines(tx, ctx.tenant.id),
          runsWithUnmovedCost(tx, ctx.tenant.id),
        ]);
        return { pack, open, lines, unmoved, books: true };
      } catch {
        return { pack, open: [], lines: [], unmoved: [], books: false };
      }
    },
    { role: ctx.role },
  );

  const { pack, open, lines, unmoved, books } = data;
  const runWord = labelFor(pack.labels, "productionRun", "Run");
  const processorWord = labelFor(pack.labels, "processor", "Processor");
  const isOwner = ctx.role === "owner";

  const openTotal = open.reduce((sum, o) => sum + o.openCents, 0);
  const options = open.map((o) => ({
    runId: o.runId,
    runCode: o.runCode,
    startedOn: o.startedOn,
    processorName: o.processorName,
    openCents: o.openCents,
    entityId: o.entityId,
  }));

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

      <PageHeader
        title="Processing not invoiced"
        description={`What was put aside for a ${processorWord.toLowerCase()} when a ${runWord.toLowerCase()} finished, and which of their bills has settled it. The two sides are the same question from opposite ends, so they are on one page.`}
      />

      {!books ? (
        <EmptyState
          title="No books to reconcile against"
          description={`This business does not keep a set of accounts yet, so nothing was ever put aside for a ${processorWord.toLowerCase()} and there is nothing here to settle.`}
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">
                Nobody has invoiced this yet
              </h2>
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(openTotal, currencySymbol)}
              </span>
            </div>
            {/*
              **MATCHING POINTS THE LINE; APPROVING POSTS IT**, and saying only
              the first would be this screen making the same mistake the GRNI
              card made — reporting the WORKING and calling it the answer. The
              figure above is what has no bill against it, which is not the same
              as what the account is holding the moment a matched bill is still a
              draft. Found by reading the balance after matching two of them.
            */}
            <p className="text-sm text-muted-foreground">
              Money already in the cost of the meat, owed to a{" "}
              {processorWord.toLowerCase()} who has not sent a bill. Matching
              their bill to the day it paid for points it at this; the account
              itself clears when that bill is approved.
            </p>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding — every {runWord.toLowerCase()} that put
                something aside has a bill against it.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{processorWord}</TableHead>
                    <TableHead>{runWord}</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Put aside</TableHead>
                    <TableHead className="text-right">Still open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.map((o) => (
                    <TableRow key={o.runId}>
                      <TableCell>
                        {o.processorName ?? (
                          <span className="text-muted-foreground">
                            Done here
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`${BASE}/${o.runId}`}
                          className="font-medium hover:underline"
                        >
                          {o.runCode}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {o.startedOn}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(o.accruedCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(o.openCents, currencySymbol)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">
              Their bills, and what they are for
            </h2>
            <p className="text-sm text-muted-foreground">
              Lines on unapproved bills from a {processorWord.toLowerCase()}.
              Matching one points it at what was put aside, so approving the bill
              settles it rather than charging the meat twice.
            </p>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unapproved bills from a {processorWord.toLowerCase()}. A bill
                has to name a vendor, so a {processorWord.toLowerCase()} that has
                never sent one does not appear here.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{processorWord}</TableHead>
                    <TableHead>Bill</TableHead>
                    <TableHead>What for</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Against</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.billLineId}>
                      <TableCell className="font-medium">
                        {l.vendorName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.billNumber || "—"}
                        <span className="block text-xs tabular-nums">
                          {l.billDate}
                        </span>
                      </TableCell>
                      <TableCell>{l.description || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.amountCents, currencySymbol)}
                        {/*
                          **THE REST OF THE INVOICE, SAID OUT LOUD.** Matching
                          rewrites this line down to what was accrued and puts
                          the difference on its own line, so without this a
                          $235.00 bill reads as $223.70 and looks like it shrank.
                        */}
                        {l.varianceCents !== 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {formatMoney(l.varianceCents, currencySymbol)} more
                            on its own line
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.matchedRunCodes.length === 0 ? (
                          "Nothing yet"
                        ) : (
                          <span>{l.matchedRunCodes.join(", ")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isOwner && (
                          <div className="flex items-center justify-end gap-1">
                            {l.matchedRunCodes.length === 0 ? (
                              <MatchBillLineDialog
                                billLineId={l.billLineId}
                                description={l.description}
                                amountCents={l.amountCents}
                                vendorName={l.vendorName}
                                entityId={l.entityId}
                                options={options}
                                currencySymbol={currencySymbol}
                                processorWord={processorWord}
                                runWord={runWord}
                              />
                            ) : (
                              <UnmatchBillLineButton
                                billLineId={l.billLineId}
                              />
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/*
            **THE OFFER.** Only shown when there is one to make — a page that
            always carries a section saying "nothing to do here" is a page people
            stop reading.
          */}
          {unmoved.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">
                They charged something other than what was put aside
              </h2>
              <p className="text-sm text-muted-foreground">
                The books already agree — the difference went to the profit and
                loss when the bill was matched. This is the other question:
                whether the meat itself should carry it. Nothing forces it.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{runWord}</TableHead>
                    <TableHead>{processorWord}</TableHead>
                    <TableHead className="text-right">Put aside</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmoved.map((u) => (
                    <TableRow key={u.runId}>
                      <TableCell>
                        <Link
                          href={`${BASE}/${u.runId}`}
                          className="font-medium hover:underline"
                        >
                          {u.runCode}
                        </Link>
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {u.startedOn}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.processorName ?? "Done here"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(u.accruedCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(u.billedCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(u.movedCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isOwner && (
                          <CorrectRunCostButton
                            runId={u.runId}
                            runCode={u.runCode}
                            movedCents={u.movedCents}
                            currencySymbol={currencySymbol}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
