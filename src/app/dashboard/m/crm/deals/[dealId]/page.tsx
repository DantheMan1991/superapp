import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, ChevronLeft, User } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CrmError } from "@/modules/crm/core/errors";
import { loadDeal } from "@/modules/crm/deal-ops";
import { listStages } from "@/modules/crm/pipeline-ops";
import { listFieldDefs } from "@/modules/crm/field-ops";
// `centsToInput` comes from `core/pipeline`, NOT from the form. Every export of
// a `"use client"` module is a client reference, so calling one here would
// throw at render — see that function's header.
import { centsToInput } from "@/modules/crm/core/pipeline";
import { DealForm } from "@/modules/crm/components/deal-form";
import { MoveDealButton } from "@/modules/crm/components/deal-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

export default async function DealPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const detail = await loadDeal(tx, ctx.tenant.id, dealId);
      return {
        detail,
        stages: await listStages(tx, ctx.tenant.id, detail.deal.pipelineId),
        fieldDefs: await listFieldDefs(tx, ctx.tenant.id, "deal"),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  ).catch((err) => {
    // A deal on a restricted record is absent for staff, and absent is also
    // what "no such deal" looks like. 404 either way, never 403.
    if (err instanceof CrmError && err.code === "DEAL_NOT_FOUND") notFound();
    throw err;
  });

  const { detail, stages, fieldDefs } = data;
  const { deal, party, stage, primaryContact, stakeholders, history } = detail;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`${BASE}/deals`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Board
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{deal.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {party.kind === "person" ? (
              <User className="size-4 shrink-0" />
            ) : (
              <Building2 className="size-4 shrink-0" />
            )}
            <Link
              href={`${BASE}/records/${party.id}`}
              className="hover:underline"
            >
              {party.displayName}
            </Link>
            {primaryContact && <span>· {primaryContact.displayName}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={stage.outcome === "open" ? "secondary" : "outline"}>
              {stage.name}
            </Badge>
            {deal.closedAt && (
              <span className="text-xs text-muted-foreground">
                closed {deal.closedAt.toISOString().slice(0, 10)}
              </span>
            )}
          </div>
        </div>
        <MoveDealButton
          dealId={deal.id}
          dealVersion={deal.version}
          partyId={deal.partyId}
          currentStageId={deal.stageId}
          stages={stages}
          label="Move stage"
        />
      </div>

      <DealForm
        mode="edit"
        dealId={deal.id}
        dealVersion={deal.version}
        partyId={deal.partyId}
        partyName={party.displayName}
        fieldDefs={fieldDefs}
        initialCustom={(deal.custom ?? {}) as Record<string, unknown>}
        initial={{
          title: deal.title,
          amount: centsToInput(deal.amountCents),
          expectedCloseOn: deal.expectedCloseOn ?? "",
        }}
      />

      {stakeholders.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Also involved</h2>
            <ul className="divide-y rounded-md border">
              {stakeholders.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <Link
                    href={`${BASE}/records/${s.party.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {s.party.displayName}
                  </Link>
                  {s.role && (
                    <p className="text-xs text-muted-foreground">{s.role}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Separator />

      {/*
        The history slice 3 shipped a table for. Rendering it now means the
        table has a reader from the day it exists, rather than being an
        unverified promise until slice 9 arrives.
      */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">History</h2>
        {history.length === 0 ? (
          <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {history.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 px-4 py-2.5">
                <span className="text-sm">
                  {e.fromStageName
                    ? `${e.fromStageName} → ${e.toStageName}`
                    : `Started in ${e.toStageName}`}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {e.changedAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
