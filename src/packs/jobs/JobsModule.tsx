import Link from "next/link";
import { HardHat } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor, pluralOf } from "@/lib/packs/resolve";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { FilterPills } from "@/components/app/filter-pills";
import { DataTable } from "@/components/app/data-table";
import { LinkRow } from "@/components/app/link-row";
import { ListSearch } from "@/components/app/list-search";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listCostCodeSets } from "./ops";
import { boardExtras, projectListEntries, type ProjectListEntry } from "./list-ops";
import { ProjectBoard } from "./components/project-board";
import { StatusBadge, projectStatusTone } from "./components/status-badge";
import { todayInTimezone } from "@/lib/timezone";
import {
  LIST_FILTERS,
  LIST_FILTER_LABELS,
  type ListFilterKey,
  barPercent,
  filterCounts,
  isListFilterKey,
  isListView,
  type ListView,
  matchesFilter,
  summariseList,
} from "./list-math";
import { wipPercentLabel } from "./wip-math";
import {
  BILLING_METHOD_LABELS,
  PACK,
  STATUS_LABELS,
  deliveryMethodsFrom,
  isBillingMethod,
  isProjectStatus,
  slugLabel,
} from "./vocabulary";
import { ProjectForm } from "./components/project-form";

/**
 * The `jobs` pack's home: every project, and what each one is worth, has cost
 * and has been billed.
 *
 * **NOTHING HERE IS CONSTRUCTION-SHAPED, and that is the test.** A project has a
 * number, a client, a company, a division and a kind of work; a fit-out, a
 * software engagement and a house are the same row. The kinds of work come from
 * the installed profile's `packConfig`, never from this pack — see
 * `vocabulary.ts`, which deliberately ships no list.
 *
 * ── WHY THE LIST CARRIES MONEY NOW ──────────────────────────────────────────
 *
 * It used to be seven columns whose only figure was contract value, which meant
 * the question every owner actually opens this screen with — which job is in
 * trouble — could only be answered by opening each job in turn. The figures
 * were already computed; they were just on the WIP schedule, which is a
 * month-end document rather than a daily one. `list-ops.ts` reads them for the
 * whole list in a fixed number of statements and `list-math.ts` does the
 * arithmetic, which is the same `wipFigures` the schedule posts from.
 *
 * ── THE LIST NEVER PRINTS A ZERO IT CANNOT DEFEND ───────────────────────────
 *
 * Nothing signed, no estimate to measure against, and billed-by-the-hour are
 * three different kinds of not-knowing, and each says which it is. See
 * `ProjectValuation`.
 */
