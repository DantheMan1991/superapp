import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  Asset,
  AssetMaintenanceSchedule,
  AssetMaintenanceEvent,
} from "@/db/schema";
import {
  createWorkForEntity,
  attachEntity,
  listWorkForEntity,
} from "@/lib/work/entity-work";
import { AssetError, type AssetCtx } from "./ops";
import {
  computeDue,
  isMaintenanceKind,
  maintenanceWorkTitle,
  type DueResult,
} from "./core/maintenance";

/**
 * Maintenance: schedules, meter readings, what was done, and what is due.
 *
 * THE LINE THIS PACK DOES NOT CROSS: it has no task engine. A due service
 * becomes a WORK ITEM through the Layer 0 seam, exactly as a CRM follow-up
 * does, and is worked with the same verbs on the same shared row. See
 * docs/extension-model.md §4b — a pack never builds its own to-do list and
 * never sends somebody to Work to act on what it raised.
 */

/** This pack's slug, and the entity types it registers on work links (P3). */
const PACK = "assets";
const ASSET_ENTITY = "asset";
/**
 * The SECOND link on a maintenance work item, and the one that makes
 * emission idempotent: "is there already an open item for this schedule" is a
 * question only a schedule-scoped link can answer. Linking to the asset alone
 * would make two different services on one tractor indistinguishable.
 */
const SCHEDULE_ENTITY = "maintenance_schedule";

export async function listSchedules(
  tx: Tx,
  tenantId: string,
  assetId: string,
): Promise<AssetMaintenanceSchedule[]> {
  return tx.query.assetMaintenanceSchedules.findMany({
    where: and(
      eq(schema.assetMaintenanceSchedules.tenantId, tenantId),
      eq(schema.assetMaintenanceSchedules.assetId, assetId),
    ),
    orderBy: (s, { asc }) => [asc(s.name)],
  });
}

export interface ScheduleInput {
  name: string;
  kind: string;
  intervalMonths?: number | null;
  intervalMeter?: number | null;
  meterUnit?: string | null;
  notes?: string;
}

