import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { MAX_PIN_FAILURES } from "../src/modules/time/core/pin";
import {
  clearWorkerPin,
  punchWithPin,
  resetPinLockout,
  setWorkerPin,
} from "../src/modules/time/pin-ops";
import { clockIn } from "../src/modules/time/punch-ops";

/**
 * The shared device's PIN — Time slice 7.
 *
 * **THE LOCKOUT IS WHY THIS FILE IS DB-BACKED.** Counting wrong PINs is a
 * WRITE that has to survive the failure it is counting, and the first draft of
 * `punchWithPin` threw on a wrong PIN — which rolled back the very increment
 * that makes the lockout work. Nothing pure could have caught that: the
 * increment really did run, and `withTenant`'s transaction really did discard
 * it. So the test that matters here is "five wrong PINs actually lock the
 * sixth", asserted through the real transaction.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("shared-device PIN", () => {
  const STAMP = `pin-${process.pid}`;
  const ACTOR = `${STAMP}-actor`;

  let tenantId = "";
  let workerId = "";
  let otherId = "";

  const asStaff = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: ACTOR });

  /**
   * `at` is explicit because a clock-in and a clock-out in the same millisecond
   * round to zero minutes and write NO entry — which is the rounding policy
   * working, and would look like a bug in the kiosk.
   */
  const punch = (
    pin: string,
    opts: { clientRef?: string | null; at?: Date } = {},
  ) =>
    asStaff((tx) =>
      punchWithPin(tx, tenantId, {
        workerId,
        pin,
        clientRef: opts.clientRef ?? null,
        deviceLabel: "Barn door",
        actorClerkUserId: ACTOR,
        at: opts.at ?? new Date(),
        roundingMinutes: 0,
        timezone: "America/New_York",
      }),
    );

  /** Ninety minutes ago, so a stop has something to measure. */
  const ninetyMinutesAgo = () => new Date(Date.now() - 90 * 60 * 1000);

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "PIN Farm", slug: STAMP })
        .returning();
      tenantId = tenant.id;

      const people = await tx
        .insert(schema.parties)
        .values([
          { tenantId, kind: "person" as const, displayName: "Pin Worker" },
          { tenantId, kind: "person" as const, displayName: "No Pin Worker" },
        ])
        .returning({ id: schema.parties.id });

      const workers = await tx
        .insert(schema.timeWorkers)
        .values([
          { tenantId, partyId: people[0].id },
          { tenantId, partyId: people[1].id },
        ])
        .returning({ id: schema.timeWorkers.id });
      workerId = workers[0].id;
      otherId = workers[1].id;
    });
  });

  afterAll(async () => {
    if (!tenantId) return;
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("refuses a PIN anybody would guess first", async () => {
    await expect(
      asStaff((tx) => setWorkerPin(tx, tenantId, { workerId, pin: "1234" })),
    ).rejects.toThrow(/guess/i);
    await expect(
      asStaff((tx) => setWorkerPin(tx, tenantId, { workerId, pin: "0000" })),
    ).rejects.toThrow(/guess/i);
  });

  it("refuses something that is not digits", async () => {
    await expect(
      asStaff((tx) => setWorkerPin(tx, tenantId, { workerId, pin: "abcd" })),
    ).rejects.toThrow(/4 to 8 digits/i);
  });

  it("stores a hash and never the PIN", async () => {
    await asStaff((tx) => setWorkerPin(tx, tenantId, { workerId, pin: "4821" }));
    const row = await asStaff((tx) =>
      tx.query.timeWorkers.findFirst({
        where: eq(schema.timeWorkers.id, workerId),
      }),
    );
    expect(row?.pinHash).toBeTruthy();
    expect(row!.pinHash).not.toContain("4821");
    // salt.hash, the dot-joined convention every secret at rest here uses.
    expect(row!.pinHash!.split(".")).toHaveLength(2);
  });

  it("says the same thing for a worker who has no PIN at all", async () => {
    const result = await withTenant(
      tenantId,
      (tx) =>
        punchWithPin(tx, tenantId, {
          workerId: otherId,
          pin: "4821",
          clientRef: null,
          deviceLabel: "",
          actorClerkUserId: ACTOR,
          at: new Date(),
          roundingMinutes: 0,
          timezone: "America/New_York",
        }),
      { role: "staff", userId: ACTOR },
    );
    // Not "that person has no PIN", which would tell somebody standing at the
    // tablet which names are worth guessing at.
    expect(result.kind).toBe("wrong");
  });

  it("COUNTS A WRONG PIN, which means the count has to commit", async () => {
    const before = await punch("9999");
    expect(before.kind).toBe("wrong");
    const row = await asStaff((tx) =>
      tx.query.timeWorkers.findFirst({
        where: eq(schema.timeWorkers.id, workerId),
      }),
    );
    // The whole point. A throw here would have rolled this back to 0.
    expect(row?.pinFailedCount).toBe(1);
    expect(row?.pinFailedAt).not.toBeNull();
  });

  it("locks out after the cap and says how long", async () => {
    for (let i = 1; i < MAX_PIN_FAILURES; i += 1) {
      expect((await punch("9999")).kind).toBe("wrong");
    }
    const locked = await punch("4821"); // the RIGHT PIN, and still refused
    expect(locked.kind).toBe("locked");
    if (locked.kind === "locked") {
      expect(locked.remaining).toMatch(/minute/);
    }
  });

  it("lets an owner open it again without changing the PIN", async () => {
    await asStaff((tx) => resetPinLockout(tx, tenantId, workerId));
    const result = await punch("4821", { at: ninetyMinutesAgo() });
    expect(result.kind).toBe("clocked_in");
  });

  it("clears the count on a right PIN, so a forgetful week does not add up", async () => {
    const row = await asStaff((tx) =>
      tx.query.timeWorkers.findFirst({
        where: eq(schema.timeWorkers.id, workerId),
      }),
    );
    expect(row?.pinFailedCount).toBe(0);
    expect(row?.pinFailedAt).toBeNull();
  });

  it("is ONE button: the same PIN that clocked in clocks out", async () => {
    const out = await punch("4821");
    expect(out.kind).toBe("clocked_out");
    if (out.kind === "clocked_out") {
      expect(out.workerName).toBe("Pin Worker");
      // Ninety minutes, and no rounding set, so it is paid exactly.
      expect(out.out.paidMinutes).toBe(90);
    }
  });

  it("marks the entry as coming from a kiosk, not a timer", async () => {
    const entries = await asStaff((tx) =>
      tx.query.timeEntries.findMany({
        where: eq(schema.timeEntries.workerId, workerId),
      }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.source === "kiosk")).toBe(true);
  });

  it("stamps the punch with what the device calls itself", async () => {
    const punches = await asStaff((tx) =>
      tx.query.timePunches.findMany({
        where: eq(schema.timePunches.workerId, workerId),
      }),
    );
    expect(punches.some((p) => p.deviceLabel === "Barn door")).toBe(true);
  });

  it("A RETRY WITH THE SAME CLIENT ID IS A NO-OP, not a second punch", async () => {
    const ref = `${STAMP}-retry-0001`;
    const first = await punch("4821", { clientRef: ref });
    expect(first.kind).toBe("clocked_in");

    // The same id again, exactly as a device with no signal would send it.
    // Without the read-first check this trips the one-open-punch index and
    // tells an honest person they are already clocked in.
    const again = await asStaff((tx) =>
      clockIn(tx, tenantId, {
        workerId,
        note: "",
        actorClerkUserId: ACTOR,
        at: new Date(),
        clientRef: ref,
      }),
    );
    const punches = await asStaff((tx) =>
      tx.query.timePunches.findMany({
        where: eq(schema.timePunches.clientRef, ref),
      }),
    );
    expect(punches).toHaveLength(1);
    expect(again).toBe(punches[0].id);
  });

  it("stops answering once the PIN is taken away", async () => {
    await asStaff((tx) => clearWorkerPin(tx, tenantId, workerId));
    expect((await punch("4821")).kind).toBe("wrong");
  });
});
