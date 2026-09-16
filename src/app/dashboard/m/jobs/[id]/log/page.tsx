import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { PunchList } from "@/packs/jobs/components/punch-list";
import { listPunchItems } from "@/packs/jobs/field-ops";
import { HardHat } from "lucide-react";
import { todayInTimezone } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { attachmentsForRecord, splitAttachments } from "@/modules/documents/attachments";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { RecordPhotos, type RecordFile, type RecordPhoto } from "@/modules/documents/components/record-photos";
import { getProject } from "@/packs/jobs/ops";
import { listDailyLogs } from "@/packs/jobs/field-ops";
import {
  attachLogDocumentAction,
  attachLogFileAction,
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
      const [days, punch, parties, pack] = await Promise.all([
        listDailyLogs(tx, ctx.tenant.id, project.id),
        listPunchItems(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      const photos = new Map<string, RecordPhoto[]>();
      const files = new Map<string, RecordFile[]>();
      if (documentsOn) {
        for (const day of days) {
          const attachments = await attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: PACK,
            entityType: DAILY_LOG_ENTITY,
            entityId: day.log.id,
          });
          const split = splitAttachments(attachments);
          photos.set(day.log.id, split.photos);
          files.set(day.log.id, split.files);
        }
      }
      return { project, days, punch, parties, photos, files, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, days } = data;
  const canLog = allowsWrite(ctx.role, "member");
  const canPhoto = canLog && roleMayWrite(ctx.role);
  /**
   * THIS MONTH, derived from the days already loaded — no second read and
   * nothing stored. Calendar month to date, on the tenant's own clock, because
   * "this month" on a site means the month the site is in.
   */
  const monthPrefix = todayInTimezone(ctx.tenant.timezone).slice(0, 7);
  const thisMonth = days.filter((d) => d.log.logDate.startsWith(monthPrefix));
  const monthly = {
    days: thisMonth.length,
    manHoursTenths: thisMonth.reduce((n, d) => n + d.manHoursTenths, 0),
    photos: thisMonth.reduce((n, d) => n + d.photoCount, 0),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-heading">Field</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {`${days.length} ${days.length === 1 ? "day" : "days"} on record`}
            {monthly.days > 0 &&
              ` · ${monthly.days} this month, ${tenthsToHours(monthly.manHoursTenths)} man-hours`}
          </p>
        </div>
        {canLog ? <DailyLogForm projectId={project.id} parties={data.parties} /> : null}
      </div>

      {/*
        TWO COLUMNS, because they are two different jobs: the log is a diary
        somebody adds to at the end of a day, the punch list is a list somebody
        ticks while walking the site. Stacked on a phone, where the log comes
        first — that is the one being written on site.
      */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
      {days.length === 0 && (
        <EmptyState
          icon={<HardHat />}
          title="No days logged yet"
          description="A day's report is the weather, what happened, who was on site and the photos — one per day, and saying it again adds to the same day."
          action={canLog ? <DailyLogForm projectId={project.id} parties={data.parties} /> : null}
        />
      )}

      {days.map((day) => (
        <Panel key={day.log.id} className="p-5">
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
                files={data.files.get(day.log.id) ?? []}
                canEdit={canPhoto}
                subject="day"
                attachAction={attachLogPhotoAction}
                setPrimaryAction={setLogPhotoPrimaryAction}
                detachAction={detachLogPhotoAction}
                attachFileAction={attachLogFileAction}
                attachExistingAction={attachLogDocumentAction}
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

        <div className="space-y-4">
          <Panel className="p-5">
            <h3 className="mb-3 font-heading text-sm font-medium tracking-heading">
              Punch list
            </h3>
            {/*
              The same component the Overview shows. A punch item is a Work
              item linked to the job, so both places are reading one list, not
              two that can disagree.
            */}
            <PunchList
              projectId={project.id}
              canEdit={canLog}
              items={data.punch.map((p) => ({
                id: p.id,
                title: p.title,
                notes: p.notes,
                dueOn: p.dueOn,
                done: p.completedAt !== null,
              }))}
            />
          </Panel>

          <Panel className="p-5">
            <h3 className="font-heading text-sm font-medium tracking-heading">
              This month
            </h3>
            <dl className="mt-3 space-y-2">
              {(
                [
                  ["Days logged", String(monthly.days)],
                  ["Man-hours", tenthsToHours(monthly.manHoursTenths)],
                  ["Photos", String(monthly.photos)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {/*
              DAYS LOST TO WEATHER IS NOT HERE, and that is deliberate. The
              design asked for it, but `weather` on a daily log is free text —
              "Rain, 8°C" — and nothing in the model says a day was LOST. A
              figure guessed from a string would be wrong on the day somebody
              typed "rain in the morning, worked through". It needs a field
              first.
            */}
            <p className="mt-3 text-xs text-muted-foreground">
              Since the 1st. A day is counted once, however many times it was
              added to.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
