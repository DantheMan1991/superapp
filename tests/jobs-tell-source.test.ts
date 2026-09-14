import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { jobsTellSource } from "../src/packs/jobs/tell/source";
import { createProject, type JobsCtx } from "../src/packs/jobs/ops";
import { listDailyLogs, listPunchItems } from "../src/packs/jobs/field-ops";
import type { TellAction, TellCtx } from "../src/lib/tell-sources/types";

/**
 * "Poured the garage slab at Oak Row, four guys, six hours" — the jobs pack's
 * tell source, and the first thing somebody on a site touches.
 *
 * The properties worth a database: nothing is OFFERED until there is a job to
 * log against; a sentence lands on the day that exists rather than making a
 * second one; and a punch item is a WORK item linked to the project, not a
 * row of this pack's own.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("telling a job what happened on site", () => {
  const STAMP = `tell-jobs-${process.pid}-${Date.now()}`;
  const USER = `${STAMP}-user`;
  let tenantId = "";
  let entityId = "";
  let projectId = "";

  const ctx = (): TellCtx => ({
    tenantId,
    userId: USER,
    role: "staff",
    now: new Date("2026-09-14T14:00:00.000Z"),
    timezone: "America/New_York",
    industry: "construction",
    today: "2026-09-14",
  });
  const jobsCtx = (): JobsCtx => ({ tenantId, userId: USER, role: "owner" });

  const asStaff = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: USER });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: USER });

  const actions = () => asStaff((tx) => jobsTellSource.actions(tx, ctx()));
  const record = (action: TellAction, values: Record<string, string | number | null>) =>
    asStaff((tx) => action.record(tx, ctx(), values));

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `org_${STAMP}`, name: `Tell Jobs ${STAMP}`, slug: STAMP, industry: "construction" })
        .returning();
      tenantId = tenant.id;
      const [entity] = await tx
        .insert(schema.entities)
        .values({ tenantId, name: "Builders LLC", isDefault: true })
        .returning();
      entityId = entity.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [tenantId])));
  });

  it("offers nothing until there is a job to log against", async () => {
    expect(await actions()).toEqual([]);
  });

  it("offers a log and a punch item once a job is open, and only the punch item records itself", async () => {
    await asOwner(async (tx) => {
      const p = await createProject(tx, jobsCtx(), {
        entityId,
        number: "24-108",
        name: "Oak Row residence",
        address: "118 Oak Row",
        status: "active",
      });
      projectId = p.id;
      // A finished job is not something anybody is standing on.
      await createProject(tx, jobsCtx(), {
        entityId,
        number: "23-001",
        name: "Finished house",
        status: "complete",
      });
    });
    const offered = await actions();
    expect(offered.map((a) => a.slug).sort()).toEqual(["jobs.log", "jobs.punch"]);
    const log = offered.find((a) => a.slug === "jobs.log")!;
    const punch = offered.find((a) => a.slug === "jobs.punch")!;
    expect(log.unattended).toBeFalsy(); // a line on the wrong job is not visible to this person
    expect(punch.unattended).toBe(true); // on a list, one press to remove, moves nothing
    // The job is SEARCHED, not listed — and the finished one is not there.
    const field = log.fields.find((f) => f.key === "project")!;
    expect(field.choices).toBeUndefined();
    const found = await asStaff((tx) => field.find!(tx, ctx(), "at Oak Row"));
    expect(found.map((c) => c.value)).toEqual([projectId]);
    expect(found[0].detail).toContain("24-108");
    const all = await asStaff((tx) => field.find!(tx, ctx(), "somewhere nobody knows"));
    expect(all.map((c) => c.value)).toEqual([projectId]);
  });

  it("logs a day — and a second sentence lands on the SAME day, with its crew", async () => {
    const log = (await actions()).find((a) => a.slug === "jobs.log")!;
    const first = await record(log, {
      project: projectId,
      notes: "Poured the garage slab",
      trade: "concrete",
      workers: 4,
      hours: 6,
      date: "2026-09-14",
    });
    expect(first.summary).toContain("Oak Row residence: Poured the garage slab");
    expect(first.summary).toContain("concrete 4 × 6h");
    const second = await record(log, {
      project: projectId,
      notes: "Framers started the second floor",
      weather: "Clear, 78",
      date: "2026-09-14",
    });
    expect(second.summary).toContain("Framers started");

    const days = await asStaff((tx) => listDailyLogs(tx, tenantId, projectId));
    expect(days).toHaveLength(1);
    expect(days[0].log.notes).toBe("Poured the garage slab\nFramers started the second floor");
    expect(days[0].log.weather).toBe("Clear, 78");
    expect(days[0].crews.map((c) => [c.trade, c.workers, c.hoursTenths])).toEqual([["concrete", 4, 60]]);
    expect(days[0].manHoursTenths).toBe(240);
  });

  it("refuses a log with no job or nothing said, in words", async () => {
    const log = (await actions()).find((a) => a.slug === "jobs.log")!;
    await expect(record(log, { project: null, notes: "x" })).rejects.toMatchObject({ name: "TellRefusal" });
    await expect(record(log, { project: projectId, notes: "" })).rejects.toMatchObject({ name: "TellRefusal" });
  });

  it("a punch item is a work item linked to the job", async () => {
    const punch = (await actions()).find((a) => a.slug === "jobs.punch")!;
    const out = await record(punch, {
      project: projectId,
      title: "Touch up paint in master bath",
      due: "2026-09-20",
    });
    expect(out.summary).toBe("Oak Row residence: Touch up paint in master bath — due 2026-09-20");
    const items = await asStaff((tx) => listPunchItems(tx, tenantId, projectId));
    expect(items.map((i) => [i.title, i.dueOn, i.completedAt])).toEqual([
      ["Touch up paint in master bath", "2026-09-20", null],
    ]);
    expect(items[0].links).toEqual([{ entityType: "project", entityId: projectId }]);
    // And it is an ordinary work item, in Work's own table.
    const rows = await asStaff((tx) =>
      tx.select({ id: schema.workItems.id }).from(schema.workItems).where(eq(schema.workItems.id, items[0].id)),
    );
    expect(rows).toHaveLength(1);
  });
});
