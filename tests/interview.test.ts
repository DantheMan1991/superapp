import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  promoteSession,
  runInterviewTurn,
  startInterviewSession,
} from "../src/lib/interview";
import {
  INTERVIEW_DAILY_IP_CAP,
  INTERVIEW_EXCHANGE_CAP,
  INTERVIEW_OPENER,
} from "../src/lib/interview-prompt";
import { ensureDefaultPipeline } from "../src/modules/crm/pipeline-ops";
import { obtainOperator } from "./isolation/_shared";

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
    // Nothing promotion writes is a tenant any more (ADR 0041): what it
    // wrote lives inside the operator, and is taken back by name. The slug
    // sweep stays so an old run's residue cannot survive.
    await tx.execute(
      sql`delete from tenants where slug like ${`${STAMP.toLowerCase()}%`}`,
    );
    if (operator) {
      await tx.execute(
        sql`delete from audits where tenant_id = ${operator} and business_name like ${`${STAMP}%`}`,
      );
      await tx.execute(
        sql`delete from work_items where tenant_id = ${operator} and title like ${`Health check lead: ${STAMP}%`}`,
      );
      await tx.execute(
        sql`delete from parties where tenant_id = ${operator} and display_name like ${`${STAMP}%`}`,
      );
    }
  });
}

let operator = "";
let operatorMinted = false;
let crmOn = false;
const noNotify = async () => {};

