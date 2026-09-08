import Link from "next/link";
import { CalendarHeart } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/app/data-table";
import { LinkRow } from "@/components/app/link-row";
import { StatCard } from "@/components/app/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { slugLabel } from "@/packs/inventory/vocabulary";
import { codesByLivestockLot, whoIsDue, type DueLine } from "@/packs/livestock/ops";
import {
  DUE_SOON_DAYS,
  describeCycle,
  dueStanding,
  isRunning,
  type Cycle,
  type DueStanding,
} from "@/packs/livestock/core/breeding";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/livestock";

/** How many finished cycles the history shows before it stops. */
const HISTORY_CAP = 50;

/**
 * Who is due — livestock slice 4c.
 *
 * **A BULL MEANS WINDOWS, NOT DATES.** Every female with a breeding on
 * record, with the window she could give birth in, narrowed by whatever the
 * vet found and fixed by the birth when it comes. One list, ordered by when
 * the window opens, because the question in the barn is "who is next".
 *
 * Nothing on this page is stored: the lines are `whoIsDue`, the same fold
 * the lot page and What needs you read, so the three cannot disagree.
 */
export default async function BreedingPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, "livestock");
      const lines = await whoIsDue(tx, ctx.tenant.id, today, pack.config);
      // The sires, named. The fold carries ids because it is pure.
      const sireIds = [
        ...new Set(
          lines
            .map((l) => l.cycle.exposure?.sireLotId ?? null)
            .filter((id): id is string => id !== null),
        ),
      ];
      const sireCodes = await codesByLivestockLot(tx, ctx.tenant.id, sireIds);
      return { lines, sireCodes, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const lotWord = labelFor(data.labels, "livestockLot", "Lot");
  const { lines, sireCodes } = data;

  // Running cycles by when the window opens, soonest first; a cycle with no
  // date at all goes last. Finished ones newest first.
  const running = lines
    .filter((l) => isRunning(l.cycle))
    .sort((a, b) => {
      const da = a.cycle.due?.from ?? "9999";
      const db = b.cycle.due?.from ?? "9999";
      return da < db ? -1 : da > db ? 1 : a.code.localeCompare(b.code);
    });
  const finished = lines
    .filter((l) => !isRunning(l.cycle))
    .sort((a, b) => (a.cycle.openedOn < b.cycle.openedOn ? 1 : -1))
    .slice(0, HISTORY_CAP);

  const count = (standing: DueStanding) =>
    running.filter((l) => dueStanding(l.cycle, today) === standing).length;
  const pregnant = running.filter((l) => l.cycle.state === "bred").length;

  const sireOf = (cycle: Cycle) => {
    const id = cycle.exposure?.sireLotId ?? null;
    return id ? (sireCodes.get(id) ?? "—") : null;
  };
  const whereFrom = (line: DueLine) =>
    line.cycle.exposure?.via === "pen" && line.insideOf
      ? `in with ${line.insideOf.code}`
      : line.cycle.exposure?.via === "pen"
        ? "in with the pen"
        : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<CalendarHeart />}
        title="Breeding"
        description="Who is due, and when. Record breeding on an animal's page, or on the pen the sire was in with."
      />

      <LivestockNav />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard
          label="Due now"
          value={count("now")}
          tone={count("now") > 0 ? "accent" : "default"}
          footnote="Inside the window today"
        />
        <StatCard
          label={`Due in ${DUE_SOON_DAYS} days`}
          value={count("soon")}
          footnote="Windows about to open"
        />
        <StatCard
          label="Past the window"
          value={count("past")}
          tone={count("past") > 0 ? "destructive" : "default"}
          footnote="Nothing recorded since"
        />
        <StatCard label="Pregnant" value={pregnant} footnote="Confirmed by a check" />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-semibold tracking-heading">
          Due{" "}
          <span className="font-normal text-muted-foreground">· {running.length}</span>
        </h2>

        {/* Phone: a card per animal, the whole card the link. */}
        <ul className="space-y-3 md:hidden">
          {running.length === 0 && (
            <li>
              <EmptyState
                title="Nobody is due"
                description={`Record breeding on an animal's page, or on the ${lotWord.toLowerCase()} the sire was in with, and the window shows here.`}
              />
            </li>
          )}
          {running.map((line) => (
            <li key={line.lotId}>
              <Link
                href={`${BASE}/${line.lotId}`}
                className="block rounded-2xl bg-card p-4 shadow-elevation-1"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {line.code}
                      {!line.isAnimal && (
                        <span className="text-muted-foreground"> · {line.head} loose</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {slugLabel(line.species)}
                      {line.insideOf && ` · in ${line.insideOf.code}`}
                    </p>
                  </div>
                  <StandingBadge standing={dueStanding(line.cycle, today)} state={line.cycle.state} />
                </div>
                <p className="mt-2 text-sm">{describeCycle(line.cycle, today)}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    sireOf(line.cycle) ? `Bred to ${sireOf(line.cycle)}` : line.cycle.exposure ? "Sire not recorded" : "From a check",
                    whereFrom(line),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <DataTable
            isEmpty={running.length === 0}
            empty={
              <EmptyState
                title="Nobody is due"
                description={`Record breeding on an animal's page, or on the ${lotWord.toLowerCase()} the sire was in with, and the window shows here.`}
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  <TableHead>Bred to</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Standing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {running.map((line) => (
                  <LinkRow key={line.lotId} href={`${BASE}/${line.lotId}`}>
                    <TableCell>
                      <Link
                        href={`${BASE}/${line.lotId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {line.code}
                      </Link>
                      {!line.isAnimal && (
                        <span className="text-muted-foreground"> · {line.head} loose</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {slugLabel(line.species)}
                        {line.insideOf && ` · in ${line.insideOf.code}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sireOf(line.cycle) ?? (
                        <span className="text-muted-foreground">
                          {line.cycle.exposure ? "Not recorded" : "From a check"}
                        </span>
                      )}
                      {whereFrom(line) && (
                        <div className="text-xs text-muted-foreground">{whereFrom(line)}</div>
                      )}
                    </TableCell>
                    <TableCell>{describeCycle(line.cycle, today)}</TableCell>
                    <TableCell>
                      <StandingBadge standing={dueStanding(line.cycle, today)} state={line.cycle.state} />
                    </TableCell>
                  </LinkRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </div>
      </section>

      {finished.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Finished{" "}
            <span className="font-normal text-muted-foreground">· {finished.length}</span>
          </h2>
          <ul className="divide-y rounded-2xl bg-card shadow-elevation-1">
            {finished.map((line) => (
              <li key={line.lotId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <Link
                    href={`${BASE}/${line.lotId}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {line.code}
                  </Link>
                  <span className="text-muted-foreground">
                    {sireOf(line.cycle) ? ` · bred to ${sireOf(line.cycle)}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span>{describeCycle(line.cycle, today)}</span>
                  <StandingBadge standing="undated" state={line.cycle.state} />
                </div>
              </li>
            ))}
          </ul>
          {lines.filter((l) => !isRunning(l.cycle)).length > HISTORY_CAP && (
            <p className="text-sm text-muted-foreground">
              Showing the last {HISTORY_CAP}. Each animal&rsquo;s own page has all of hers.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Where she stands, as one word. The state decides the word for a finished
 * cycle; the window decides it for a running one.
 */
function StandingBadge({ standing, state }: { standing: DueStanding; state: Cycle["state"] }) {
  if (state === "born") return <Badge variant="outline">Gave birth</Badge>;
  if (state === "open") return <Badge variant="outline">Open</Badge>;
  if (state === "lost") return <Badge variant="outline">Lost</Badge>;
  switch (standing) {
    case "past":
      return <Badge variant="destructive">Past the window</Badge>;
    case "now":
      return <Badge>Due now</Badge>;
    case "soon":
      return <Badge variant="secondary">Due soon</Badge>;
    case "later":
      return <Badge variant="outline">{state === "bred" ? "Pregnant" : "Exposed"}</Badge>;
    default:
      return <Badge variant="outline">{state === "bred" ? "Pregnant" : "Exposed"}</Badge>;
  }
}