export async function createSchedule(
  tx: Tx,
  ctx: AssetCtx,
  assetId: string,
  input: ScheduleInput,
): Promise<AssetMaintenanceSchedule> {
  requireWrite(ctx, "owner");
  if (!isMaintenanceKind(input.kind)) {
    throw new AssetError("INVALID_KIND", `invalid schedule kind: ${input.kind}`);
  }
  const rows = await tx
    .insert(schema.assetMaintenanceSchedules)
    .values({
      tenantId: ctx.tenantId,
      assetId,
      name: input.name.trim(),
      kind: input.kind,
      // Each kind carries only its own interval. The
      // `ams_interval_matches_kind` CHECK refuses the other, so a half-edited
      // row is unrepresentable rather than merely discouraged.
      intervalMonths: input.kind === "calendar" ? (input.intervalMonths ?? null) : null,
      intervalMeter: input.kind === "meter" ? (input.intervalMeter ?? null) : null,
      meterUnit: input.kind === "meter" ? (input.meterUnit ?? "hours") : null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function setScheduleActive(
  tx: Tx,
  ctx: AssetCtx,
  scheduleId: string,
  isActive: boolean,
): Promise<void> {
  requireWrite(ctx, "owner");
  await tx
    .update(schema.assetMaintenanceSchedules)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(schema.assetMaintenanceSchedules.tenantId, ctx.tenantId),
        eq(schema.assetMaintenanceSchedules.id, scheduleId),
      ),
    );
}

/** The latest meter reading for an asset, or null when none was ever taken. */
export async function latestMeter(
  tx: Tx,
  tenantId: string,
  assetId: string,
): Promise<{ reading: number; readOn: string; unit: string } | null> {
  const [row] = await tx
    .select({
      reading: schema.assetMeterReadings.reading,
      readOn: schema.assetMeterReadings.readOn,
      unit: schema.assetMeterReadings.unit,
    })
    .from(schema.assetMeterReadings)
    .where(
      and(
        eq(schema.assetMeterReadings.tenantId, tenantId),
        eq(schema.assetMeterReadings.assetId, assetId),
      ),
    )
    .orderBy(desc(schema.assetMeterReadings.readOn))
    .limit(1);
  return row ?? null;
}

export async function recordMeterReading(
  tx: Tx,
  ctx: AssetCtx,
  assetId: string,
  input: { readOn: string; reading: number; unit?: string },
): Promise<void> {
  requireWrite(ctx, "member");
  await tx.insert(schema.assetMeterReadings).values({
    tenantId: ctx.tenantId,
    assetId,
    readOn: input.readOn,
    reading: input.reading,
    unit: input.unit ?? "hours",
  });
}

/** The most recent service against a schedule, or null when never done. */
async function lastEvent(
  tx: Tx,
  tenantId: string,
  scheduleId: string,
): Promise<AssetMaintenanceEvent | null> {
  const [row] = await tx
    .select()
    .from(schema.assetMaintenanceEvents)
    .where(
      and(
        eq(schema.assetMaintenanceEvents.tenantId, tenantId),
        eq(schema.assetMaintenanceEvents.scheduleId, scheduleId),
      ),
    )
    .orderBy(desc(schema.assetMaintenanceEvents.performedOn))
    .limit(1);
  return row ?? null;
}

export async function listEvents(
  tx: Tx,
  tenantId: string,
  assetId: string,
  limit = 20,
): Promise<AssetMaintenanceEvent[]> {
  return tx.query.assetMaintenanceEvents.findMany({
    where: and(
      eq(schema.assetMaintenanceEvents.tenantId, tenantId),
      eq(schema.assetMaintenanceEvents.assetId, assetId),
    ),
    orderBy: (e, { desc: byDesc }) => [byDesc(e.performedOn)],
    limit,
  });
}

/**
 * Record that a service happened.
 *
 * This is what advances the schedule — next-due is computed FROM events, never
 * stored, so a backdated service corrects the whole sequence rather than
 * leaving a stale `next_due_on` behind. Same reasoning as accumulated
 * depreciation being read from the ledger.
 */
export async function recordService(
  tx: Tx,
  ctx: AssetCtx,
  assetId: string,
  input: {
    scheduleId?: string | null;
    performedOn: string;
    meterReading?: number | null;
    description?: string;
    workItemId?: string | null;
  },
): Promise<AssetMaintenanceEvent> {
  requireWrite(ctx, "member");
  const rows = await tx
    .insert(schema.assetMaintenanceEvents)
    .values({
      tenantId: ctx.tenantId,
      assetId,
      scheduleId: input.scheduleId ?? null,
      performedOn: input.performedOn,
      meterReading: input.meterReading ?? null,
      description: input.description?.trim() ?? "",
      workItemId: input.workItemId ?? null,
    })
    .returning();

  // A service usually comes with a fresh reading, and recording it here saves
  // asking for the same number twice.
  if (input.meterReading !== null && input.meterReading !== undefined) {
    await tx.insert(schema.assetMeterReadings).values({
      tenantId: ctx.tenantId,
      assetId,
      readOn: input.performedOn,
      reading: input.meterReading,
      unit: "hours",
    });
  }
  return rows[0];
}

export interface ScheduleStatus {
  schedule: AssetMaintenanceSchedule;
  due: DueResult;
  lastDoneOn: string | null;
  /** The open work item already raised for this service, if there is one. */
  openWorkItemId: string | null;
}

/**
 * Where every schedule on an asset stands, and whether work already exists.
 */
export async function getScheduleStatuses(
  tx: Tx,
  tenantId: string,
  asset: Asset,
  today: string,
): Promise<ScheduleStatus[]> {
  const schedules = await listSchedules(tx, tenantId, asset.id);
  const meter = await latestMeter(tx, tenantId, asset.id);
  const openBySchedule = await openWorkBySchedule(
    tx,
    tenantId,
    schedules.map((s) => s.id),
  );

  const out: ScheduleStatus[] = [];
  for (const schedule of schedules) {
    if (!schedule.isActive) continue;
    const event = await lastEvent(tx, tenantId, schedule.id);
    out.push({
      schedule,
      lastDoneOn: event?.performedOn ?? null,
      openWorkItemId: openBySchedule.get(schedule.id) ?? null,
      due: computeDue({
        spec: {
          kind: isMaintenanceKind(schedule.kind) ? schedule.kind : "calendar",
          intervalMonths: schedule.intervalMonths,
          intervalMeter: schedule.intervalMeter,
        },
        lastDoneOn: event?.performedOn ?? null,
        lastDoneMeter: event?.meterReading ?? null,
        // A calendar schedule never done can still count from the day the
        // asset entered service. A meter one cannot — see computeDue.
        anchorOn: asset.inServiceOn ?? asset.acquiredOn ?? null,
        currentMeter: meter?.reading ?? null,
        today,
      }),
    });
  }
  return out;
}

/** scheduleId → open work item id, for schedules that already have one raised. */
async function openWorkBySchedule(
  tx: Tx,
  tenantId: string,
  scheduleIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of scheduleIds) {
    const rows = await listWorkForEntity(
      tx,
      { tenantId },
      { entityType: SCHEDULE_ENTITY, entityId: id },
    );
    const open = rows.find((r) => r.completedAt === null);
    if (open) out.set(id, open.id);
  }
  return out;
}