d("interview engine", () => {
  beforeAll(async () => {
    // Sweep first: the sweep is by stamp, and the operator minted below
    // carries the stamp too.
    await cleanup();
    await withSystem(async (tx) => {
      const op = await obtainOperator(tx, STAMP);
      operator = op.id;
      operatorMinted = op.minted;
      if (op.minted) {
        await tx
          .insert(schema.tenantModules)
          .values({ tenantId: operator, moduleId: "crm", enabled: true })
          .onConflictDoNothing();
        crmOn = true;
      } else {
        const row = await tx.query.tenantModules.findFirst({
          where: and(
            eq(schema.tenantModules.tenantId, operator),
            eq(schema.tenantModules.moduleId, "crm"),
          ),
        });
        crmOn = row?.enabled ?? false;
      }
    });
    if (crmOn) {
      // A minted operator has no pipeline; the board makes one on an owner's
      // first visit, and so does this.
      await withTenant(
        operator,
        (tx) =>
          ensureDefaultPipeline(tx, { tenantId: operator, userId: "iso-owner", role: "owner" }),
        { role: "owner", userId: "iso-owner" },
      );
    }
  });
  afterAll(async () => {
    await cleanup();
    if (operatorMinted) {
      await withSystem((tx) =>
        tx.delete(schema.tenants).where(eq(schema.tenants.id, operator)),
      );
    }
  });

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

  it("promotion lands the lead in the operator tenant — party, contact, discovery, follow-up, deal — and never mints a workspace", async () => {
    const start = await startInterviewSession(`${STAMP}-promo`);
    if (!start.ok) throw new Error("start failed");
    await runInterviewTurn(
      start.sessionId,
      "we build decks",
      fakeTurn("Wrap-up: you build decks. Health check ready.", true),
    );

    const contact = {
      email: `owner@${STAMP.toLowerCase()}.test`,
      contactName: `${STAMP} Owner`,
      businessName: `${STAMP} Decks`,
    };
    const first = await promoteSession(
      start.sessionId,
      contact,
      async () => "## The state of your business\nSolid crew, leaky paperwork.",
      noNotify,
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
    expect(session!.email).toBe(contact.email);

    // No workspace was minted for a stranger (the operator this file may
    // have minted carries the stamp too, and is not a workspace for one).
    const minted = await withSystem((tx) =>
      tx
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(
          and(
            like(schema.tenants.slug, `${STAMP.toLowerCase()}%`),
            eq(schema.tenants.isOperator, false),
          ),
        ),
    );
    expect(minted).toHaveLength(0);

    // The discovery record is the operator's, about the business party, and
    // starts from what the visitor was told.
    const audit = await withTenant(
      operator,
      (tx) =>
        tx.query.audits.findFirst({
          where: eq(schema.audits.id, session!.auditId!),
        }),
      { role: "staff" },
    );
    expect(audit?.tenantId).toBe(operator);
    expect(audit?.source).toBe("self_serve");
    expect(audit?.businessName).toBe(contact.businessName);
    expect((audit?.messages as unknown[]).length).toBe(3);
    expect(audit?.context).toContain("state of your business");

    const business = await withTenant(
      operator,
      (tx) =>
        tx.query.parties.findFirst({
          where: and(
            eq(schema.parties.tenantId, operator),
            eq(schema.parties.id, audit!.partyId!),
          ),
        }),
      { role: "staff" },
    );
    expect(business?.kind).toBe("organization");
    expect(business?.displayName).toBe(contact.businessName);

    const people = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ id: schema.parties.id })
          .from(schema.parties)
          .where(
            and(
              eq(schema.parties.tenantId, operator),
              eq(schema.parties.displayName, contact.contactName),
            ),
          ),
      { role: "staff" },
    );
    expect(people).toHaveLength(1);

    const items = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ title: schema.workItems.title })
          .from(schema.workItems)
          .where(eq(schema.workItems.tenantId, operator)),
      { role: "staff" },
    );
    expect(items.some((i) => i.title === `Health check lead: ${contact.businessName}`)).toBe(true);

    if (crmOn) {
      const [details] = await withTenant(
        operator,
        (tx) =>
          tx
            .select({ source: schema.crmPartyDetails.source })
            .from(schema.crmPartyDetails)
            .where(eq(schema.crmPartyDetails.partyId, business!.id)),
        { role: "staff" },
      );
      expect(details?.source).toBe("health-check");

      const deals = await withTenant(
        operator,
        (tx) =>
          tx
            .select({ title: schema.crmDeals.title, primary: schema.crmDeals.primaryContactPartyId })
            .from(schema.crmDeals)
            .where(eq(schema.crmDeals.partyId, business!.id)),
        { role: "staff" },
      );
      expect(deals).toHaveLength(1);
      expect(deals[0].title).toContain(contact.businessName);
      expect(deals[0].primary).toBe(people[0].id);

      const affiliations = await withTenant(
        operator,
        (tx) =>
          tx
            .select({ id: schema.crmAffiliations.id })
            .from(schema.crmAffiliations)
            .where(
              and(
                eq(schema.crmAffiliations.personPartyId, people[0].id),
                eq(schema.crmAffiliations.organizationPartyId, business!.id),
              ),
            ),
        { role: "staff" },
      );
      expect(affiliations).toHaveLength(1);

      const notes = await withTenant(
        operator,
        (tx) =>
          tx
            .select({ subject: schema.crmActivities.subject })
            .from(schema.crmActivities)
            .where(eq(schema.crmActivities.partyId, business!.id)),
        { role: "staff" },
      );
      expect(notes).toEqual([{ subject: "Health check" }]);
    }

    // Double submit: same assessment back, no second landing.
    const again = await promoteSession(
      start.sessionId,
      contact,
      async () => {
        throw new Error("should not be called");
      },
      noNotify,
    );
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.assessment).toBe(first.ok ? first.assessment : null);
    const audits = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ id: schema.audits.id })
          .from(schema.audits)
          .where(eq(schema.audits.businessName, contact.businessName)),
      { role: "staff" },
    );
    expect(audits).toHaveLength(1);

    // Assessment failure on a fresh session still lands the lead — and the
    // same inbox is the same person, not a second one.
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
      noNotify,
    );
    expect(failed).toEqual({ ok: true, assessment: null });
    const session2 = await withSystem((tx) =>
      tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, start2.sessionId),
      }),
    );
    expect(session2!.state).toBe("completed");
    expect(session2!.auditId).not.toBeNull();
    const peopleAfter = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ id: schema.parties.id })
          .from(schema.parties)
          .where(
            and(
              eq(schema.parties.tenantId, operator),
              eq(schema.parties.displayName, contact.contactName),
            ),
          ),
      { role: "staff" },
    );
    expect(peopleAfter).toHaveLength(1);
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
