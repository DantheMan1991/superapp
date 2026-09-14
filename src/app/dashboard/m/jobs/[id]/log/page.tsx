import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { attachmentsForRecord } from "@/modules/documents/attachments";
import { isDisplayableImage } from "@/modules/documents/allowlist";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { RecordPhotos, type RecordPhoto } from "@/modules/documents/components/record-photos";
import { getProject } from "@/packs/jobs/ops";
import { listDailyLogs } from "@/packs/jobs/field-ops";
import {
  attachLogPhotoAction,
  detachLogPhotoAction,
  setLogPhotoPrimaryAction,
} from "@/packs/jobs/actions";
import { DailyLogForm } from "@/packs/jobs/components/daily-log-form";
import { DAILY_LOG_ENTITY, PACK, tenthsToHours } from "@/packs/jobs/vocabulary";

/**
 * Every day on a job, newest first: the weather, what happened, who was on
 * site, and the photos.
 *
 * THE PHOTOS ARE DOCUMENTS' — the same `RecordPhotos` gallery a photo of an
 * animal or an asset uses, with this pack's own actions handed in as props so
 * the module gate and the entity type are the pack's facts and not the
 * browser's. The panel renders only where Documents is switched on, because
 * the FILE is the DMS's and a button that uploads into a module the tenant
 * has not enabled would fail at the gate.
 */
export default async function DailyLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [days, parties, pack] = await Promise.all([
        listDailyLogs(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      const photos = new Map<string, RecordPhoto[]>();
      if (documentsOn) {
        for (const day of days) {
          const attachments = await attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: PACK,
            entityType: DAILY_LOG_ENTITY,
            entityId: day.log.id,
          });
          photos.set(
            day.log.id,
            attachments
              .filter((a) => isDisplayableImage(a.document.mimeType))
              .map((a) => ({
                documentId: a.document.id,
                fileName: a.document.fileName,
                title: a.document.title ?? "",
                mimeType: a.document.mimeType,
                isPrimary: a.isPrimary,
              })),
          );
        }
      }
      return { project, days, parties, photos, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, days } = data;
  const canLog = allowsWrite(ctx.role, "member");
  const canPhoto = canLog && roleMayWrite(ctx.role);
  const projectWord = labelFor(data.labels, "project", "Project");

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/m/jobs/${project.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {project.number} · {project.name}
      </Link>
      <PageHeader
        title="Daily log"
        description={`${projectWord} ${project.number} · ${days.length} ${days.length === 1 ? "day" : "days"} on record`}
        actions={canLog ? <DailyLogForm projectId={project.id} parties={data.parties} /> : null}
      />

      {days.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No days logged yet. A day&apos;s report is the weather, what
            happened, who was on site and the photos — one per day, and
            saying it again adds to the same day.
          </p>
        </Panel>
      )}

      {days.map((day) => (
        <Panel key={day.log.id}>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-heading text-sm font-medium tracking-heading">
                {day.log.logDate}
              </h2>
              <p className="text-xs text-muted-foreground">
                {[
                  day.log.weather || null,
                  day.crews.length > 0
                    ? `${day.crews.reduce((n, c) => n + c.workers, 0)} on site · ${tenthsToHours(day.manHoursTenths)} man-hours`
                    : null,
                  day.photoCount > 0 ? `${day.photoCount} ${day.photoCount === 1 ? "photo" : "photos"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Nothing recorded beyond the day"}
              </p>
            </div>
            {canLog && (
              <DailyLogForm
                projectId={project.id}
                parties={data.parties}
                existing={{
                  id: day.log.id,
                  logDate: day.log.logDate,
                  weather: day.log.weather,
                  notes: day.log.notes,
                  crews: day.crews.map((c) => ({
                    partyId: c.partyId,
                    trade: c.trade,
                    workers: c.workers,
                    hoursTenths: c.hoursTenths,
                  })),
                }}
                trigger={
                  <Button variant="ghost" size="icon">
                    <Pencil className="size-4" />
                    <span className="sr-only">Edit {day.log.logDate}</span>
                  </Button>
                }
              />
            )}
          </div>

          {day.log.notes && (
            <p className="whitespace-pre-wrap text-sm">{day.log.notes}</p>
          )}

          {day.crews.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">Who</th>
                  <th className="py-1 text-right font-medium">People</th>
                  <th className="py-1 text-right font-medium">Hours each</th>
                </tr>
              </thead>
              <tbody>
                {day.crews.map((c) => (
                  <tr key={c.id} className="border-t border-border/50">
                    <td className="py-1">
                      {c.trade || c.partyName || "Crew"}
                      {c.trade && c.partyName && (
                        <span className="text-muted-foreground"> · {c.partyName}</span>
                      )}
                      {c.notes && (
                        <span className="block text-xs text-muted-foreground">{c.notes}</span>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">{c.workers}</td>
                    <td className="py-1 text-right tabular-nums">{tenthsToHours(c.hoursTenths)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-3">
            {documentsOn ? (
              <RecordPhotos
                entityId={day.log.id}
                tenantId={ctx.tenant.id}
                photos={data.photos.get(day.log.id) ?? []}
                canEdit={canPhoto}
                subject="day"
                attachAction={attachLogPhotoAction}
                setPrimaryAction={setLogPhotoPrimaryAction}
                detachAction={detachLogPhotoAction}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Photos need Documents switched on.
              </p>
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}
