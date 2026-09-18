import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, HardHat, Pencil } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { listCostCodeSets } from "@/packs/jobs/ops";
import { projectVitals } from "@/packs/jobs/vitals-ops";
import { ProjectVitalsStrip } from "@/packs/jobs/components/project-vitals";
import { ProjectForm } from "@/packs/jobs/components/project-form";
import { ProjectNav } from "@/packs/jobs/components/project-nav";
import { tabsWithRows } from "@/packs/jobs/tab-rows";
import { visibleTabs } from "@/packs/jobs/tabs";
import { StatusBadge, projectStatusTone } from "@/packs/jobs/components/status-badge";
import {
  PACK,
  STATUS_LABELS,
  deliveryMethodsFrom,
  isProjectStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";

/**
 * A job's identity, on every one of its tabs.
 *
 * ── WHY THIS IS A LAYOUT AND NOT A HEADER EACH PAGE DRAWS ───────────────────
 *
 * The project page used to be eleven `<Panel>`s stacked flat with no in-page
 * navigation, and the five pages that had already been split off each redrew
 * their own back link and their own `<PageHeader>` — five copies of the same
 * six lines, which had already drifted apart. A layout draws them once.
 *
 * It also means the vitals strip does not move, reload or flicker as somebody
 * goes from Job cost to Schedule to Field. That is the point of it: the five
 * figures are the job's position, not one tab's content, so they must be the
 * one thing on the page that never changes when a tab does.
 *
 * The sections themselves are `ProjectNav`, a client component — a lucide icon
 * is a function and cannot cross the server boundary. See its own note.
 *
 * ── THE STATUS BADGE IS TINTED, NOT FILLED ──────────────────────────────────
 *
 * Same rule as the list: `--success` is a fill and `--success-foreground` its
 * legible twin, so a chip is a pale tint with dark text. `globals.css` sets out
 * the measured reason.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "jobs");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const vitals = await projectVitals(tx, ctx.tenant.id, id);
      if (!vitals) return null;
      const [entities, parties, enterprises, sets, pack] = await Promise.all([
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
          .select({ id: schema.parties.id, name: schema.parties.displayName })
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
      // Which of the optional tabs this job already has work on, so a tenant
      // who switched one off never loses sight of what was on it (`tabs.ts`).
      const withRows = await tabsWithRows(tx, ctx.tenant.id, vitals.project.id);
      return {
        vitals,
        entities,
        parties,
        enterprises,
        sets,
        labels: pack.labels,
        config: pack.config,
        withRows,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { vitals } = data;
  const project = vitals.project;
  const projectWord = labelFor(data.labels, "project", "Project");
  const clientWord = labelFor(data.labels, "customer", "Customer");
  const isOwner = allowsWrite(ctx.role, "owner");

  const editProject = isOwner ? (
    <ProjectForm
      entities={data.entities}
      parties={data.parties}
      enterprises={data.enterprises}
      costCodeSets={data.sets.map((x) => ({
        id: x.id,
        name: x.name,
        isDefault: x.isDefault,
      }))}
      deliveryMethods={deliveryMethodsFrom(data.config)}
      projectWord={projectWord}
      clientWord={clientWord}
      existing={{
        id: project.id,
        version: project.version,
        number: project.number,
        name: project.name,
        status: project.status,
        deliveryMethod: project.deliveryMethod,
        partyId: project.partyId,
        enterpriseId: project.enterpriseId,
        costCodeSetId: project.costCodeSetId,
        address: project.address,
        startsOn: project.startsOn,
        endsOn: project.endsOn,
        notes: project.notes,
      }}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="mr-1.5 size-4" /> Edit
        </Button>
      }
    />
  ) : null;

  /** number · address · client · kind — the job's coordinates, in one line. */
  const description = [
    project.number,
    project.address,
    vitals.clientName,
    project.deliveryMethod ? slugLabel(project.deliveryMethod) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> All {projectWord.toLowerCase()}s
      </Link>

      <PageHeader
        icon={<HardHat />}
        title={project.name}
        titleAfter={
          <StatusBadge tone={projectStatusTone(project.status)}>
            {isProjectStatus(project.status)
              ? STATUS_LABELS[project.status]
              : project.status}
          </StatusBadge>
        }
        description={description}
        actions={editProject}
      />

      <ProjectVitalsStrip vitals={vitals} symbol={ctx.tenant.currencySymbol} />

      <ProjectNav projectId={project.id} show={visibleTabs(data.config, data.withRows)} />

      {children}
    </div>
  );
}
