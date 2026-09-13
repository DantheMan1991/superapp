import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  FEEDBACK_SIDES,
  FEEDBACK_SURFACES,
} from "../../src/lib/feedback/vocabulary";
import { d } from "./_shared";

/**
 * feedback_reports + feedback_messages (RLS) — ADR 0053.
 *
 * A THREAD IS THE REPORTER'S OWN. The posture is `push_devices`' and
 * `device_grants`' rather than an ordinary tenant table's: `app_current_tenant()`
 * AND `app_current_user()` together, so no tier of membership — an owner's
 * included — reaches a colleague's report. The product's promise is "tell us
 * what is wrong", and people answer that honestly only when their employer is
 * not reading it.
 *
 * AND THE ONE THAT WOULD HURT MOST: an operator's INTERNAL NOTE sits in the
 * same table as the conversation, in thread order, separated from the client
 * by one clause in one policy. The case below is what stands between a private
 * "this is the same bug as Hilltop's" and the client reading it. Do not delete
 * it.
 */
d("feedback (RLS)", () => {
  const STAMP = `iso-fb-${process.pid}-${Date.now()}`;
  const REPORTER = `${STAMP}-reporter`;
  const BOSS = `${STAMP}-boss`;
  const OUTSIDER = `${STAMP}-outsider`;
  let tenantA: string;
  let tenantB: string;
  let mine: string;
  let bossReport: string;
  let theirs: string;
  let noteId: string;

  const asReporter = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: REPORTER });
  /** The OWNER of the same workspace. Sees nothing of the reporter's. */
  const asBoss = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: BOSS });
  const asOutsider = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OUTSIDER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [a] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}_a`,
          name: `Feedback A ${STAMP}`,
          slug: `${STAMP}-a`,
        })
        .returning();
      const [b] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}_b`,
          name: `Feedback B ${STAMP}`,
          slug: `${STAMP}-b`,
        })
        .returning();
      tenantA = a.id;
      tenantB = b.id;

      const reports = await tx
        .insert(schema.feedbackReports)
        .values([
          {
            tenantId: tenantA,
            clerkUserId: REPORTER,
            kind: "bug",
            title: "Totals do not add up",
            route: "/dashboard/m/accounting",
            featureSlug: "accounting",
          },
          {
            tenantId: tenantA,
            clerkUserId: BOSS,
            kind: "idea",
            title: "The boss's own idea",
            route: "/dashboard",
          },
          {
            tenantId: tenantB,
            clerkUserId: OUTSIDER,
            kind: "question",
            title: "Another business entirely",
            route: "/dashboard",
          },
        ])
        .returning();
      mine = reports[0].id;
      bossReport = reports[1].id;
      theirs = reports[2].id;

      await tx.insert(schema.feedbackMessages).values({
        tenantId: tenantA,
        reportId: mine,
        side: "client",
        clerkUserId: REPORTER,
        authorName: "The Reporter",
        body: "The bills list adds up to the wrong number.",
      });
      await tx.insert(schema.feedbackMessages).values({
        tenantId: tenantA,
        reportId: mine,
        side: "operator",
        authorName: "Yosher",
        body: "Which column are you reading?",
      });
      const [note] = await tx
        .insert(schema.feedbackMessages)
        .values({
          tenantId: tenantA,
          reportId: mine,
          side: "operator",
          authorName: "Operator",
          body: "SECRET NOTE: same as the Hilltop one, and their books are a mess.",
          internal: true,
        })
        .returning();
      noteId = note.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      for (const id of [tenantA, tenantB]) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
    });
  });

  // -------------------------------------------------------------------------
  // Who sees a report
  // -------------------------------------------------------------------------

  it("shows a person their own reports and nobody else's", async () => {
    const rows = await asReporter((tx) =>
      tx.select().from(schema.feedbackReports),
    );
    expect(rows.map((r) => r.id)).toEqual([mine]);
  });

  it("does not show an OWNER what their staff reported", async () => {
    // Deliberate, and the single most likely thing for somebody to 'fix'
    // later. ADR 0053: this is the loosenable direction, and the promise the
    // box makes is what is being protected.
    const rows = await asBoss((tx) => tx.select().from(schema.feedbackReports));
    expect(rows.map((r) => r.id)).toEqual([bossReport]);
  });

  it("shows another business its own reports and nothing of ours", async () => {
    // Both halves in one case on purpose: a policy that returned nothing at all
    // would pass the isolation half and be useless, which is how a table ends
    // up certified and broken.
    const rows = await asOutsider((tx) =>
      tx.select().from(schema.feedbackReports),
    );
    expect(rows.map((r) => r.id)).toEqual([theirs]);
    const reachingOver = await asOutsider((tx) =>
      tx
        .select()
        .from(schema.feedbackReports)
        .where(eq(schema.feedbackReports.tenantId, tenantA)),
    );
    expect(reachingOver).toHaveLength(0);
  });

  it("denies rather than widens when the user id is forgotten", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.feedbackReports),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // THE INTERNAL NOTE
  // -------------------------------------------------------------------------

  it("never shows the reporter an internal note", async () => {
    const rows = await asReporter((tx) =>
      tx
        .select()
        .from(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.reportId, mine)),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => !m.internal)).toBe(true);
    expect(rows.map((m) => m.body).join(" ")).not.toContain("SECRET NOTE");
  });

  it("does not let the reporter reach a note by asking for it directly", async () => {
    const rows = await asReporter((tx) =>
      tx
        .select()
        .from(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.id, noteId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps the note for the console", async () => {
    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.reportId, mine)),
    );
    expect(rows).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // What a client may write
  // -------------------------------------------------------------------------

  it("lets a person reply to their own report", async () => {
    const written = await asReporter((tx) =>
      tx
        .insert(schema.feedbackMessages)
        .values({
          tenantId: tenantA,
          reportId: mine,
          side: "client",
          clerkUserId: REPORTER,
          body: "The right-hand one.",
        })
        .returning(),
    );
    expect(written).toHaveLength(1);
    await withSystem((tx) =>
      tx
        .delete(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.id, written[0].id)),
    );
  });

  it("refuses a client message that claims to be from us", async () => {
    // `side` is a POLICY term, not only a CHECK: without it a client could
    // post a message that renders in their own thread as our answer.
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackMessages).values({
          tenantId: tenantA,
          reportId: mine,
          side: "operator",
          clerkUserId: REPORTER,
          body: "We have fixed this, please stop asking.",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a client-written internal note", async () => {
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackMessages).values({
          tenantId: tenantA,
          reportId: mine,
          side: "client",
          clerkUserId: REPORTER,
          internal: true,
          body: "Hidden from myself.",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a reply to somebody else's report", async () => {
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackMessages).values({
          tenantId: tenantA,
          reportId: bossReport,
          side: "client",
          clerkUserId: REPORTER,
          body: "Butting in.",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a report filed in somebody else's name", async () => {
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackReports).values({
          tenantId: tenantA,
          clerkUserId: BOSS,
          kind: "bug",
          title: "Filed as the boss",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a report filed into another business", async () => {
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackReports).values({
          tenantId: tenantB,
          clerkUserId: REPORTER,
          kind: "bug",
          title: "Wrong workspace",
        }),
      ),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // A conversation is not rewritable
  // -------------------------------------------------------------------------

  it("lets a person mark their own thread read", async () => {
    const updated = await asReporter((tx) =>
      tx
        .update(schema.feedbackReports)
        .set({ clientReadAt: new Date() })
        .where(eq(schema.feedbackReports.id, mine))
        .returning(),
    );
    expect(updated).toHaveLength(1);
  });

  it("refuses to let a person hand their report to somebody else", async () => {
    // WITH CHECK repeats USING, so a row cannot be updated OUT of its owner's
    // sight — which would otherwise be a way to lose a thread entirely.
    await expect(
      asReporter((tx) =>
        tx
          .update(schema.feedbackReports)
          .set({ clerkUserId: BOSS })
          .where(eq(schema.feedbackReports.id, mine)),
      ),
    ).rejects.toThrow();
  });

  it("has no UPDATE policy on a message — neither side may rewrite one", async () => {
    const updated = await asReporter((tx) =>
      tx
        .update(schema.feedbackMessages)
        .set({ body: "I never said that." })
        .where(
          and(
            eq(schema.feedbackMessages.reportId, mine),
            eq(schema.feedbackMessages.side, "client"),
          ),
        )
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("has no DELETE policy on a message", async () => {
    const deleted = await asReporter((tx) =>
      tx
        .delete(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.reportId, mine))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("has no DELETE policy on a report — withdrawing one is 'declined'", async () => {
    const deleted = await asReporter((tx) =>
      tx
        .delete(schema.feedbackReports)
        .where(eq(schema.feedbackReports.id, mine))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("will not let a client set their own status", async () => {
    // NOT an RLS guarantee and deliberately tested anyway: a row-level policy
    // cannot see WHICH column changed, so the refusal lives in the server
    // action. What the database does promise is the line below — the update
    // succeeds, which is exactly why nothing but `markReportReadAction` may
    // ever build one.
    const updated = await asReporter((tx) =>
      tx
        .update(schema.feedbackReports)
        .set({ status: "done" })
        .where(eq(schema.feedbackReports.id, mine))
        .returning(),
    );
    expect(updated).toHaveLength(1);
    await withSystem((tx) =>
      tx
        .update(schema.feedbackReports)
        .set({ status: "new" })
        .where(eq(schema.feedbackReports.id, mine)),
    );
  });

  // -------------------------------------------------------------------------
  // Attachments (slice 2)
  // -------------------------------------------------------------------------

  it("shows the reporter the files on their own messages", async () => {
    const [clientMessage] = await withSystem((tx) =>
      tx
        .select({ id: schema.feedbackMessages.id })
        .from(schema.feedbackMessages)
        .where(
          and(
            eq(schema.feedbackMessages.reportId, mine),
            eq(schema.feedbackMessages.side, "client"),
          ),
        )
        .limit(1),
    );
    const [file] = await withSystem((tx) =>
      tx
        .insert(schema.feedbackAttachments)
        .values({
          tenantId: tenantA,
          reportId: mine,
          messageId: clientMessage.id,
          blobPathname: `feedback/${tenantA}/${STAMP}-shot.png`,
          fileName: "shot.png",
          mimeType: "image/png",
          byteSize: 1234,
          clerkUserId: REPORTER,
        })
        .returning(),
    );
    const seen = await asReporter((tx) =>
      tx.select().from(schema.feedbackAttachments),
    );
    expect(seen.map((r) => r.id)).toEqual([file.id]);
  });

  it("hides a file on an INTERNAL note from the reporter", async () => {
    // Cannot happen yet — only clients upload. The clause exists so that the
    // day an operator picker is added, the leak is already closed rather than
    // waiting to be noticed. Delete this and that day arrives silently.
    const [note] = await withSystem((tx) =>
      tx
        .select({ id: schema.feedbackMessages.id })
        .from(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.id, noteId))
        .limit(1),
    );
    await withSystem((tx) =>
      tx.insert(schema.feedbackAttachments).values({
        tenantId: tenantA,
        reportId: mine,
        messageId: note.id,
        blobPathname: `feedback/${tenantA}/${STAMP}-secret.png`,
        fileName: "secret.png",
        mimeType: "image/png",
        byteSize: 99,
        clerkUserId: BOSS,
      }),
    );
    const seen = await asReporter((tx) =>
      tx.select().from(schema.feedbackAttachments),
    );
    expect(seen.map((r) => r.fileName)).not.toContain("secret.png");
    // And the console still has it.
    const all = await withSystem((tx) =>
      tx
        .select()
        .from(schema.feedbackAttachments)
        .where(eq(schema.feedbackAttachments.reportId, mine)),
    );
    expect(all.map((r) => r.fileName)).toContain("secret.png");
  });

  it("shows another business none of it", async () => {
    const seen = await asOutsider((tx) =>
      tx.select().from(schema.feedbackAttachments),
    );
    expect(seen).toHaveLength(0);
  });

  it("refuses a file filed onto somebody else's report", async () => {
    const [bossMessage] = await withSystem((tx) =>
      tx
        .insert(schema.feedbackMessages)
        .values({
          tenantId: tenantA,
          reportId: bossReport,
          side: "client",
          clerkUserId: BOSS,
          body: "The boss's own message.",
        })
        .returning({ id: schema.feedbackMessages.id }),
    );
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackAttachments).values({
          tenantId: tenantA,
          reportId: bossReport,
          messageId: bossMessage.id,
          blobPathname: `feedback/${tenantA}/${STAMP}-intrude.png`,
          fileName: "intrude.png",
          mimeType: "image/png",
          byteSize: 10,
          clerkUserId: REPORTER,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a file filed in somebody else's name", async () => {
    const [clientMessage] = await withSystem((tx) =>
      tx
        .select({ id: schema.feedbackMessages.id })
        .from(schema.feedbackMessages)
        .where(
          and(
            eq(schema.feedbackMessages.reportId, mine),
            eq(schema.feedbackMessages.side, "client"),
          ),
        )
        .limit(1),
    );
    await expect(
      asReporter((tx) =>
        tx.insert(schema.feedbackAttachments).values({
          tenantId: tenantA,
          reportId: mine,
          messageId: clientMessage.id,
          blobPathname: `feedback/${tenantA}/${STAMP}-forged.png`,
          fileName: "forged.png",
          mimeType: "image/png",
          byteSize: 10,
          clerkUserId: BOSS,
        }),
      ),
    ).rejects.toThrow();
  });

  it("has no UPDATE and no DELETE policy on an attachment", async () => {
    const updated = await asReporter((tx) =>
      tx
        .update(schema.feedbackAttachments)
        .set({ fileName: "renamed.png" })
        .where(eq(schema.feedbackAttachments.reportId, mine))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asReporter((tx) =>
      tx
        .delete(schema.feedbackAttachments)
        .where(eq(schema.feedbackAttachments.reportId, mine))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("holds one pathname once across the whole platform", async () => {
    // Two rows pointing at one blob would make a delete take out somebody
    // else's file. The upload door adds a random suffix; this is the net.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.feedbackAttachments).values({
          tenantId: tenantB,
          reportId: theirs,
          messageId: noteId,
          blobPathname: `feedback/${tenantA}/${STAMP}-shot.png`,
          fileName: "collision.png",
          mimeType: "image/png",
          byteSize: 10,
          clerkUserId: OUTSIDER,
        }),
      ),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // The database's own promises
  // -------------------------------------------------------------------------

  it("refuses a message attached to a report in another tenant", async () => {
    // The composite FK (tenant_id, report_id) -> (tenant_id, id). RLS would
    // refuse this too; the FK is what refuses it under `withSystem`, where
    // RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.feedbackMessages).values({
          tenantId: tenantB,
          reportId: mine,
          side: "operator",
          body: "Crossing the streams.",
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the CHECKs and the TypeScript vocabulary from drifting apart", async () => {
    // The two cannot be generated from one another — a migration imports
    // nothing — so this test is the only thing stopping a value the app
    // believes in and the database refuses. Postgres rewrites `in (…)` as
    // `= ANY (ARRAY[…])`, hence reading the definition back.
    async function checkValues(constraint: string): Promise<string[]> {
      const result = await withSystem((tx) =>
        tx.execute(
          sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${constraint}`,
        ),
      );
      const rows = (result as unknown as { rows: { def: string }[] }).rows;
      expect(rows, `constraint ${constraint} is missing`).toHaveLength(1);
      return [...rows[0].def.matchAll(/'([a-z_]+)'::text/g)]
        .map((m) => m[1])
        .sort();
    }

    expect(await checkValues("feedback_reports_kind")).toEqual(
      [...FEEDBACK_KINDS].sort(),
    );
    expect(await checkValues("feedback_reports_status")).toEqual(
      [...FEEDBACK_STATUSES].sort(),
    );
    expect(await checkValues("feedback_reports_surface")).toEqual(
      [...FEEDBACK_SURFACES].sort(),
    );
    expect(await checkValues("feedback_messages_side")).toEqual(
      [...FEEDBACK_SIDES].sort(),
    );
  });

  it("takes the whole conversation with the workspace", async () => {
    // ON DELETE CASCADE from `tenants`, through the report, to the messages.
    // Nothing in the product hard deletes a thread; a tenant leaving does.
    const [gone] = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}_c`,
          name: `Feedback C ${STAMP}`,
          slug: `${STAMP}-c`,
        })
        .returning();
      const [r] = await tx
        .insert(schema.feedbackReports)
        .values({
          tenantId: t.id,
          clerkUserId: `${STAMP}-leaver`,
          kind: "bug",
          title: "Goes with the workspace",
        })
        .returning();
      await tx.insert(schema.feedbackMessages).values({
        tenantId: t.id,
        reportId: r.id,
        side: "client",
        body: "And so does this.",
      });
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, t.id));
      return tx
        .select()
        .from(schema.feedbackMessages)
        .where(eq(schema.feedbackMessages.reportId, r.id));
    });
    expect(gone).toBeUndefined();
  });
});
