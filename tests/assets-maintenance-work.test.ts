import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { createAsset, type AssetCtx } from "../src/packs/assets/ops";
import {
  createSchedule,
  getScheduleStatuses,
  listMaintenanceWork,
  raiseDueMaintenance,
  recordMeterReading,
  recordService,
} from "../src/packs/assets/maintenance-ops";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * Maintenance raising WORK, not tasks of its own.
 *
 * The property under test is the one extension-model.md §4b states: this pack
 * has no task engine. A due service becomes an ordinary work item through the
 * Layer 0 seam, linked to the asset AND to the schedule — the second link being
 * what makes raising it idempotent without matching on a title string.
 */
d("maintenance raises work", () => {
  const STAMP = `maint-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let assetId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const ctx = (): AssetCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const asset = () =>
    asOwner((tx) =>
      tx.query.assets.findFirst({ where: eq(schema.assets.id, assetId) }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Maintenance",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
    const a = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name: "Tractor",
        acquiredOn: "2026-01-01",
      }),
    );
    assetId = a.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("a never-done schedule with no baseline raises nothing", async () => {
    // The nuisance this avoids: adding a meter schedule to a tractor owned for
    // years must not declare it overdue and raise work on the spot.
    const s = await asOwner((tx) =>
      createSchedule(tx, ctx(), assetId, {
        name: "Oil change",
        kind: "meter",
        intervalMeter: 100,
        meterUnit: "hours",
      }),
    );
    expect(s.kind).toBe("meter");

    const result = await asOwner(async (tx) =>
      raiseDueMaintenance(tx, ctx(), (await asset())!, "2026-08-15"),
    );
    expect(result.raised).toEqual([]);
  });

  it("raises a work item once a reading makes it due", async () => {
    await asOwner((tx) =>
      recordMeterReading(tx, ctx(), assetId, {
        readOn: "2026-08-15",
        reading: 130,
        unit: "hours",
      }),
    );
    const result = await asOwner(async (tx) =>
      raiseDueMaintenance(tx, ctx(), (await asset())!, "2026-08-15"),
    );
    expect(result.raised).toHaveLength(1);

    const work = await asOwner((tx) =>
      listMaintenanceWork(tx, tenantId, assetId),
    );
    expect(work).toHaveLength(1);
    expect(work[0].title).toBe("Oil change — Tractor");
    // A meter service falls due at a READING, not on a day. Inventing a date
    // would put a fictional deadline on somebody's work list.
    expect(work[0].dueOn).toBeNull();
  });

  it("is an ordinary work item, not a private table", async () => {
    const items = await asOwner((tx) =>
      tx
        .select()
        .from(schema.workItems)
        .where(eq(schema.workItems.tenantId, tenantId)),
    );
    expect(items).toHaveLength(1);

    // Linked to BOTH: the asset link puts it on the asset's page, the schedule
    // link is what makes raising it idempotent.
    const links = await asOwner((tx) =>
      tx
        .select()
        .from(schema.workItemLinks)
        .where(eq(schema.workItemLinks.itemId, items[0].id)),
    );
    expect(links.map((l) => l.entityType).sort()).toEqual([
      "asset",
      "maintenance_schedule",
    ]);
    expect(links.every((l) => l.extensionSlug === "assets")).toBe(true);
  });

  it("does not raise a second item while one is outstanding", async () => {
    const again = await asOwner(async (tx) =>
      raiseDueMaintenance(tx, ctx(), (await asset())!, "2026-09-01"),
    );
    expect(again.raised).toEqual([]);

    const work = await asOwner((tx) =>
      listMaintenanceWork(tx, tenantId, assetId),
    );
    expect(work).toHaveLength(1);
  });

  it("recording the service resets the clock", async () => {
    await asOwner(async (tx) => {
      const schedule = await tx.query.assetMaintenanceSchedules.findFirst({
        where: and(
          eq(schema.assetMaintenanceSchedules.tenantId, tenantId),
          eq(schema.assetMaintenanceSchedules.name, "Oil change"),
        ),
      });
      return recordService(tx, ctx(), assetId, {
        scheduleId: schedule?.id,
        performedOn: "2026-08-16",
        meterReading: 130,
        description: "Oil and filter",
      });
    });

    const statuses = await asOwner(async (tx) =>
      getScheduleStatuses(tx, tenantId, (await asset())!, "2026-08-17"),
    );
    expect(statuses).toHaveLength(1);
    // Next due at 130 + 100. Current reading is 130, so 100 to go.
    expect(statuses[0].due.dueAtMeter).toBe(230);
    expect(statuses[0].due.status).toBe("ok");
    expect(statuses[0].lastDoneOn).toBe("2026-08-16");
  });

  it("a calendar schedule counts from the asset's own dates when never done", async () => {
    await asOwner((tx) =>
      createSchedule(tx, ctx(), assetId, {
        name: "Annual service",
        kind: "calendar",
        intervalMonths: 12,
      }),
    );
    const statuses = await asOwner(async (tx) =>
      getScheduleStatuses(tx, tenantId, (await asset())!, "2026-08-17"),
    );
    const annual = statuses.find((s) => s.schedule.name === "Annual service");
    // Acquired 2026-01-01, so due 2027-01-01 — a baseline, not "overdue".
    expect(annual?.due.dueOn).toBe("2027-01-01");
    expect(annual?.due.status).toBe("ok");
  });

  it("refuses a staff member deciding WHEN a machine gets serviced", async () => {
    // Raising the work sets the schedule's clock forward, which is the same
    // kind of act as writing the schedule. See src/lib/packs/authorize.ts.
    await expect(
      asOwner(async (tx) =>
        raiseDueMaintenance(
          tx,
          { tenantId, userId: OWNER, role: "staff" },
          (await asset())!,
          "2026-08-17",
        ),
      ),
    ).rejects.toThrow();
  });

  it("lets a staff member read the hour meter and log the oil change", async () => {
    // The person who actually changed the oil is the person holding the
    // dipstick. Recording what happened is a chore; deciding the interval is
    // not. Settled 2026-08-15.
    const staff = { tenantId, userId: `${STAMP}-hand`, role: "staff" as const };
    await asOwner((tx) =>
      recordMeterReading(tx, staff, assetId, {
        readOn: "2026-09-01",
        reading: 640,
      }),
    );

    const service = await asOwner((tx) =>
      recordService(tx, staff, assetId, {
        performedOn: "2026-09-01",
        description: "Oil and filter",
      }),
    );
    expect(service.description).toBe("Oil and filter");
  });
});
