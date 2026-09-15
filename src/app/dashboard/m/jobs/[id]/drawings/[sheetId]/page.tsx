import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProject } from "@/packs/jobs/ops";
import { getSheet, listSheets } from "@/packs/jobs/drawings-ops";
import { disciplineLabel } from "@/packs/jobs/drawings-math";
import { SheetViewer } from "@/packs/jobs/components/sheet-viewer";
import { SheetForm } from "@/packs/jobs/components/sheet-form";
import { PACK } from "@/packs/jobs/vocabulary";

/**
 * One sheet, large: the page of the set's PDF drawn by pdf.js, the sheet
 * before and after it in the current set, every issue this number has had,
 * and a plain word when this is not the current one (ADR 0072).
 */
export default async function SheetPage({ params }: { params: Promise<{ id: string; sheetId: string }> }) {
  const { id, sheetId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const sheet = await getSheet(tx, ctx.tenant.id, sheetId);
      if (!sheet || sheet.projectId !== project.id) return null;
      const sheets = await listSheets(tx, ctx.tenant.id, project.id);
      return { project, sheet, sheets };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, sheet, sheets } = data;
  const row = sheets.find((s) => s.sheet.id === sheet.id);
  if (!row) notFound();
  const canEdit = allowsWrite(ctx.role, "member");
  const base = `/dashboard/m/jobs/${project.id}/drawings`;
  const current = sheets.filter((s) => s.isCurrent);
  const at = current.findIndex((s) => s.sheet.id === sheet.id);
  const previous = at > 0 ? current[at - 1] : null;
  const next = at >= 0 && at < current.length - 1 ? current[at + 1] : null;
  const issues = sheets.filter((s) => s.sheet.sheetNumber === sheet.sheetNumber);
  const head = row.currentId ? sheets.find((s) => s.sheet.id === row.currentId) : null;
  const url = `/api/documents/${sheet.documentId}/file`;
  const label = `${sheet.sheetNumber}${sheet.title ? ` · ${sheet.title}` : ""}`;

  return (
    <div className="space-y-4">
      <Link href={base} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {project.number} · Drawings
      </Link>
      <PageHeader
        title={label}
        description={`${disciplineLabel(row.discipline)} · ${row.setName}, dated ${row.issuedOn}${sheet.revision ? ` · rev ${sheet.revision}` : ""} · page ${sheet.pageNumber} of ${row.fileName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {row.isCurrent && (
              <>
                <Button variant="outline" size="sm" asChild disabled={!previous}>
                  {previous ? (
                    <Link href={`${base}/${previous.sheet.id}`}>
                      <ChevronLeft className="mr-1 size-4" /> {previous.sheet.sheetNumber}
                    </Link>
                  ) : (
                    <span className="opacity-50">
                      <ChevronLeft className="mr-1 size-4" /> First
                    </span>
                  )}
                </Button>
                <Button variant="outline" size="sm" asChild disabled={!next}>
                  {next ? (
                    <Link href={`${base}/${next.sheet.id}`}>
                      {next.sheet.sheetNumber} <ChevronRight className="ml-1 size-4" />
                    </Link>
                  ) : (
                    <span className="opacity-50">
                      Last <ChevronRight className="ml-1 size-4" />
                    </span>
                  )}
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={`${url}?download=1`}>
                <Download className="mr-1.5 size-4" /> The file
              </a>
            </Button>
            {canEdit && (
              <SheetForm
                key={`${sheet.id}:${sheet.version}`}
                projectId={project.id}
                sheet={{
                  id: sheet.id,
                  version: sheet.version,
                  sheetNumber: sheet.sheetNumber,
                  title: sheet.title,
                  revision: sheet.revision,
                  pageNumber: sheet.pageNumber,
                  setName: row.setName,
                }}
                afterDelete={base}
              />
            )}
          </div>
        }
      />

      {!row.isCurrent && head && (
        <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <span className="font-medium">Superseded.</span> This is the {row.setName} issue of {sheet.sheetNumber}, dated {row.issuedOn}; the current one is from {head.setName},
          dated {head.issuedOn}.{" "}
          <Link href={`${base}/${head.sheet.id}`} className="font-medium underline underline-offset-2">
            Open the current {sheet.sheetNumber}
          </Link>
        </div>
      )}

      <Panel className="p-5">
        <SheetViewer url={url} page={sheet.pageNumber} label={label} />
      </Panel>

      {issues.length > 1 && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">Issues of {sheet.sheetNumber}</h2>
          <p className="mb-3 text-xs text-muted-foreground">Every set this number came in, newest first. The newest is the current one.</p>
          <ul className="space-y-1 text-sm">
            {issues.map((s) => (
              <li key={s.sheet.id} className="flex flex-wrap items-baseline gap-x-2">
                {s.sheet.id === sheet.id ? (
                  <span className="font-medium">{s.setName}</span>
                ) : (
                  <Link href={`${base}/${s.sheet.id}`} className="font-medium underline-offset-2 hover:underline">
                    {s.setName}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">
                  {s.issuedOn}
                  {s.sheet.revision ? ` · rev ${s.sheet.revision}` : ""}
                  {s.sheet.title && s.sheet.title !== sheet.title ? ` · ${s.sheet.title}` : ""}
                </span>
                {s.isCurrent && (
                  <Badge variant="secondary" className="text-[10px]">
                    current
                  </Badge>
                )}
                {s.sheet.id === sheet.id && <span className="text-xs text-muted-foreground">(this one)</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
