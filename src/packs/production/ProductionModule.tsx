import Link from "next/link";
import { Factory } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { listLocations } from "@/packs/inventory/ops";
import { listProcessors } from "@/packs/production/processor-ops";
import { listRuns, runSummaries } from "./ops";
import { exemptionUsage } from "./exemption-ops";
import {
  RUN_STATUS_LABELS,
  runKindsFrom,
  exemptionsFrom,
  exemptionNote,
  slugLabel,
  type RunStatus,
} from "./vocabulary";
import { YIELD_REFUSALS, formatLb, formatRatio } from "./core/yield";
import { StartRunForm } from "./components/run-controls";

const BASE = "/dashboard/m/production";

/**
 * The `production` pack's home: every run, and what came out of it.
 *
 * **THE YIELD COLUMN IS THE PAGE.** Everything else here is bookkeeping that
 * another pack could have done; *690 lb out of 1,150 lb in* is the number no
 * farm app produces and every farm argues about — and the design is explicit
 * that it varies by processor, which is real money essentially nobody measures.
 * So it is on the LIST, where somebody comparing two kill days can see both,
 * rather than buried on a detail page.
 *
 * A run with a missing weight shows the reason instead of a percentage. That is
 * the rule this pack inherited from `livestock`'s feed conversion: never relax a
 * refusal into an approximation, because the reason a screen gives is more
 * useful than a number it had to invent.
 */
