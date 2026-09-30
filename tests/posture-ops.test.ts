import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { FitnessError } from "../src/modules/fitness/core/errors";
import { deletePostureCheck, getPostureCheck, listPostureChecks, savePostureCheck } from "../src/modules/fitness/posture/check-ops";
import { postureCheckDocSchema, toCheckDoc, type PostureCheckDoc } from "../src/modules/fitness/posture/core/check-doc";
import { summarize } from "../src/modules/fitness/posture/core/history";
import type { ViewCapture } from "../src/modules/fitness/posture/core/measures";

/**
 * POSTURE CHECKS IN THE ACCOUNT, against a real database (docs/modules/
 * posture.md, slice 3; ADR 0120): a check kept once however often the phone
 * sends it, a phone clock that runs fast or a date ahead of today, the list
 * newest first, and a delete. RLS between two spaces is
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
});
