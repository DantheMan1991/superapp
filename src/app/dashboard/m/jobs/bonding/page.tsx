import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor, pluralOf } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { listEntities } from "@/modules/accounting/core";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/packs/jobs/components/status-badge";
import { BondingLineDialog } from "@/packs/jobs/components/bond-form";
import { bondingView } from "@/packs/jobs/bonding-ops";
import { capacitySentence } from "@/packs/jobs/bonding-math";
import { BOND_STANDING_LABELS, PACK, slugLabel, type BondStanding } from "@/packs/jobs/vocabulary";

/**
 * Bonding across jobs (ADR 0078): what the surety will back for this
 * company, what is tying it up, and what is left. THE SCREEN THIS SLICE
 * EXISTS FOR — the record of each bond lives on its job's Contracts tab,
 * but *can I bid this one* can only be answered here, from the limits in
 * the surety's letter against the backlog on bonded work.
 *
 * Per company, because a surety underwrites a legal entity — the same axis
 * the WIP schedule is picked on.
 */

const BOND_TONES: Record<BondStanding, StatusTone> = {
  requested: "pending",
  active: "good",
  expiring: "pending",
  expired: "bad",
  released: "quiet",
  void: "quiet",
};

const cents = (value: number | null): string | null => (value === null ? null : (value / 100).toFixed(2));

export default async function BondingPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const { entity: requested } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const symbol = ctx.tenant.currencySymbol;
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const entities = await listEntities(tx, ctx.tenant.id);
      const fallback = entities.find((e) => e.isDefault)?.id ?? entities[0]?.id ?? null;
      const entityId = entities.some((e) => e.id === requested) ? requested! : fallback;
      if (!entityId) return null;
      const [view, parties, pack] = await Promise.all([
        bondingView(tx, ctx.tenant.id, entityId, today),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { entities, entityId, view, parties, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const projectWordCap = data ? labelFor(data.labels, "project", "Project") : "Project";
  const projectsWordCap = pluralOf(projectWordCap, "Project", "Projects");
  const projectWord = projectWordCap.toLowerCase();
  const projectsWord = projectsWordCap.toLowerCase();
  const isOwner = allowsWrite(ctx.role, "owner");

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Bonding" description="No company to bond yet." />
      </div>
    );
  }

  const { view, entities, entityId } = data;
  const entity = entities.find((e) => e.id === entityId)!;
  const { capacity, line } = view;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bonding"
        description={capacitySentence(capacity, projectWord, projectsWord)}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/m/jobs">
              <ChevronLeft className="mr-1 size-4" /> {projectsWordCap}
            </Link>
          </Button>
        }
      />

      {entities.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {entities.map((e) => (
            <Button key={e.id} variant={e.id === entityId ? "secondary" : "ghost"} size="sm" asChild>
              <Link href={`/dashboard/m/jobs/bonding?entity=${e.id}`}>{e.name}</Link>
            </Button>
          ))}
        </div>
      )}

      <Panel className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">{entity.name}&apos;s line</h2>
          {isOwner && (
            <BondingLineDialog
              entityId={entityId}
              entityName={entity.name}
              singleJobLimit={cents(line?.singleJobLimitCents ?? null) ?? ""}
              aggregateLimit={cents(line?.aggregateLimitCents ?? null) ?? ""}
              suretyPartyId={line?.suretyPartyId ?? null}
              notes={line?.notes ?? ""}
              parties={data.parties}
            />
          )}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Single job</dt>
            <dd className="mt-0.5 tabular-nums">
              {line?.singleJobLimitCents ? formatMoney(line.singleJobLimitCents, symbol) : <span className="text-muted-foreground">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Aggregate</dt>
            <dd className="mt-0.5 tabular-nums">
              {line?.aggregateLimitCents ? formatMoney(line.aggregateLimitCents, symbol) : <span className="text-muted-foreground">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Work on hand</dt>
            <dd className="mt-0.5 tabular-nums">{formatMoney(capacity.usedCents, symbol)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Left on the line</dt>
            <dd className="mt-0.5 tabular-nums">
              {capacity.availableCents === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className={capacity.over ? "text-destructive" : ""}>{formatMoney(capacity.availableCents, symbol)}</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {/*
            WHY BACKLOG AND NOT CONTRACT VALUE: a surety backs the work still to
            do, so a job billed to the end ties up nothing. And a job counts ONCE
            however many bonds it carries — performance and payment come as a
            pair, and counting both would report twice the exposure (ADR 0078).
          */}
          Work on hand is what is left to build on bonded {projectsWord}: the contract less what has been billed, counted once per {projectWord}{" "}
          however many bonds it carries. Released and expired bonds let their {projectWord} go.
        </p>
        {line?.notes && <p className="mt-2 text-xs text-muted-foreground">{line.notes}</p>}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">What is tying it up</h2>
          <span className="text-xs text-muted-foreground">Biggest backlog first</span>
        </div>
        {view.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bonded work on hand. A bond is recorded on its {projectWord}&apos;s Contracts tab, and from the day it is asked for it counts here.
          </p>
        ) : (
          <div className="relative w-full min-w-0 overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="min-w-[12rem] px-2 py-1.5 text-left">{projectWordCap}</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-right">Contract</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-right">Billed</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-right">Work on hand</th>
                  <th className="min-w-[14rem] px-2 py-1.5 text-left">Bonds</th>
                </tr>
              </thead>
              <tbody>
                {view.jobs.map((job) => (
                  <tr key={job.projectId} className="border-t align-top">
                    <td className="min-w-[12rem] px-2 py-1.5">
                      <Link href={`/dashboard/m/jobs/${job.projectId}/contracts`} className="font-medium underline-offset-2 hover:underline">
                        {job.number}
                      </Link>
                      <p className="text-xs text-muted-foreground">{job.name}</p>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(job.contractCents, symbol)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(job.billedCents, symbol)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{formatMoney(job.backlogCents, symbol)}</td>
                    <td className="min-w-[14rem] px-2 py-1.5">
                      <ul className="space-y-1">
                        {job.bonds.map((b) => (
                          <li key={b.bond.id} className="flex flex-wrap items-center gap-1.5">
                            <span>{slugLabel(b.bond.kind)}</span>
                            <StatusBadge tone={BOND_TONES[b.standing]}>{BOND_STANDING_LABELS[b.standing]}</StatusBadge>
                            {b.bond.expiresOn && <span className="text-xs text-muted-foreground">to {b.bond.expiresOn}</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {view.attention.length > 0 && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">Worth a look</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Bonds ending soon, past their date, or still only asked for. An expired bond has let its {projectWord} go on the line above, which may be
            right or may mean nobody renewed it.
          </p>
          <ul className="space-y-1 text-sm">
            {view.attention.map(({ projectId, number, row }) => (
              <li key={row.bond.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/dashboard/m/jobs/${projectId}/contracts`} className="font-medium underline-offset-2 hover:underline">
                  {number}
                </Link>
                <span>{slugLabel(row.bond.kind)}</span>
                <StatusBadge tone={BOND_TONES[row.standing]}>{BOND_STANDING_LABELS[row.standing]}</StatusBadge>
                {row.bond.expiresOn && <span className="text-xs text-muted-foreground">{row.bond.expiresOn}</span>}
                {row.suretyName && <span className="text-xs text-muted-foreground">{row.suretyName}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
