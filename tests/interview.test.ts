import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { withSystem, schema } from "../src/db";
import {
  hashInterviewIp,
  promoteSession,
  runInterviewTurn,
  startInterviewSession,
} from "../src/lib/interview";
import {
  INTERVIEW_DAILY_IP_CAP,
  INTERVIEW_EXCHANGE_CAP,
  INTERVIEW_OPENER,
} from "../src/lib/interview-prompt";

/**
 * Health-check interview engine: caps, cooldown claims, turn persistence,
 * and the promotion into the prospect + audits pipeline. All model calls
 * are injected fakes. Needs DATABASE_URL (dev DB).
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP = `interview-test-${process.pid}`;
process.env.INTERVIEW_IP_SALT ??= "test-salt";

const fakeTurn =
  (reply: string, done = false) =>
  async () => ({ reply, topicsCovered: ["business_basics"], done });

async function cleanup() {
  await withSystem(async (tx) => {
    await tx
      .delete(schema.interviewSessions)
      .where(like(schema.interviewSessions.ipHash, `${STAMP}%`));
    // Promotion-created tenants (cascade removes their audits).
    await tx.execute(
      sql`delete from tenants where slug like ${`${STAMP.toLowerCase()}%`}`,
    );
  });
}

d("interview engine", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("start seeds the opener; per-IP daily cap rejects the 4th start", async () => {
    const ipHash = `${STAMP}-caps`;
    for (let i = 0; i < INTERVIEW_DAILY_IP_CAP; i++) {
      const res = await startInterviewSession(ipHash);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.messages[0].content).toBe(INTERVIEW_OPENER);
      }
    }
    const fourth = await startInterviewSession(ipHash);
    expect(fourth).toEqual({ ok: false, code: "ip_capped" });
  });

  it("a full turn appends both messages and counts the exchange", async () => {
    const start = await startInterviewSession(`${STAMP}-turn`);
    if (!start.ok) throw new Error("start failed");

    const res = await runInterviewTurn(
      start.sessionId,
      "We build custom decks, 4 guys.",
      fakeTurn("Nice — who handles scheduling the jobs?"),
    );
    expect(res).toMatchObject({ ok: true, done: false, exchangeCount: 1 });

    const session = await withSystem((tx) =>
      tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, start.sessionId),
      }),
    );
    expect((session!.messages as unknown[]).length).toBe(3); // opener + user + assistant
    expect(session!.state).toBe("active");
  });

  it("turn cooldown claim rejects an immediate second turn", async () => {
    const start = await startInterviewSession(`${STAMP}-cool`);
    if (!start.ok) throw new Error("start failed");

    const first = await runInterviewTurn(
      start.sessionId,
      "hello",
      fakeTurn("First question?"),
    );
    expect(first.ok).toBe(true);

    const second = await runInterviewTurn(
      start.sessionId,
      "again",
      fakeTurn("Should not run"),
    );
    expect(second).toEqual({ ok: false, code: "cooldown" });
  });

  it("model failure persists nothing and does not consume the exchange", async () => {
    const start = await startInterviewSession(`${STAMP}-fail`);
    if (!start.ok) throw new Error("start failed");

    const res = await runInterviewTurn(start.sessionId, "hi", async () => {
      throw new Error("model down");
    });
    expect(res).toEqual({ ok: false, code: "model_failed" });

    const session = await withSystem((tx) =>
      tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, start.sessionId),
      }),
    );
    expect(session!.exchangeCount).toBe(0);
    expect((session!.messages as unknown[]).length).toBe(1);
  });

  it("done=true flips the session to awaiting_contact", async () => {
    const start = await startInterviewSession(`${STAMP}-done`);
    if (!start.ok) throw new Error("start failed");

    const res = await runInterviewTurn(
      start.sessionId,
      "that's everything",
      fakeTurn("Great — your health check is ready.", true),
    );
    expect(res).toMatchObject({ ok: true, done: true });

    const session = await withSystem((tx) =>
      tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, start.sessionId),
      }),
    );
    expect(session!.state).toBe("awaiting_contact");
  });

  it("the server cap forces done even when the model says otherwise", async () => {
    const start = await startInterviewSession(`${STAMP}-cap`);
    if (!start.ok) throw new Error("start failed");
    await withSystem((tx) =>
      tx
        .update(schema.interviewSessions)
        .set({ exchangeCount: INTERVIEW_EXCHANGE_CAP - 1 })
        .where(eq(schema.interviewSessions.id, start.sessionId)),
    );

    const res = await runInterviewTurn(
      start.sessionId,
      "one more thing",
      fakeTurn("Endless question?", false), // model refuses to stop
    );
    expect(res).toMatchObject({ ok: true, done: true });
  });

  it("promotion creates the prospect + audit, is idempotent, and survives assessment failure", async () => {
    // Name-collision seed so the slug dedupe path is exercised.
    await withSystem((tx) =>
      tx.insert(schema.tenants).values({
        clerkOrgId: null,
        name: `${STAMP} Decks`,
        slug: `${STAMP.toLowerCase()}-decks`,
        status: "prospect",
      }),
    );

    const start = await startInterviewSession(`${STAMP}-promo`);
    if (!start.ok) throw new Error("start failed");
    await runInterviewTurn(
      start.sessionId,
      "we build decks",
      fakeTurn("Wrap-up: you build decks. Health check ready.", true),
    );

    const contact = {
      email: `owner@${STAMP.toLowerCase()}.test`,
      contactName: "Dana Owner",
      businessName: `${STAMP} Decks`,
    };
    const first = await promoteSession(
      start.sessionId,
      contact,
      async () => "## The state of your business\nSolid crew, leaky paperwork.",
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.assessment).toContain("state of your business");

    const session = await withSystem((tx) =>
      tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, start.sessionId),
      }),
    );
    expect(session!.state).toBe("completed");
    expect(session!.auditId).not.toBeNull();

    const audit = await withSystem((tx) =>
      tx.query.audits.findFirst({
        where: eq(schema.audits.id, session!.auditId!),
      }),
    );
    expect(audit!.source).toBe("self_serve");
    expect(audit!.businessName).toBe(contact.businessName);
    expect((audit!.messages as unknown[]).length).toBe(3);

    const tenant = await withSystem((tx) =>
      tx.query.tenants.findFirst({
        where: eq(schema.tenants.id, audit!.tenantId!),
      }),
    );
    expect(tenant!.status).toBe("prospect");
    expect(tenant!.clerkOrgId).toBeNull();
    expect(tenant!.contactEmail).toBe(contact.email);
    expect(tenant!.slug).toBe(`${STAMP.toLowerCase()}-decks-2`); // deduped

    // Double submit: same assessment back, no second tenant/audit.
    const again = await promoteSession(start.sessionId, contact, async () => {
      throw new Error("should not be called");
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.assessment).toBe(first.ok ? first.assessment : null);

    // Assessment failure on a fresh session still completes with the lead.
    const start2 = await startInterviewSession(`${STAMP}-promo2`);
    if (!start2.ok) throw new Error("start failed");
    await runInterviewTurn(
      start2.sessionId,
      "plumbing, 6 vans",
      fakeTurn("Wrap-up. Ready.", true),
    );
    const failed = await promoteSession(
      start2.sessionId,
      { ...contact, businessName: `${STAMP} Plumbing` },
      async () => {
        throw new Error("model down");
      },
    );
    expect(failed).toEqual({ ok: true, assessment: null });
    const session2 = await withSystem((tx) =>
      tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, start2.sessionId),
      }),
    );
    expect(session2!.state).toBe("completed");
  });

  it("promotion of an active (not wrapped) session is refused", async () => {
    const start = await startInterviewSession(`${STAMP}-early`);
    if (!start.ok) throw new Error("start failed");
    const res = await promoteSession(
      start.sessionId,
      {
        email: "x@y.test",
        contactName: "X",
        businessName: `${STAMP} Early`,
      },
      async () => "nope",
    );
    expect(res).toEqual({ ok: false, code: "expired" });
  });
});
