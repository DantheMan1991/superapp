import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { FitnessError } from "../src/modules/fitness/core/errors";
import type { ProgramInput } from "../src/modules/fitness/core/program";
import { beginSession, finishSession, recordSet } from "../src/modules/fitness/core/session";
import { loadProgram, saveProgram, sessionPlan } from "../src/modules/fitness/program-ops";
import { saveSession } from "../src/modules/fitness/session-ops";
import {
  deletePostureCheck,
  getPostureCheck,
  listPostureChecks,
  postureCheckDays,
  savePostureCheck,
} from "../src/modules/fitness/posture/check-ops";
import { postureCheckDocSchema, toCheckDoc, type PostureCheckDoc } from "../src/modules/fitness/posture/core/check-doc";
import { summarize } from "../src/modules/fitness/posture/core/history";
import { markLabels } from "../src/modules/fitness/posture/core/marks";
import type { ViewCapture } from "../src/modules/fitness/posture/core/measures";
import { marksOfPrograms } from "../src/modules/fitness/posture/marks-ops";

/**
 * POSTURE CHECKS IN THE ACCOUNT, against a real database (docs/modules/
 * posture.md, slice 3; ADR 0120): a check kept once however often the phone
 * sends it, a phone clock that runs fast or a date ahead of today, the list
 * newest first, and a delete. And a workout program's posture marks, read
 * from real workouts and checks (3c). RLS between two spaces is
 * tests/isolation/posture.test.ts.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `posture-ops-${process.pid}`;

let tenant: string;
let other: string;

function inTenant<T>(id: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(id, fn, { role: "owner" });
}

const FRONT: ViewCapture = {
  view: "front",
  round: 1,
  up: { x: 0, y: -1 },
  upFrom: "plumb",
  pxPerMetre: 900,
  width: 1080,
  height: 1920,
  stickers: { "right-shoulder": { x: 400, y: 505 }, "left-shoulder": { x: 680, y: 500 } },
  pose: null,
  frames: 12,
  stillPx: 0.8,
};

function aCheck(at: string, over: Partial<PostureCheckDoc> = {}): PostureCheckDoc {
  return postureCheckDocSchema.parse({
    ...toCheckDoc({ id: randomUUID(), at, captures: [FRONT, { ...FRONT, round: 2 }], notes: ["No plumb line."] }),
    ...over,
  });
}

d("posture checks in the account", () => {
  beforeAll(async () => {
    const made = await withSystem(async (tx) =>
      tx
        .insert(schema.tenants)
        .values(
          ["a", "b"].map((x) => ({
            clerkOrgId: `${STAMP}-${x}`,
            name: "Personal",
            slug: `${STAMP}-${x}`,
            kind: "personal" as const,
            personalOwnerClerkUserId: `user_postureops${x}${process.pid}`,
          })),
        )
        .returning({ id: schema.tenants.id }),
    );
    [tenant, other] = made.map((r) => r.id);
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [tenant, other])));
  });

  it("keeps a check once, however often the phone sends it", async () => {
    const doc = aCheck("2026-09-01T07:00:00.000Z");
    expect(await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, doc))).toEqual({ created: true });
    expect(await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, doc))).toEqual({ created: false });
    const rows = await withSystem((tx) =>
      tx.select().from(schema.fitnessPostureChecks).where(eq(schema.fitnessPostureChecks.id, doc.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenant);
    expect(rows[0].notes).toEqual(["No plumb line."]);
    const back = await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, doc.id));
    // What comes back reads exactly as what was sent.
    expect(summarize(back!)).toEqual(summarize({ id: doc.id, takenAt: doc.takenAt, localDay: doc.localDay, captures: doc.captures as ViewCapture[] }));
    expect(back!.captures[0].stillPx).toBe(0.8);
  });

  it("will not take another space's check id, even sent from here", async () => {
    const doc = aCheck("2026-09-02T07:00:00.000Z");
    await inTenant(other, (tx) => savePostureCheck(tx, other, doc));
    await expect(inTenant(tenant, (tx) => savePostureCheck(tx, tenant, doc))).rejects.toBeInstanceOf(FitnessError);
    const mine = await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, doc.id));
    expect(mine).toBeNull();
  });

  it("believes a phone's clock backwards, and only two minutes forwards", async () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const ahead = aCheck("2026-10-03T13:00:00.000Z", { localDay: "2026-10-03" });
    await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, ahead, now));
    const kept = await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, ahead.id));
    expect(kept!.takenAt).toBe(now.toISOString());
    const future = aCheck("2026-10-03T11:00:00.000Z", { localDay: "2026-10-09" });
    await expect(inTenant(tenant, (tx) => savePostureCheck(tx, tenant, future, now))).rejects.toThrow(/date is ahead/);
  });

  it("lists the space's own checks, newest first", async () => {
    const list = await inTenant(tenant, (tx) => listPostureChecks(tx, tenant));
    expect(list.map((c) => c.takenAt)).toEqual([...list.map((c) => c.takenAt)].sort().reverse());
    expect(list.length).toBeGreaterThanOrEqual(2);
    const theirs = await inTenant(other, (tx) => listPostureChecks(tx, other));
    expect(theirs.every((c) => !list.some((m) => m.id === c.id))).toBe(true);
  });

  it("deletes a check, and deleting one that is not there is no error", async () => {
    const doc = aCheck("2026-09-04T07:00:00.000Z");
    await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, doc));
    expect(await inTenant(tenant, (tx) => deletePostureCheck(tx, tenant, doc.id))).toEqual({ deleted: true });
    expect(await inTenant(tenant, (tx) => deletePostureCheck(tx, tenant, doc.id))).toEqual({ deleted: false });
    expect(await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, doc.id))).toBeNull();
  });

  it("keeps a repeat pointing at the check it repeats, and lets go when that one is deleted (3b)", async () => {
    const first = aCheck("2026-09-05T07:00:00.000Z");
    const again = aCheck("2026-09-05T07:25:00.000Z", { repeatOf: first.id });
    await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, first));
    await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, again));
    expect((await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, again.id)))!.repeatOf).toBe(first.id);
    // The column-list SET NULL (0436): only repeat_of goes, the repeat stays.
    await inTenant(tenant, (tx) => deletePostureCheck(tx, tenant, first.id));
    const left = await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, again.id));
    expect(left).not.toBeNull();
    expect(left!.repeatOf).toBeNull();
  });

  it("keeps a repeat of a check it cannot find as an ordinary check", async () => {
    const theirs = aCheck("2026-09-06T07:00:00.000Z");
    await inTenant(other, (tx) => savePostureCheck(tx, other, theirs));
    for (const repeatOf of [randomUUID(), theirs.id]) {
      const doc = aCheck("2026-09-06T07:30:00.000Z", { repeatOf });
      await inTenant(tenant, (tx) => savePostureCheck(tx, tenant, doc));
      expect((await inTenant(tenant, (tx) => getPostureCheck(tx, tenant, doc.id)))!.repeatOf).toBeNull();
    }
  });
});

d("a workout program's posture marks (3c)", () => {
  // A space of its own: the checks above would land in these windows.
  let space: string;

  beforeAll(async () => {
    const [made] = await withSystem(async (tx) =>
      tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-marks`,
          name: "Personal",
          slug: `${STAMP}-marks`,
          kind: "personal" as const,
          personalOwnerClerkUserId: `user_posturemarks${process.pid}`,
        })
        .returning({ id: schema.tenants.id }),
    );
    space = made.id;
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, space)));
  });

  /** One exercise, one set of it: each workout is a done day. */
  const exercise = (name: string) => ({
    itemId: null,
    exerciseId: null,
    name,
    purpose: "",
    cues: [],
    unit: "reps" as const,
    videos: [],
    setsMin: 1,
    setsMax: null,
    targetMin: 8,
    targetMax: null,
    perSide: false,
    optional: false,
    notes: "",
    sideRule: "both" as const,
    sideMeans: "side" as const,
    progression: null,
  });

  it("labels the checks that marked the start and a phase's end, from real workouts, and asks for the one due", async () => {
    const input: ProgramInput = {
      name: "Starter Mobility",
      author: "A. Coach",
      notes: "",
      sessionsPerWeekMin: null,
      sessionsPerWeekMax: null,
      effortMin: null,
      effortMax: null,
      breathOutS: null,
      breathInS: null,
      assessment: null,
      phases: [
        { phaseId: null, name: "Phase 1", minDoneDays: 2, notes: "", items: [exercise("Hip lift")] },
        { phaseId: null, name: "Phase 2", minDoneDays: 2, notes: "", items: [exercise("Wall stack")] },
      ],
    };
    const saved = await inTenant(space, (tx) => saveProgram(tx, space, input, { programId: null, source: "own" }));
    const program = (await inTenant(space, (tx) => loadProgram(tx, space, saved.programId)))!;
    const plan = sessionPlan(program, 0);
    // Phase 1 done on the 10th and the 12th: its gate opens on the 12th.
    for (const day of [10, 12]) {
      const when = new Date(2026, 8, day, 10);
      let doc = beginSession(plan, { id: randomUUID(), now: when, feelBefore: null });
      doc = recordSet(plan, doc, { itemIndex: 0, count: 8, setId: randomUUID(), exerciseId: randomUUID(), now: when });
      const finished = finishSession(doc, { feelAfter: null, now: when });
      await inTenant(space, (tx) => saveSession(tx, space, finished));
    }
    const start = aCheck(new Date(2026, 8, 9, 9).toISOString());
    await inTenant(space, (tx) => savePostureCheck(tx, space, start));
    const read = () => inTenant(space, async (tx) => marksOfPrograms(tx, space, await postureCheckDays(tx, space), "2026-09-20"));
    const started = { label: "Start of Starter Mobility", full: "Start of Starter Mobility" };

    const before = await read();
    expect(markLabels(before.marks)).toEqual({ [start.id]: [started] });
    expect(before.due).toMatchObject({ kind: "end", phaseName: "Phase 1", day: "2026-09-12", movedOn: null });

    // The end, and a repeat of it: the repeat marks nothing.
    const end = aCheck(new Date(2026, 8, 13, 9).toISOString());
    const again = aCheck(new Date(2026, 8, 13, 9, 30).toISOString(), { repeatOf: end.id });
    for (const doc of [end, again]) await inTenant(space, (tx) => savePostureCheck(tx, space, doc));
    const days = await inTenant(space, (tx) => postureCheckDays(tx, space));
    expect(days.map((c) => [c.id, c.repeatOf])).toEqual([
      [start.id, null],
      [end.id, null],
      [again.id, end.id],
    ]);

    const after = await read();
    expect(markLabels(after.marks)).toEqual({
      [start.id]: [started],
      [end.id]: [{ label: "End of Phase 1", full: "End of Phase 1, in Starter Mobility" }],
    });
    expect(after.due).toBeNull();
  });
});
