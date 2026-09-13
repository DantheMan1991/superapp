import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { workTellSource } from "../src/modules/work/tell/source";
import { createUnlinkedWork, listOpenWork } from "../src/lib/work/entity-work";
import type { TellAction, TellCtx } from "../src/lib/tell-sources/types";

/**
 * "Add a job to fix the top gate" — Work's tell source.
 *
 * The property worth a database behind it is the one about OFFERING: ticking a
 * job off is only an action at all when there is a job to tick, and that is a
 * question about this tenant's rows rather than about the code. A tenant with
 * an empty list who is shown "Job finished" gets a card the model can fill and
 * nothing can resolve.
 *
 * The other one is that the two actions are NOT the same kind of safe, which
 * is the first time ADR 0050's rule discriminates inside a single source.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("telling work what needs doing", () => {
  const STAMP = `tell-work-${process.pid}-${Date.now()}`;
  const USER = `${STAMP}-user`;

  let tenantId = "";

  const ctx = (): TellCtx => ({
    tenantId,
    userId: USER,
    role: "staff",
    now: new Date("2026-09-12T14:00:00.000Z"),
    timezone: "America/New_York",
    industry: "homestead-farm",
    today: "2026-09-12",
  });

  const scoped = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: USER });

  const actions = () => scoped((tx) => workTellSource.actions(tx, ctx()));

  const run = (
    action: TellAction,
    values: Record<string, string | number | null>,
  ) => scoped((tx) => action.record(tx, ctx(), values));

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Tell Work ${STAMP}`,
          slug: STAMP,
          timezone: "America/New_York",
        })
        .returning();
      tenantId = tenant.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("offers only adding, while there is nothing on the list to finish", async () => {
    // An action whose every choice is empty is one the model can pick and then
    // fail to fill, costing a readback that could never have gone anywhere.
    expect((await actions()).map((a) => a.slug)).toEqual(["work.add"]);
  });

  it("adds a job, and records itself because a wrong one is harmless", async () => {
    const [add] = await actions();
    expect(add.unattended).toBe(true);

    const result = await run(add, {
      title: "Fix the top gate",
      due: "2026-09-18",
      notes: "",
    });
    expect(result.summary).toBe("Fix the top gate — due 2026-09-18");

    const open = await scoped((tx) =>
      listOpenWork(tx, { tenantId }),
    );
    expect(open.map((w) => w.title)).toContain("Fix the top gate");
    expect(open.find((w) => w.title === "Fix the top gate")?.dueOn).toBe(
      "2026-09-18",
    );
  });

  it("leaves the date alone when the sentence gave none", async () => {
    // Explicitly NOT `defaultToday`. A job with no date is normal, and filling
    // one in invents an urgency nobody asked for.
    const [add] = await actions();
    const result = await run(add, { title: "Order feed bags", due: null, notes: "" });
    expect(result.summary).toBe("Order feed bags");

    const open = await scoped((tx) =>
      listOpenWork(tx, { tenantId }),
    );
    expect(open.find((w) => w.title === "Order feed bags")?.dueOn).toBeNull();
  });

  it("refuses a job that does not say what it is", async () => {
    const [add] = await actions();
    await expect(run(add, { title: "  ", due: null, notes: "" })).rejects.toThrow(
      "a job needs saying what it is",
    );
  });

  /**
   * **THE JOBS ARE SEARCHED, NOT LISTED** (tell.md, slice A3).
   *
   * This asserted the opposite until the menu was removed: every open job used
   * to be written into the model's prompt, which ADR 0052 forbids for a list
   * that can pass a few dozen — and a to-do list is the list in this product
   * most certain to. So there is deliberately no list here to assert, and what
   * is checked instead is that the words somebody would actually SAY reach the
   * job they mean.
   */
  it("offers finishing once something is on the list, and finds it by its words", async () => {
    const list = await actions();
    expect(list.map((a) => a.slug)).toEqual(["work.add", "work.done"]);

    const done = list.find((a) => a.slug === "work.done")!;
    const which = done.fields[0];
    expect(which.choices).toBeUndefined();
    expect(typeof which.find).toBe("function");

    const found = async (said: string) =>
      (await scoped((tx) => which.find!(tx, ctx(), said))).map((c) => c.label);

    // The title, contained in a sentence that is not the title.
    expect(await found("the top gate is fixed")).toContain("Fix the top gate");
    // A word in common, which is how people actually refer to a job.
    expect(await found("sorted the gate")).toContain("Fix the top gate");
    // Nothing matched is a question, never a dead end (ADR 0052).
    expect((await found("something else entirely")).length).toBeGreaterThan(0);
  });

  /** The first time ADR 0050's rule discriminates INSIDE one source. */
  it("does NOT record finishing unasked, because a ticked job leaves the list", async () => {
    const done = (await actions()).find((a) => a.slug === "work.done")!;
    expect(done.unattended).toBeUndefined();
  });

  it("ticks the job it was given, and only that one", async () => {
    const before = await scoped((tx) =>
      listOpenWork(tx, { tenantId }),
    );
    const gate = before.find((w) => w.title === "Fix the top gate")!;

    const done = (await actions()).find((a) => a.slug === "work.done")!;
    const result = await run(done, { item: gate.id });
    expect(result.summary).toBe("Fix the top gate — done");

    const after = await scoped((tx) =>
      listOpenWork(tx, { tenantId }),
    );
    expect(after.map((w) => w.title)).not.toContain("Fix the top gate");
    // The other job is untouched — ticking is not a sweep.
    expect(after.map((w) => w.title)).toContain("Order feed bags");
  });

  it("stops offering to finish once the list is empty again", async () => {
    const open = await scoped((tx) =>
      listOpenWork(tx, { tenantId }),
    );
    const done = (await actions()).find((a) => a.slug === "work.done")!;
    for (const row of open) {
      await run(done, { item: row.id });
    }
    expect((await actions()).map((a) => a.slug)).toEqual(["work.add"]);
  });

  it("refuses to finish without being told which", async () => {
    // Reached only through a card somebody emptied by hand; the choice is
    // required, so the box would not offer the button. Belt and braces.
    await scoped((tx) =>
      createUnlinkedWork(tx, { tenantId, userId: USER }, { title: "Something" }),
    );
    const done = (await actions()).find((a) => a.slug === "work.done")!;
    await expect(run(done, { item: null })).rejects.toThrow(
      "say which job is finished",
    );
  });
});
