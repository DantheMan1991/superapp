import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { setBooksStartOn, getDefaultEntityId } from "../src/modules/accounting/core";
import {
  buildDigest,
  currentInterview,
  runTurn,
  startInterview,
  type SetupCtx,
} from "../src/lib/setup-interview/session";
import { SETUP_EXCHANGE_CAP } from "../src/lib/setup-interview/prompt";

/**
 * The setup interview against the database (ADR 0040), with the model
 * replaced by functions that answer what a test says.
 *
 * What this file certifies: the digest is built from the tenant's own rows,
 * so the interview knows what exists before it asks; starting twice returns
 * the same conversation; a turn appends both halves and keeps counting; the
 * plan is written on the turn the model says it has enough, not on a second
 * press; and the cap ends it even when the model would keep going.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("the setup interview", () => {
  const STAMP = `setupiv-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;

  const ctx = (): SetupCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const tenant = { name: "Hilltop Farm", industry: "homestead-farm" };
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  /** A model that keeps asking, and one that writes a plan when asked. */
  const turnModel = (done: boolean) => async () => ({
    reply: done ? "That's everything I need." : "And when should the books begin?",
    done,
  });
  /**
   * The per-session cooldown is real and is measured in seconds, so a test
   * that answers instantly trips it where a person thinking would not. Clear
   * it rather than sleep — what is under test is the conversation, not the
   * clock, and the clock has its own guard in `gatherTurn`.
   */
  const noCooldown = () =>
    asOwner((tx) =>
      tx
        .update(schema.setupInterviews)
        .set({ lastTurnAt: null })
        .where(eq(schema.setupInterviews.tenantId, tenantId)),
    );

  const planModel = async () => ({
    summary: "Your money is mixed with personal, and your books start in January.",
    steps: [
      { title: "Set the day your books begin", why: "Everything hangs off it.", screen: "Opening position" },
      { title: "Ask your accountant for the depreciation figure", why: "They hold it." },
    ],
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: tenant.name, slug: STAMP, industry: tenant.industry })
        .returning();
      tenantId = t.id;
      await tx
        .insert(schema.tenantModules)
        .values([{ tenantId, moduleId: "accounting", enabled: true }])
        .onConflictDoNothing();
    });
    await asOwner(async (tx) => {
      await provisionAccounting(tx, tenantId);
      await createBankAccount(tx, ctx(), { name: "Farm Checking", kind: "checking" });
      await createBankAccount(tx, ctx(), { name: "Chase personal", kind: "personal" });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("builds the digest from the tenant's own rows", async () => {
    const digest = await asOwner((tx) =>
      buildDigest(tx, ctx(), tenant, ["accounting"]),
    );
    expect(digest).toMatchObject({
      businessName: "Hilltop Farm",
      industry: "homestead-farm",
      modules: ["accounting"],
      booksStartOn: null,
      registers: { total: 2, personal: 1 },
    });
    // It knows what the Getting set up card is asking for, so it does not ask.
    expect(digest.outstanding.map((s) => s.title)).toContain("Say when your books begin");

    // And it moves with the business.
    await asOwner(async (tx) => {
      const entityId = await getDefaultEntityId(tx, tenantId);
      await setBooksStartOn(tx, ctx(), { entityId, date: "2026-01-01" });
    });
    const after = await asOwner((tx) => buildDigest(tx, ctx(), tenant, ["accounting"]));
    expect(after.booksStartOn).toBe("2026-01-01");
    expect(after.outstanding.map((s) => s.title)).not.toContain("Say when your books begin");
  });

  it("starts once, and starting again returns the same conversation", async () => {
    const first = await asOwner((tx) => startInterview(tx, ctx()));
    expect(first.state).toBe("active");
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].role).toBe("assistant");
    // The opener asks the question the plan says changes everything.
    expect(first.messages[0].content).toMatch(/mixed with your personal/i);

    const again = await asOwner((tx) => startInterview(tx, ctx()));
    expect(again.id).toBe(first.id);
  });

  it("a turn keeps both halves of the exchange and goes on counting", async () => {
    await noCooldown();
    const view = await runTurn(ctx(), tenant, "It's all mixed with personal.", {
      turn: turnModel(false),
      plan: planModel,
    });
    expect(view.state).toBe("active");
    expect(view.exchangeCount).toBe(1);
    expect(view.messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect(view.messages[1].content).toBe("It's all mixed with personal.");
    expect(view.plan).toBeNull();
  });

  it("writes the plan on the turn it has enough, resolving each screen", async () => {
    await noCooldown();
    const view = await runTurn(ctx(), tenant, "January the first.", {
      turn: turnModel(true),
      plan: planModel,
    });
    expect(view.state).toBe("done");
    expect(view.plan?.summary).toMatch(/mixed with personal/);
    expect(view.plan?.steps[0]).toMatchObject({
      href: "/dashboard/m/accounting/opening",
      screen: "Opening position",
    });
    // A step done away from the app carries no link.
    expect(view.plan?.steps[1]).toMatchObject({ href: null, screen: null });

    // It is the current one, and it is finished.
    const current = await asOwner((tx) => currentInterview(tx, tenantId));
    expect(current).toMatchObject({ id: view.id, state: "done" });

    // A finished one takes no more turns.
    await noCooldown();
    await expect(
      runTurn(ctx(), tenant, "one more thing", { turn: turnModel(false), plan: planModel }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the cap ends it even when the model would keep going", async () => {
    // A fresh one, since the last is finished.
    const fresh = await asOwner((tx) => startInterview(tx, ctx()));
    expect(fresh.state).toBe("active");

    let last = fresh;
    for (let i = 0; i < SETUP_EXCHANGE_CAP; i++) {
      await noCooldown();
      last = await runTurn(ctx(), tenant, `answer ${i}`, {
        turn: turnModel(false),
        plan: planModel,
      });
    }
    expect(last.exchangeCount).toBe(SETUP_EXCHANGE_CAP);
    expect(last.state).toBe("done");
    // And it still got the thing it came for.
    expect(last.plan?.steps.length).toBe(2);
  });
});
