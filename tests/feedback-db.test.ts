import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "../src/db";
import type { TenantContext } from "../src/lib/auth";
import {
  countUnreadReplies,
  getMyReport,
  listMyReports,
  listReportsForConsole,
} from "../src/lib/feedback/read";
import { hasUnreadReply, needsOperator } from "../src/lib/feedback/core";

/**
 * THE READ LAYER'S DERIVED FLAGS, THROUGH A REAL DRIVER.
 *
 * `tests/feedback-core.test.ts` proves `hasUnreadReply` and `needsOperator` are
 * right about two Dates. This file proves the rows handed to them ARE two
 * Dates — which is a different claim, and the one that was false.
 *
 * The bug this exists to stop: `lastOperatorMessageAt` is a correlated
 * subquery written as a raw `sql` fragment, and a raw fragment carries no
 * column type, so the driver hands back whatever it likes. When that is a
 * STRING, `said > report.clientReadAt` compares a string against a Date, both
 * sides go to NaN, and the predicate returns FALSE FOREVER. Nothing throws.
 * The dot on the button (counted in SQL) said unread while the row beside it
 * (derived in JS) said read, and only the disagreement gave it away.
 *
 * So every assertion below is about a value's TYPE as much as its truth.
 */

/**
 * Its own gate, the form every non-isolation database suite uses
 * (`leads-db.test.ts` and friends) rather than the `_shared` one the isolation
 * files import. `tests/db-backed-files.test.ts` recognises a database suite by
 * exactly these two spellings, so borrowing the other file's gate through a
 * path it does not match puts this suite in the PARALLEL project, racing the
 * very tenants it creates.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("feedback read layer (db)", () => {
  const STAMP = `fb-read-${process.pid}-${Date.now()}`;
  const REPORTER = `${STAMP}-reporter`;
  let tenantId: string;
  let reportId: string;
  let ctx: TenantContext;

  /** Only the four fields the read layer touches; the rest is not its business. */
  const contextFor = (id: string): TenantContext =>
    ({
      tenant: { id, timezone: "America/New_York" },
      userId: REPORTER,
      role: "staff",
      support: null,
    }) as unknown as TenantContext;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Feedback Read ${STAMP}`,
          slug: STAMP,
        })
        .returning();
      tenantId = t.id;
      ctx = contextFor(tenantId);

      const [report] = await tx
        .insert(schema.feedbackReports)
        .values({
          tenantId,
          clerkUserId: REPORTER,
          kind: "bug",
          title: "Totals do not add up",
          route: "/dashboard/m/accounting",
          featureSlug: "accounting",
          // Their own words are read the moment they are written, which is what
          // makes the comparison below a real one rather than a null check.
          clientReadAt: new Date("2026-09-13T10:24:00Z"),
        })
        .returning();
      reportId = report.id;

      await tx.insert(schema.feedbackMessages).values({
        tenantId,
        reportId,
        side: "client",
        clerkUserId: REPORTER,
        body: "The card does nothing when I press it.",
        createdAt: new Date("2026-09-13T10:24:00Z"),
      });
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("hands the caller real Dates, not strings", async () => {
    const [row] = await listMyReports(ctx);
    // The assertion that would have caught it. `typeof "…" === "object"` is
    // false, and a string here is what made every comparison below return the
    // wrong answer silently.
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.clientReadAt).toBeInstanceOf(Date);
    expect(row.lastClientMessageAt).toBeInstanceOf(Date);
    expect(row.messageCount).toBe(1);
    expect(typeof row.messageCount).toBe("number");
    // Null is the honest answer before we have said anything — and must be
    // null, not the string "null" and not an epoch.
    expect(row.lastOperatorMessageAt).toBeNull();
  });

  it("says nothing is unread before we have replied", async () => {
    expect(hasUnreadReply((await listMyReports(ctx))[0])).toBe(false);
    expect(await countUnreadReplies(ctx)).toBe(0);
  });

  it("lights the dot once we reply, and agrees with the count", async () => {
    await withSystem((tx) =>
      tx.insert(schema.feedbackMessages).values({
        tenantId,
        reportId,
        side: "operator",
        authorName: "Yosher",
        body: "Should it open the trial balance, or the journal?",
        createdAt: new Date("2026-09-13T10:27:00Z"),
      }),
    );

    const [row] = await listMyReports(ctx);
    expect(row.lastOperatorMessageAt).toBeInstanceOf(Date);
    // THE ONE THAT FAILED. The row's own verdict…
    expect(hasUnreadReply(row)).toBe(true);
    // …and the count the layout draws the dot from, which is computed in SQL.
    // These two are allowed to be implemented differently; they are not
    // allowed to disagree.
    expect(await countUnreadReplies(ctx)).toBe(1);
  });

  it("clears once the reporter has read it", async () => {
    await withSystem((tx) =>
      tx
        .update(schema.feedbackReports)
        .set({ clientReadAt: new Date("2026-09-13T10:30:00Z") })
        .where(eq(schema.feedbackReports.id, reportId)),
    );
    const [row] = await listMyReports(ctx);
    expect(hasUnreadReply(row)).toBe(false);
    expect(await countUnreadReplies(ctx)).toBe(0);
  });

  it("keeps an internal note out of the client's thread and out of their dot", async () => {
    await withSystem((tx) =>
      tx.insert(schema.feedbackMessages).values({
        tenantId,
        reportId,
        side: "operator",
        authorName: "Operator",
        body: "SECRET NOTE: same as the other one.",
        internal: true,
        createdAt: new Date("2026-09-13T10:35:00Z"),
      }),
    );
    const found = await getMyReport(ctx, reportId);
    expect(found).not.toBeNull();
    expect(found!.messages.map((m) => m.body).join(" ")).not.toContain(
      "SECRET NOTE",
    );
    // A note is not something they heard, so it must not light their dot — the
    // reason `lastOperatorMessageAt` filters on `internal` at all.
    expect(hasUnreadReply(found!.report)).toBe(false);
    expect(await countUnreadReplies(ctx)).toBe(0);
  });

  it("puts a reply from the client back in the operator's queue", async () => {
    await withSystem((tx) =>
      tx
        .update(schema.feedbackReports)
        .set({
          status: "done",
          closedAt: new Date("2026-09-13T11:00:00Z"),
          operatorReadAt: new Date("2026-09-13T11:00:00Z"),
        })
        .where(eq(schema.feedbackReports.id, reportId)),
    );
    const settled = await listReportsForConsole({ tenantId });
    expect(settled).toHaveLength(1);
    expect(settled[0].lastClientMessageAt).toBeInstanceOf(Date);
    expect(needsOperator(settled[0])).toBe(false);

    // "It is still happening" on a closed report.
    await withSystem((tx) =>
      tx.insert(schema.feedbackMessages).values({
        tenantId,
        reportId,
        side: "client",
        clerkUserId: REPORTER,
        body: "Still happening on my phone.",
        createdAt: new Date("2026-09-13T12:00:00Z"),
      }),
    );
    const reopened = await listReportsForConsole({ tenantId });
    expect(needsOperator(reopened[0])).toBe(true);
  });
});