export async function JobsModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams.f;
  const filter: ListFilterKey = isListFilterKey(raw) ? raw : "all";
  const rawTerm = searchParams.q;
  const term = (typeof rawTerm === "string" ? rawTerm : "").trim();
  const view: ListView = isListView(searchParams.v) ? searchParams.v : "table";

  const { entries, extras, entities, parties, enterprises, sets, labels, config } =
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const [entries, entities, parties, enterprises, sets, pack] =
          await Promise.all([
            projectListEntries(tx, ctx.tenant.id),
            tx
              .select({ id: schema.entities.id, name: schema.entities.name })
              .from(schema.entities)
              .where(
                and(
                  eq(schema.entities.tenantId, ctx.tenant.id),
                  eq(schema.entities.isActive, true),
                ),
              ),
            tx
              .select({
                id: schema.parties.id,
                name: schema.parties.displayName,
              })
              .from(schema.parties)
              .where(eq(schema.parties.tenantId, ctx.tenant.id))
              .limit(500),
            tx
              .select({ id: schema.enterprises.id, name: schema.enterprises.name })
              .from(schema.enterprises)
              .where(eq(schema.enterprises.tenantId, ctx.tenant.id)),
            listCostCodeSets(tx, ctx.tenant.id),
            packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
          ]);
        /*
         * ONLY THE BOARD PAYS FOR THIS. The table shows none of it, and three
         * more statements on every visit to a list that does not use them is a
         * cost for nothing.
         */
        const extras =
          view === "board"
            ? await boardExtras(
                tx,
                ctx.tenant.id,
                entries.map((e) => e.row.project.id),
                ctx.tenant.timezone,
                todayInTimezone(ctx.tenant.timezone),
              )
            : new Map();
        return {
          entries,
          extras,
          entities,
          parties,
          enterprises,
          sets,
          labels: pack.labels,
          config: pack.config,
        };
      },
      { role: ctx.role },
    );

  const projectWord = labelFor(labels, "project", "Project");
  // The shared plural rule, never a second key: a declared plural for the word
  // nobody renamed, an "s" for the tenant's own. See `pluralOf`.
  const projectPlural = pluralOf(projectWord, "Project", "Projects");
  const clientWord = labelFor(labels, "customer", "Customer");
  const isOwner = ctx.role === "owner";
  /**
   * The kinds of work this business does, offered as suggestions. From the
   * PROFILE, never from here — a list in this file would make the pack know its
   * industry (ADR 0004). An empty list means a free-text box, which is the
   * correct answer for a tenant with no profile installed.
   */
  const deliveryMethods = deliveryMethodsFrom(config);
  const symbol = ctx.tenant.currencySymbol;

  // The headline reads the whole book; the pills and the table read the view.
  const summary = summariseList(
    entries.map((e) => ({
      status: e.row.project.status,
      signedCount: e.signedCount,
      contractCents: e.contractCents,
      valuation: e.valuation,
    })),
  );
  const counts = filterCounts(entries.map((e) => ({ status: e.row.project.status })));
  /**
   * The tenant's own word, singular or plural. The pack renames `Project` for
   * every business that installs it, so a sentence that said "3 jobs" would be
   * this pack telling a law firm what to call its matters.
   */
  const word = (n: number) =>
    n === 1 ? projectWord.toLowerCase() : projectPlural.toLowerCase();
  /**
   * THE ONE JOB BILLED AHEAD, BY NAME. "One is billed ahead" makes the reader
   * hunt the table for which; naming it and the amount turns the sentence into
   * the thing they came for. Only when there is exactly one — with several, the
   * count is the useful shape and the rows carry the detail.
   */
  const overBilledOne =
    summary.overBilledJobs === 1
      ? entries.find(
          (e) =>
            e.valuation.kind === "measured" && e.valuation.figures.overBilledCents > 0,
        )
      : undefined;
  const needle = term.toLowerCase();
  const visible = entries.filter((e) => {
    if (!matchesFilter(e.row.project.status, filter)) return false;
    if (!needle) return true;
    return [e.row.project.number, e.row.project.name, e.row.project.address, e.row.clientName]
      .some((v) => (v ?? "").toLowerCase().includes(needle));
  });

  /** Every link keeps the other two choices, so nothing resets what you set. */
  function href(next: { filter?: ListFilterKey; view?: ListView }): string {
    const p = new URLSearchParams();
    const f = next.filter ?? filter;
    const v = next.view ?? view;
    if (f !== "all") p.set("f", f);
    if (v !== "table") p.set("v", v);
    if (term) p.set("q", term);
    const query = p.toString();
    return query ? `/dashboard/m/jobs?${query}` : "/dashboard/m/jobs";
  }

  const form = isOwner ? (
    <ProjectForm
      entities={entities}
      parties={parties}
      enterprises={enterprises}
      costCodeSets={sets.map((s) => ({
        id: s.id,
        name: s.name,
        isDefault: s.isDefault,
      }))}
      deliveryMethods={deliveryMethods}
      projectWord={projectWord}
      clientWord={clientWord}
    />
  ) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<HardHat />}
        title={projectPlural}
        description={
          entries.length === 0 ? (
            `What ${ctx.tenant.name} is building, and what each job costs.`
          ) : (
            <>
              {summary.activeJobs === 0
                ? `Nothing underway at ${ctx.tenant.name} right now.`
                : `${summary.activeJobs} ${word(summary.activeJobs)} underway at ${ctx.tenant.name}.`}
              {summary.overBilledJobs > 0 && (
                <>
                  {" "}
                  <span className="text-destructive">
                    {overBilledOne && overBilledOne.valuation.kind === "measured"
                      ? `${formatMoney(
                          overBilledOne.valuation.figures.overBilledCents,
                          symbol,
                        )} billed ahead of the work on ${overBilledOne.row.project.name}.`
                      : `${summary.overBilledJobs} are billed ahead of what they have earned.`}
                  </span>
                </>
              )}
            </>
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/m/jobs/wip">Work in progress</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/m/jobs/subcontractors">Subcontractors</Link>
            </Button>
            {isOwner && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/m/jobs/cost-codes">Cost codes</Link>
              </Button>
            )}
            {form}
          </div>
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={<HardHat />}
          title={`No ${projectPlural.toLowerCase()} yet`}
          description={
            isOwner
              ? `Add the first one and every bill and hour can be charged to it. ${projectPlural} appear as a cost object, so the reports you already have will group by them.`
              : `Nobody has added a ${projectWord.toLowerCase()} yet. An owner sets the first one up.`
          }
          action={form}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Under contract"
              value={formatMoneySign(summary.underContractCents, symbol)}
              footnote={
                summary.countedJobs === 1
                  ? `1 ${word(1)} with something signed`
                  : `${summary.countedJobs} ${word(summary.countedJobs)} with something signed`
              }
            />
            <StatCard
              label="Earned to date"
              value={formatMoneySign(summary.earnedCents, symbol)}
              footnote="cost-to-cost, to date"
            />
            <StatCard
              label="Under-billed"
              value={formatMoney(summary.underBilledCents, symbol)}
              tone="success"
              footnote="earned but not yet invoiced"
            />
            <StatCard
              label="Over-billed"
              value={formatMoney(summary.overBilledCents, symbol)}
              tone={summary.overBilledCents > 0 ? "destructive" : "default"}
              footnote={
                summary.overBilledJobs === 0
                  ? "never netted against under-billed"
                  : `${summary.overBilledJobs} ${word(summary.overBilledJobs)} · never netted`
              }
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterPills
              variant="solid"
              activeKey={filter}
              items={LIST_FILTERS.filter(
                // A pill for a status nobody uses is noise; All always shows.
                (key) => key === "all" || counts[key] > 0,
              ).map((key) => ({
                key,
                label: LIST_FILTER_LABELS[key],
                href: href({ filter: key }),
                count: counts[key],
              }))}
            />
            <div className="flex flex-wrap items-center gap-3">
              <ListSearch placeholder={`Search ${projectWord.toLowerCase()}, ${clientWord.toLowerCase()} or address`} />
              {/*
                A SEGMENTED PILL, and a pair of links rather than a control: the
                view is a search param like the filter beside it, so it survives
                a refresh and can be sent to somebody. Nothing here needs
                JavaScript.
              */}
              <div
                className="inline-flex shrink-0 rounded-full bg-muted p-0.5"
                role="group"
                aria-label="View"
              >
                {(
                  [
                    ["table", "Table"],
                    ["board", "Board"],
                  ] as const
                ).map(([key, label]) => (
                  <Link
                    key={key}
                    href={href({ view: key })}
                    aria-current={view === key ? "page" : undefined}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      view === key
                        ? "bg-card text-foreground shadow-elevation-1"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {view === "board" ? (
            <ProjectBoard
              entries={visible}
              extras={extras}
              symbol={symbol}
              clientWord={clientWord}
            />
          ) : (
          <DataTable
            isEmpty={visible.length === 0}
            empty={
              <EmptyState
                icon={<HardHat />}
                title={
                  term
                    ? `Nothing matches “${term}”`
                    : `No ${LIST_FILTER_LABELS[filter].toLowerCase()} ${projectPlural.toLowerCase()}`
                }
                description={
                  term
                    ? "Try a number, a name, an address or a client."
                    : "Every other one is under a different filter."
                }
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href={href({ filter: "all" })}>Show all</Link>
                  </Button>
                }
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{projectWord}</TableHead>
                  <TableHead>{clientWord} &amp; kind</TableHead>
                  <TableHead>Complete · cost to date</TableHead>
                  <TableHead className="text-right">Contract</TableHead>
                  <TableHead className="text-right">Billed vs earned</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((entry) => (
                  <ProjectRowCells
                    key={entry.row.project.id}
                    entry={entry}
                    symbol={symbol}
                  />
                ))}
              </TableBody>
            </Table>
          </DataTable>
          )}
        </>
      )}
    </div>
  );
}

