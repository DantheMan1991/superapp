import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor, pluralOf } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatCents, formatMoney, formatMoneySign, isValidIsoDate } from "@/lib/money";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { todayInTimezone } from "@/lib/timezone";
import { listEntities } from "@/modules/accounting/core";
import { addDaysIso, lastCompleteMonthEndIso } from "@/modules/accounting/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listWipPeriods, wipSchedule } from "@/packs/jobs/wip-ops";
import {
  PostWipButton,
  UnpostWipButton,
  WipEstimateCell,
  WipPeriodPicker,
} from "@/packs/jobs/components/wip-controls";
import {
  OVERBILLING_ACCOUNT_CODE,
  PACK,
  REVENUE_ACCOUNT_CODES,
  STATUS_LABELS,
  UNDERBILLING_ACCOUNT_CODE,
  WIP_REASON_LABELS,
  isProjectStatus,
} from "@/packs/jobs/vocabulary";
import { wipPercentLabel } from "@/packs/jobs/wip-math";

/**
 * The work-in-progress schedule: one company, one date, every job with its
 * percent complete, earned revenue, billings, and what the two disagree by.
 *
 * LIVE UNTIL POSTED, FROZEN AFTER. A draft's figures are read from the
 * ledger and the pack's own tables as they stand now; a posted period's are
 * the ones written down when it posted, so the page a bank was shown reads
 * the same next year. The only box a person types into is the estimate.
 */
