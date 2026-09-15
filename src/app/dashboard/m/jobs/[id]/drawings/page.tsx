import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Layers } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { getProject } from "@/packs/jobs/ops";
import { drawingsSummary, listDrawingSets, listSheets, type SheetRow } from "@/packs/jobs/drawings-ops";
import { compareDisciplines, disciplineLabel } from "@/packs/jobs/drawings-math";
import { AddDrawingSetDialog, EditDrawingSetDialog } from "@/packs/jobs/components/drawing-set-form";
import { PACK } from "@/packs/jobs/vocabulary";

/**
 * A job's drawings: the current set, sheet by sheet, grouped the way the
 * index page groups them; the issues it came in; what has been superseded
 * (ADR 0072). Every sheet is a page of a PDF in Documents; the pack knows
 * which page is which and which issue is newest.
 */
export default async function DrawingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [sets, sheets, summary, parties, pack] = await Promise.all([
        listDrawingSets(tx, ctx.tenant.id, project.id),
        listSheets(tx, ctx.tenant.id, project.id),
        drawingsSummary(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { project, sets, sheets, summary, parties, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, sets, sheets, summary } = data;
  const canEdit = allowsWrite(ctx.role, "member");
  const canFile = documentsOn && canEdit && roleMayWrite(ctx.role);
  const projectWord = labelFor(data.labels, "project", "Project");
  const today = todayInTimezone(ctx.tenant.timezone);
  const current = sheets.filter((s) => s.isCurrent);
  const superseded = sheets.filter((s) => !s.isCurrent);
  const byId = new Map(sheets.map((s) => [s.sheet.id, s]));

  const groups = new Map<string, SheetRow[]>();
  for (const s of current) {
    const list = groups.get(s.discipline) ?? [];
    list.push(s);
    groups.set(s.discipline, list);
  }
  const disciplines = [...groups.keys()].sort(compareDisciplines);

  const sentence =
    summary.sets === 0
      ? documentsOn
        ? "No drawings yet. A set is an issue of the drawings — the permit set, the construction set, ASI 3 — as a PDF; each page with a sheet number becomes a sheet, and the newest issue of every number is the current set."
        : "Drawings need Documents switched on: a set is a PDF in the cabinet, read into sheets."
      : `${summary.sheets} ${summary.sheets === 1 ? "sheet" : "sheets"} in the current set${
          summary.disciplines.length > 1 ? ` across ${summary.disciplines.length} disciplines` : ""
        }, from ${summary.sets} ${summary.sets === 1 ? "issue" : "issues"}; the newest is ${summary.latestSetName}, dated ${summary.latestIssuedOn}${
          summary.superseded > 0 ? `; ${summary.superseded} ${summary.superseded === 1 ? "sheet" : "sheets"} superseded` : ""
        }.`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Drawings"
        description={`${projectWord} ${project.number} · ${sentence}`}
        actions={canFile ? <AddDrawingSetDialog projectId={project.id} tenantId={ctx.tenant.id} parties={data.parties} today={today} /> : undefined}
      />

      <Panel className="p-5">
        <h2 className="mb-3 font-heading text-sm font-medium tracking-heading">Current set</h2>
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {sets.length === 0
              ? sentence
              : "The sets have no sheets yet. Open a set with the pencil and read its file into pages."}
          </p>
        ) : (
          <div className="space-y-5">
            {disciplines.map((d) => (
              <section key={d}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {disciplineLabel(d)} · {groups.get(d)!.length}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groups.get(d)!.map((s) => (
                    <li key={s.sheet.id}>
                      <Link
                        href={`/dashboard/m/jobs/${project.id}/drawings/${s.sheet.id}`}
                        className="flex h-full flex-col gap-1 rounded-lg border px-3 py-2 hover:bg-secondary/50"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-semibold">{s.sheet.sheetNumber}</span>
                          {s.issues > 1 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {s.issues} issues
                            </Badge>
                          )}
                        </span>
                        <span className="text-sm">{s.sheet.title || <span className="text-muted-foreground">Untitled</span>}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.setName} · {s.issuedOn}
                          {s.sheet.revision ? ` · rev ${s.sheet.revision}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Sets</h2>
          <span className="text-xs text-muted-foreground">Newest issue first</span>
        </div>
        {sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sets yet.</p>
        ) : (
          <div className="relative w-full min-w-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Set</th>
                  <th className="px-2 py-1.5 text-left">Dated</th>
                  <th className="px-2 py-1.5 text-left">From</th>
                  <th className="px-2 py-1.5 text-left">Files</th>
                  <th className="px-2 py-1.5 text-right">Sheets</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {sets.map((row) => (
                  <tr key={row.set.id} className="border-t align-top">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <Layers className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{row.set.name}</span>
                      </div>
                      {row.set.notes && <p className="mt-0.5 text-xs text-muted-foreground">{row.set.notes}</p>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.set.issuedOn}</td>
                    <td className="px-2 py-1.5">{row.fromPartyName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5">
                      {row.files.length === 0 ? (
                        <span className="text-muted-foreground">No file yet</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {row.files.map((f) => (
                            <li key={f.documentId} className="flex items-center gap-1.5 text-xs">
                              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                              <a href={`/api/documents/${f.documentId}/file`} className="truncate underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                                {f.fileName}
                              </a>
                              <span className="text-muted-foreground">
                                {f.mimeType !== "application/pdf" ? "· not a PDF" : f.sheets === 0 ? "· not read yet" : `· ${f.sheets} ${f.sheets === 1 ? "sheet" : "sheets"}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.sheets}</td>
                    <td className="px-2 py-1.5 text-right">
                      {canFile && (
                        <EditDrawingSetDialog
                          key={`${row.set.id}:${row.set.version}`}
                          projectId={project.id}
                          tenantId={ctx.tenant.id}
                          parties={data.parties}
                          existing={{
                            id: row.set.id,
                            version: row.set.version,
                            name: row.set.name,
                            issuedOn: row.set.issuedOn,
                            fromPartyId: row.set.fromPartyId,
                            notes: row.set.notes,
                          }}
                          files={row.files.map((f) => ({
                            documentId: f.documentId,
                            fileName: f.fileName,
                            sheets: f.sheets,
                            isPdf: f.mimeType === "application/pdf",
                            indexed: sheets
                              .filter((s) => s.sheet.setId === row.set.id && s.sheet.documentId === f.documentId)
                              .map((s) => ({ pageNumber: s.sheet.pageNumber, sheetNumber: s.sheet.sheetNumber, title: s.sheet.title, revision: s.sheet.revision })),
                          }))}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {superseded.length > 0 && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">Superseded</h2>
          <p className="mb-3 text-xs text-muted-foreground">Earlier issues of sheets a newer set replaced. Kept for the record; the current set is above.</p>
          <ul className="space-y-1 text-sm">
            {superseded.map((s) => {
              const head = s.currentId ? byId.get(s.currentId) : undefined;
              return (
                <li key={s.sheet.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/dashboard/m/jobs/${project.id}/drawings/${s.sheet.id}`} className="font-mono font-medium underline-offset-2 hover:underline">
                    {s.sheet.sheetNumber}
                  </Link>
                  <span>{s.sheet.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.setName} · {s.issuedOn}
                    {head ? ` · replaced by ${head.setName} · ${head.issuedOn}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