function ProjectRowCells({
  entry,
  symbol,
}: {
  entry: ProjectListEntry;
  symbol: string | null;
}) {
  const { project, clientName, entityName, enterpriseName } = entry.row;
  const valuation = entry.valuation;
  const measured = valuation.kind === "measured" ? valuation.figures : null;
  const complete = project.status === "complete";
  const overBilled = (measured?.overBilledCents ?? 0) > 0;
  const ppm = measured?.percentCompletePpm ?? null;

  return (
    <LinkRow
      href={`/dashboard/m/jobs/${project.id}`}
      className={cn(
        // Attention, not disablement: the hover wash is already `bg-muted/60`,
        // so a muted row would lose its own hover feedback and read as switched
        // off rather than as "this one is billed ahead".
        overBilled && "bg-destructive/5",
        complete && "text-muted-foreground",
      )}
    >
      <TableCell className="max-w-[200px] whitespace-normal">
        <Link
          href={`/dashboard/m/jobs/${project.id}`}
          className="font-mono text-xs text-module-accent underline-offset-2 hover:underline"
        >
          {project.number}
        </Link>
        <span className="mt-0.5 block font-medium text-foreground">{project.name}</span>
        {project.address && (
          <span className="block text-xs text-muted-foreground">{project.address}</span>
        )}
      </TableCell>

      <TableCell className="max-w-[180px] whitespace-normal">
        {clientName ?? "—"}
        <span className="block text-xs text-muted-foreground">
          {/* The business's own word for the kind of work, never ours. */}
          {project.deliveryMethod ? slugLabel(project.deliveryMethod) : "—"}
          {entry.billingMethods.length > 0 && (
            <>
              {" · "}
              {entry.billingMethods.length > 1
                ? "Several"
                : isBillingMethod(entry.billingMethods[0])
                  ? BILLING_METHOD_LABELS[entry.billingMethods[0]]
                  : slugLabel(entry.billingMethods[0])}
            </>
          )}
        </span>
        <span className="block text-xs text-subtle-foreground">
          {entityName}
          {enterpriseName && ` · ${enterpriseName}`}
        </span>
      </TableCell>

      <TableCell>
        {/*
         * Percent complete, or which kind of not-knowing this is. Never 0%:
         * `percentCompletePpm` returns null when there is nothing to measure
         * against, and a zero would read as "no progress" when the truth is
         * "no estimate".
         */}
        <span className="block text-sm tabular-nums">
          {valuation.kind === "by_hours" ? (
            <span className="text-muted-foreground">By hours</span>
          ) : ppm !== null ? (
            `${wipPercentLabel(ppm)}%`
          ) : entry.costToDateCents === 0 ? (
            <span className="text-muted-foreground">Not started</span>
          ) : (
            <span className="text-warning-foreground">No estimate</span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatMoney(entry.costToDateCents, symbol)}
          {entry.budgetCents > 0 && ` of ${formatMoney(entry.budgetCents, symbol)}`}
        </span>
        {ppm !== null && (
          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-module-accent"
              style={{ width: `${barPercent(ppm)}%` }}
            />
          </span>
        )}
      </TableCell>

      <TableCell className="text-right tabular-nums">
        {/*
         * REVISED, with the approved changes said underneath when there are
         * any — so a job that grew is seen to have grown, not silently
         * re-signed at a bigger number. Signed renderers, because a deduction
         * is a negative and `formatMoney` would print it as its own opposite.
         */}
        {entry.signedCount > 0 ? (
          <>
            {formatMoneySign(entry.contractCents, symbol)}
            {entry.changesCents !== 0 && (
              <span className="block text-xs text-muted-foreground">
                incl. {formatMoneySign(entry.changesCents, symbol)} in changes
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Nothing signed</span>
            {entry.proposedCents > 0 && (
              <span className="block text-xs text-warning-foreground">
                {formatMoneySign(entry.proposedCents, symbol)} proposed
              </span>
            )}
          </>
        )}
      </TableCell>

      <TableCell className="max-w-[150px] text-right whitespace-normal tabular-nums">
        {formatMoney(entry.billedCents, symbol)}
        {measured ? (
          complete ? (
            /* A finished job's variance is spent: what matters is what it made. */
            <span className="block text-xs text-muted-foreground">
              {formatMoneySign(measured.grossProfitToDateCents, symbol)} gross profit
            </span>
          ) : measured.underBilledCents > 0 ? (
            <span className="block text-xs text-success-foreground">
              {formatMoney(measured.underBilledCents, symbol)} under-billed
            </span>
          ) : measured.overBilledCents > 0 ? (
            <span className="block text-xs text-destructive">
              {formatMoney(measured.overBilledCents, symbol)} over-billed
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">level with earned</span>
          )
        ) : valuation.kind === "by_hours" ? (
          <span className="block text-xs text-muted-foreground">earned on the WIP schedule</span>
        ) : valuation.kind === "no_estimate" ? (
          /* Not "level", not "over": unmeasurable, and the row says which. */
          <span className="block text-xs text-warning-foreground">needs an estimate</span>
        ) : null}
      </TableCell>

      <TableCell>
        <StatusBadge tone={projectStatusTone(project.status)}>
          {isProjectStatus(project.status)
            ? STATUS_LABELS[project.status]
            : project.status}
        </StatusBadge>
        {overBilled && !complete && (
          <span className="mt-1 block text-xs text-destructive">Billed ahead</span>
        )}
      </TableCell>
    </LinkRow>
  );
}