export default async function WipPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const entities = await listEntities(tx, ctx.tenant.id);
      const fallback = entities.find((e) => e.isDefault)?.id ?? entities[0]?.id ?? null;
      const requested = typeof sp.company === "string" ? sp.company : "";
      const entityId = entities.some((e) => e.id === requested) ? requested : fallback;
      if (!entityId) return null;
      const today = todayInTimezone(await getTenantTimezone(tx, ctx.tenant.id));
      const through =
        typeof sp.through === "string" && isValidIsoDate(sp.through)
          ? sp.through
          : lastCompleteMonthEndIso(today);
      const [schedule, periods, pack] = await Promise.all([
        wipSchedule(tx, ctx.tenant.id, { entityId, periodEnd: through }),
        listWipPeriods(tx, ctx.tenant.id, entityId),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { entities, entityId, through, schedule, periods, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const symbol = ctx.tenant.currencySymbol;
  const isOwner = allowsWrite(ctx.role, "owner");

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Work in progress" />
        <Panel className="p-5">
          <p className="text-sm text-muted-foreground">
            This workspace has no company to keep books for yet.
          </p>
        </Panel>
      </div>
    );
  }

  const { entities, entityId, through, schedule, periods } = data;
  const projectWord = labelFor(data.labels, "project", "Project");
  const projectPlural = pluralOf(projectWord, "Project", "Projects");
  const entity = entities.find((e) => e.id === entityId)!;
  const posted = schedule.period?.status === "posted";
  const postingRows = schedule.rows.filter((r) => r.reason === "");
  const skipped = schedule.rows.filter((r) => r.reason !== "");
  const t = schedule.totals;
  const adjusting = postingRows.filter((r) => r.figures.overUnderCents !== 0).length;
  const canPost =
    isOwner &&
    !posted &&
    schedule.blockers.length === 0 &&
    schedule.missingAccounts.length === 0 &&
    adjusting > 0;

  const confirmText = [
    `Post work in progress through ${through} for ${entity.name}?`,
    t.underBilledCents > 0
      ? `Under-billed ${formatMoney(t.underBilledCents, symbol)}: Dr ${UNDERBILLING_ACCOUNT_CODE} Costs in Excess of Billings / Cr revenue.`
      : null,
    t.overBilledCents > 0
      ? `Over-billed ${formatMoney(t.overBilledCents, symbol)}: Dr revenue / Cr ${OVERBILLING_ACCOUNT_CODE} Billings in Excess of Costs.`
      : null,
    `${adjusting} ${adjusting === 1 ? "job" : "jobs"}, dated ${through} and reversed on ${addDaysIso(through, 1)}.`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {projectPlural}
      </Link>
      <PageHeader
        title="Work in progress"
        description="Earned revenue against billings, per job, as of a period end — the schedule a bank or a surety asks for, and the entry that trues revenue up to the work."
      />

      <Panel className="p-5">
        <div className="space-y-3">
          <WipPeriodPicker entities={entities} entityId={entityId} periodEnd={through} />
          <p className="text-sm text-muted-foreground">
            {posted && schedule.period ? (
              <>
                <Badge className="mr-2">Posted</Badge>
                Posted on {schedule.period.postedOn} · figures frozen ·{" "}
                <Link
                  href={`/dashboard/m/accounting/journal/${schedule.period.entryId}`}
                  className="underline"
                >
                  the adjustment
                </Link>
                {schedule.period.reversalEntryId && (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      href={`/dashboard/m/accounting/journal/${schedule.period.reversalEntryId}`}
                      className="underline"
                    >
                      its reversal on {addDaysIso(through, 1)}
                    </Link>
                  </>
                )}
                {isOwner && (
                  <span className="ml-3 inline-block align-middle">
                    <UnpostWipButton
                      periodId={schedule.period.id}
                      version={schedule.period.version}
                    />
                  </span>
                )}
              </>
            ) : (
              <>
                <Badge variant="secondary" className="mr-2">
                  Draft
                </Badge>
                Live figures as of {through}. Nothing has posted for this date
                {schedule.period ? "; the estimates typed so far are kept" : ""}.
              </>
            )}
          </p>
        </div>
      </Panel>

      <Panel className="p-5">
        <div>
          <h2 className="font-heading text-sm font-medium tracking-heading">
            {entity.name} · through {through}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Percent complete is cost to date over the estimated total cost. Earned
            is the contract value at that percent. A job billed behind its work is
            under-billed; one billed ahead is over-billed.
          </p>
          {schedule.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {projectWord.toLowerCase()} of {entity.name} has a contract value,
              a cost or a billing as of {through}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{projectWord}</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                    <TableHead className="text-right">Cost to date</TableHead>
                    <TableHead className="text-right">% done</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Under-billed</TableHead>
                    <TableHead className="text-right">Over-billed</TableHead>
                    <TableHead className="text-right">Profit to date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.rows.map((row) => {
                    const f = row.figures;
                    return (
                      <TableRow key={row.projectId}>
                        <TableCell>
                          <Link
                            href={`/dashboard/m/jobs/${row.projectId}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {row.number}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {row.name}
                            {isProjectStatus(row.status) && row.status !== "active"
                              ? ` · ${STATUS_LABELS[row.status]}`
                              : ""}
                          </span>
                          {row.reason !== "" && (
                            <Badge variant="secondary" className="mt-1">
                              {WIP_REASON_LABELS[row.reason]}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.contractCents > 0 ? formatMoney(f.contractCents, symbol) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {isOwner && !posted ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <WipEstimateCell
                                entityId={entityId}
                                periodEnd={through}
                                projectId={row.projectId}
                                estimate={row.estimateCents === null ? "" : formatCents(row.estimateCents)}
                                budgetLabel={row.budgetCents > 0 ? formatCents(row.budgetCents) : "estimate"}
                              />
                              {row.estimateCents !== null && row.budgetCents > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  budget {formatMoney(row.budgetCents, symbol)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <>
                              {f.estimatedCostCents > 0
                                ? formatMoney(f.estimatedCostCents, symbol)
                                : "—"}
                              {row.estimateCents !== null && (
                                <span className="block text-xs text-muted-foreground">
                                  re-estimated
                                </span>
                              )}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(f.costToDateCents, symbol)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {wipPercentLabel(f.percentCompletePpm)}
                          {f.percentCompletePpm !== null ? "%" : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.reason === "" ? formatMoney(f.earnedCents, symbol) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(f.billedCents, symbol)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.reason === "" && f.underBilledCents > 0
                            ? formatMoney(f.underBilledCents, symbol)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.reason === "" && f.overBilledCents > 0
                            ? formatMoney(f.overBilledCents, symbol)
                            : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            row.reason === "" && f.grossProfitToDateCents < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {row.reason === "" ? formatMoneySign(f.grossProfitToDateCents, symbol) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="font-medium">
                    <TableCell>
                      Total
                      <span className="block text-xs font-normal text-muted-foreground">
                        {postingRows.length} {postingRows.length === 1 ? "job" : "jobs"} measured
                        {skipped.length > 0 ? `, ${skipped.length} left out` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.contractCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.estimatedCostCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.costToDateCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.estimatedCostCents > 0
                        ? `${wipPercentLabel(
                            Math.min(
                              1_000_000,
                              Math.round((t.costToDateCents / t.estimatedCostCents) * 1_000_000),
                            ),
                          )}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.earnedCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.billedCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.underBilledCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.overBilledCents, symbol)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        t.grossProfitToDateCents < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatMoneySign(t.grossProfitToDateCents, symbol)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </Panel>

      {!posted && schedule.rows.length > 0 && (
        <Panel className="p-5">
          <div className="space-y-3">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              The entry
            </h2>
            {adjusting === 0 ? (
              <p className="text-sm text-muted-foreground">
                Billings equal earned revenue on every measured job, so there is
                nothing to post for {through}.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {t.underBilledCents > 0 && (
                  <li>
                    <span className="font-medium tabular-nums">
                      {formatMoney(t.underBilledCents, symbol)}
                    </span>{" "}
                    under-billed: Dr {UNDERBILLING_ACCOUNT_CODE} Costs in Excess of
                    Billings / Cr revenue ({REVENUE_ACCOUNT_CODES.join(" or ")}).
                  </li>
                )}
                {t.overBilledCents > 0 && (
                  <li>
                    <span className="font-medium tabular-nums">
                      {formatMoney(t.overBilledCents, symbol)}
                    </span>{" "}
                    over-billed: Dr revenue / Cr {OVERBILLING_ACCOUNT_CODE} Billings in
                    Excess of Costs.
                  </li>
                )}
                <li className="text-muted-foreground">
                  One pair of lines per job, tagged with the job, dated {through} and
                  reversed on {addDaysIso(through, 1)} — so the books between period
                  ends carry billings, and this period&apos;s statements carry what
                  was earned.
                </li>
              </ul>
            )}
            {schedule.blockers.length > 0 && (
              <ul className="space-y-1 text-sm text-destructive">
                {schedule.blockers.map((b) => (
                  <li key={b}>{b}.</li>
                ))}
              </ul>
            )}
            {schedule.missingAccounts.length > 0 && (
              <p className="text-sm text-destructive">
                The chart of accounts has no {schedule.missingAccounts.join(", ")}{" "}
                account. Add it in Accounting first — the construction profile seeds
                these; a pack never adds an account to a business&apos;s chart on its
                own.
              </p>
            )}
            {isOwner ? (
              <PostWipButton
                entityId={entityId}
                periodEnd={through}
                version={schedule.period?.version}
                confirmText={confirmText}
                disabled={!canPost}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Posting the adjustment is an owner&apos;s decision.
              </p>
            )}
          </div>
        </Panel>
      )}

      <Panel className="p-5">
        <div>
          <h2 className="mb-2 font-heading text-sm font-medium tracking-heading">
            Periods
          </h2>
          {periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No period has been saved or posted for {entity.name} yet.
            </p>
          ) : (
            <ul className="divide-y divide-divider text-sm">
              {periods.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link
                    href={`/dashboard/m/jobs/wip?company=${entityId}&through=${p.periodEnd}`}
                    className="font-medium hover:underline"
                  >
                    {p.periodEnd}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {p.status === "posted" ? (
                      <>
                        <Badge className="mr-2">Posted</Badge>on {p.postedOn}
                      </>
                    ) : (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