export async function ProductionModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const statusParam = searchParams.status;
  const status = typeof statusParam === "string" ? statusParam : undefined;
  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;

  const { runs, summaries, pack, locations, exemptions, processors } =
    await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [runs, pack, locations, processors] = await Promise.all([
        listRuns(tx, ctx.tenant.id, { status }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
        listLocations(tx, ctx.tenant.id),
        // Who could have done it. Only the active ones — an archived plant is
        // still on old runs and must not be offered for a new one.
        listProcessors(tx, ctx.tenant.id),
      ]);
      const summaries = await runSummaries(
        tx,
        ctx.tenant.id,
        runs.map((r) => r.id),
      );
      const exemptions = await exemptionUsage(
        tx,
        ctx.tenant.id,
        exemptionsFrom(pack.config),
        Number(today.slice(0, 4)),
      );
      return { runs, summaries, pack, locations, exemptions, processors };
    },
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";
  const runWord = labelFor(pack.labels, "productionRun", "Run");
  /**
   * **THE COLUMN APPEARS ONLY WHEN SOMETHING HAS A SHEET.** A tenant whose runs
   * are bakes has no carcasses and never will, and a permanently empty column
   * would be this pack asserting an industry in the one place it has no excuse
   * to. The moment one sheet exists the column is worth its width, because a
   * cause repeating across runs is the finding — and a per-run page can never
   * show that.
   */
  const anySheet = [...summaries.values()].some((s) => s.headOnSheet > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production"
        description={`What went in, what came out, and the yield between them. Every ${runWord.toLowerCase()} lands its outputs in Inventory carrying the cost of what it consumed.`}
        actions={
          <div className="flex items-center gap-2">
            {/* Visible to everybody, not just an owner. Reading who takes what
                and how they are inspected is a question anybody on the place
                asks; only changing it is the owner's. */}
            <Button asChild variant="outline">
              <Link href={`${BASE}/bookings`}>Booked dates</Link>
            </Button>
            {/*
              **BESIDE BOOKED DATES, NOT A CARD ON THIS PAGE.** The founder could
              not find a cut sheet: the only ways in were a booking row and a
              card inside an open run. This page's job is the run list and the
              yield column on it, and a sheet is not a run — it exists before one
              and often without one.

              NEVER PLURALISED. `cutSheet` is a word the tenant owns and the
              homestead profile renames it; "Every cut sheet" reads as a list
              without a `+ "s"` that would produce "Cut sheets" on a word
              somebody else has renamed to something that does not take one.
            */}
            <Button asChild variant="outline">
              <Link href={`${BASE}/orders`}>
                Every {labelFor(pack.labels, "cutSheet", "Order").toLowerCase()}
              </Link>
            </Button>
            {/*
              **ONLY WHEN THERE IS SOMETHING TO RECONCILE.** A farm that keeps no
              books never puts anything aside for a plant, and a permanently
              empty reconciliation is a link people learn to ignore. The page
              itself says the same thing if somebody arrives at it directly.
            */}
            <Button asChild variant="outline">
              <Link href={`${BASE}/billing`}>Processing not invoiced</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`${BASE}/processors`}>
                {labelFor(pack.labels, "processor", "Processor")} directory
              </Link>
            </Button>
            {isOwner ? (
              <StartRunForm
                runWord={runWord}
                kindOptions={runKindsFrom(pack.config)}
                locations={locations.map((l) => ({ id: l.id, name: l.name }))}
                processors={processors.map((p) => ({
                  id: p.processor.id,
                  name: p.name,
                }))}
                processorWord={labelFor(pack.labels, "processor", "Processor")}
                today={today}
              />
            ) : null}
          </div>
        }
      />

      {/*
        THE ON-FARM EXEMPTION, COUNTED. Shown from zero rather than only when it
        gets close: a farm needs to see it has a thousand left as much as it
        needs to see it has forty, and a warning that appears for the first time
        at 800 is one nobody has planned against. The design calls this figure
        one the pilot is "already managed to a line".

        A tenant whose profile declares no exemption renders nothing at all — no
        heading, no empty card — because a bakery has no such limit and a panel
        saying "0 of 0" would be this pack asserting an industry.
      */}
      {exemptions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {exemptions.map((rule) => (
            <Card key={rule.kind}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span>Done here this year · {slugLabel(rule.kind)}</span>
                  {rule.standing !== "clear" && (
                    <Badge
                      variant={
                        rule.standing === "close" ? "secondary" : "destructive"
                      }
                    >
                      {rule.standing === "close"
                        ? "Getting close"
                        : rule.standing === "at"
                          ? "At the limit"
                          : "Over"}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-2xl font-semibold tabular-nums">
                  {rule.used}
                  <span className="text-base font-normal text-muted-foreground">
                    {" "}
                    of {rule.annualHead}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {exemptionNote(
                    rule.standing,
                    rule.used,
                    rule.annualHead,
                    labelFor(pack.labels, "processor", "Processor"),
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {runs.length === 0 ? (
        <EmptyState
          panel
          icon={<Factory className="h-5 w-5" />}
          /* NEVER PLURALISE A LABEL. The word is the tenant's to rename, and
             the profile renames this one to "Batch" — which came out of the
             naive `+ "s"` as "No batchs yet" on the first screen anybody
             looked at. Every other pack keeps these words singular for
             exactly this reason. */
          title="Nothing made here yet"
          description={
            isOwner
              ? `Start one on the day it happens. What goes in leaves stock and takes its cost with it; what comes out lands in Inventory when you finish, carrying that cost. The ratio between the two is measured, never assumed.`
              : `An owner starts a ${runWord.toLowerCase()}. Once they do, what went in and what came out show up here.`
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{runWord}</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">In</TableHead>
              <TableHead className="text-right">Out</TableHead>
              <TableHead className="text-right">Yield</TableHead>
              {anySheet && (
                <TableHead className="text-right">Condemned</TableHead>
              )}
              <TableHead className="text-right">Cost in</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const summary = summaries.get(run.id);
              const result = summary?.yieldResult;
              return (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      href={`${BASE}/${run.id}`}
                      className="font-medium hover:underline"
                    >
                      {run.code}
                    </Link>
                    {run.performedBy && (
                      <div className="text-xs text-muted-foreground">
                        {run.performedBy}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {slugLabel(run.runKind)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {run.startedOn}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {result?.yield ? formatLb(result.yield.inLb) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {result?.yield ? formatLb(result.yield.outLb) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* The refusal is a TITLE rather than a second column: it is
                        a sentence, and eight of them down a list would drown the
                        runs that do have a number. The detail page spells it
                        out. */}
                    {result?.yield ? (
                      <span className="font-medium">
                        {formatRatio(result.yield.ratio)}
                      </span>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title={
                          result?.refusedBecause
                            ? YIELD_REFUSALS[result.refusedBecause]
                            : undefined
                        }
                      >
                        —
                      </span>
                    )}
                  </TableCell>
                  {anySheet && (
                    <TableCell className="text-right tabular-nums">
                      {/* A run with no sheet reads "—", not "0". Nobody has
                          said, and zero would say the plant passed everything. */}
                      {!summary || summary.headOnSheet === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : summary.headCondemned === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <span className="font-medium text-destructive">
                          {summary.headCondemned} of {summary.headOnSheet}
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {summary && summary.potCents > 0
                      ? formatMoney(summary.potCents, currencySymbol)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        run.status === "complete" ? "outline" : "default"
                      }
                    >
                      {RUN_STATUS_LABELS[run.status as RunStatus] ?? run.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