export interface RaiseResult {
  raised: { scheduleId: string; workItemId: string }[];
}

/**
 * Raise work for every service that is due and has none outstanding.
 *
 * NO TASK ENGINE HERE. Each becomes an ordinary work item through
 * `createWorkForEntity`, linked to BOTH the asset and the schedule: the asset
 * link is what puts it on the asset's page and in any asset-scoped view, and
 * the schedule link is what makes this idempotent. Without the second link,
 * "has this service already been raised" could not be asked without matching
 * on the title, which is a string comparison pretending to be an identity.
 *
 * A due date is set only for calendar schedules. A meter service falls due at
 * a reading, not on a day, and inventing a date for it would put a fictional
 * deadline on somebody's work list.
 */
export async function raiseDueMaintenance(
  tx: Tx,
  ctx: AssetCtx,
  asset: Asset,
  today: string,
): Promise<RaiseResult> {
  requireWrite(ctx, "owner");
  const statuses = await getScheduleStatuses(tx, ctx.tenantId, asset, today);
  const raised: RaiseResult["raised"] = [];

  for (const status of statuses) {
    if (status.due.status !== "due") continue;
    if (status.openWorkItemId) continue;

    const itemId = await createWorkForEntity(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      { extensionSlug: PACK, entityType: ASSET_ENTITY, entityId: asset.id },
      {
        title: maintenanceWorkTitle(asset.name, status.schedule.name),
        notes: status.schedule.notes,
        dueOn: status.due.dueOn ?? null,
      },
    );
    await attachEntity(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      itemId,
      {
        extensionSlug: PACK,
        entityType: SCHEDULE_ENTITY,
        entityId: status.schedule.id,
      },
    );
    raised.push({ scheduleId: status.schedule.id, workItemId: itemId });
  }
  return { raised };
}

/** Work raised from this asset's maintenance, for the panel to render. */
export async function listMaintenanceWork(
  tx: Tx,
  tenantId: string,
  assetId: string,
) {
  return listWorkForEntity(
    tx,
    { tenantId },
    { entityType: ASSET_ENTITY, entityId: assetId },
  );
}

/**
 * See src/lib/packs/authorize.ts. **Is this a decision, or is it a chore?**
 *
 * Setting up a service schedule is a decision. Recording that the oil was
 * changed, or reading the hour meter, is done by whoever did the work — and if
 * they cannot record it, it is recorded late or not at all.
 */
function requireWrite(ctx: AssetCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new AssetError("FORBIDDEN", "only an owner can change this");
  }
}
