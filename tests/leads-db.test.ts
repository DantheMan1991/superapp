import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import { landLead } from "../src/lib/leads/resolve";
import { ensureDefaultPipeline } from "../src/modules/crm/pipeline-ops";
import { seedParty } from "./isolation/_shared";

/**
 * A stranger's arrival is a lead the CRM fills in (ADR 0042): the slot runs
 * only where CRM is on, adopts the record with its source, joins the contact
 * to the business, opens a deal in the opening stage when there is a
 * proposition, and leaves the note — inside the caller's transaction, as
 * `staff` with no user, never failing the arrival.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `leads-test-${process.pid}`;

let off: string;
let on: string;
let orgOff: string;
let orgOn: string;
let personOn: string;

const ctxFor = (tenantId: string) => ({ tenantId, userId: "" });

d("the leads slot", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-off`, name: "Leads Off", slug: `${STAMP}-off` },
          { clerkOrgId: `${STAMP}-on`, name: "Leads On", slug: `${STAMP}-on` },
        ])
        .returning();
      off = rows[0].id;
      on = rows[1].id;
      await tx
        .insert(schema.tenantModules)
        .values({ tenantId: on, moduleId: "crm", enabled: true })
        .onConflictDoNothing();
      orgOff = await seedParty(tx, off, `${STAMP} Off Co`);
      orgOn = await seedParty(tx, on, `${STAMP} On Co`);
      const [person] = await tx
        .insert(schema.parties)
        .values({ tenantId: on, kind: "person", displayName: `${STAMP} Person` })
        .returning({ id: schema.parties.id });
      personOn = person.id;
    });
    // A minted tenant has no pipeline; the board makes one on an owner's
    // first visit, and so does this.
    await withTenant(
      on,
      (tx) => ensureDefaultPipeline(tx, { tenantId: on, userId: "owner", role: "owner" }),
      { role: "owner", userId: "owner" },
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, off));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, on));
    });
  });

  it("does nothing where CRM is off", async () => {
    const landed = await withTenant(off, (tx) =>
      landLead(tx, ctxFor(off), { partyId: orgOff, source: "website" }),
    );
    expect(landed).toEqual([]);
    const details = await withTenant(off, (tx) =>
      tx.select().from(schema.crmPartyDetails).where(eq(schema.crmPartyDetails.partyId, orgOff)),
    );
    expect(details).toHaveLength(0);
  });

  it("a plain message adopts the record with its source, and nothing more", async () => {
    const landed = await withTenant(on, (tx) =>
      landLead(tx, ctxFor(on), { partyId: orgOn, source: "website" }),
    );
    expect(landed).toEqual(["crm"]);

    const [details] = await withTenant(on, (tx) =>
      tx
        .select({ source: schema.crmPartyDetails.source })
        .from(schema.crmPartyDetails)
        .where(eq(schema.crmPartyDetails.partyId, orgOn)),
    );
    expect(details?.source).toBe("website");

    const deals = await withTenant(on, (tx) =>
      tx.select().from(schema.crmDeals).where(eq(schema.crmDeals.partyId, orgOn)),
    );
    expect(deals).toHaveLength(0);
  });

  it("a proposition opens a deal in the opening stage, joins the contact, and leaves the note", async () => {
    await withTenant(on, (tx) =>
      landLead(tx, ctxFor(on), {
        partyId: orgOn,
        contactPartyId: personOn,
        source: "health-check",
        proposition: {
          title: `${STAMP} On Co: the outsourced back office`,
          note: { subject: "Health check", body: "Completed the interview." },
        },
      }),
    );

    const deals = await withTenant(on, (tx) =>
      tx
        .select({
          id: schema.crmDeals.id,
          title: schema.crmDeals.title,
          primary: schema.crmDeals.primaryContactPartyId,
          stage: schema.crmPipelineStages.name,
          sortOrder: schema.crmPipelineStages.sortOrder,
        })
        .from(schema.crmDeals)
        .innerJoin(
          schema.crmPipelineStages,
          and(
            eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
            eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
          ),
        )
        .where(eq(schema.crmDeals.partyId, orgOn)),
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].title).toContain("outsourced back office");
    expect(deals[0].primary).toBe(personOn);
    expect(deals[0].sortOrder).toBe(0);

    const affiliations = await withTenant(on, (tx) =>
      tx
        .select({ id: schema.crmAffiliations.id, isPrimary: schema.crmAffiliations.isPrimary })
        .from(schema.crmAffiliations)
        .where(
          and(
            eq(schema.crmAffiliations.personPartyId, personOn),
            eq(schema.crmAffiliations.organizationPartyId, orgOn),
          ),
        ),
    );
    expect(affiliations).toHaveLength(1);

    const notes = await withTenant(on, (tx) =>
      tx
        .select({ subject: schema.crmActivities.subject, dealId: schema.crmActivities.dealId })
        .from(schema.crmActivities)
        .where(eq(schema.crmActivities.partyId, orgOn)),
    );
    expect(notes).toEqual([{ subject: "Health check", dealId: deals[0].id }]);

    // The record kept the source it already had.
    const [details] = await withTenant(on, (tx) =>
      tx
        .select({ source: schema.crmPartyDetails.source })
        .from(schema.crmPartyDetails)
        .where(eq(schema.crmPartyDetails.partyId, orgOn)),
    );
    expect(details?.source).toBe("website");
  });

  it("a second arrival does not duplicate the affiliation, and never poisons the transaction", async () => {
    // Runs inside one transaction with a write after it: a constraint error
    // escaping the filler would fail the write that follows.
    const after = await withTenant(on, async (tx) => {
      await landLead(tx, ctxFor(on), {
        partyId: orgOn,
        contactPartyId: personOn,
        source: "referral",
        proposition: { title: "Again" },
      });
      const [row] = await tx
        .insert(schema.crmActivities)
        .values({
          tenantId: on,
          partyId: orgOn,
          kind: "note",
          subject: "after the slot",
          createdByClerkUserId: "",
        })
        .returning({ id: schema.crmActivities.id });
      return row.id;
    });
    expect(after).toBeTruthy();

    const affiliations = await withTenant(on, (tx) =>
      tx
        .select({ id: schema.crmAffiliations.id })
        .from(schema.crmAffiliations)
        .where(eq(schema.crmAffiliations.personPartyId, personOn)),
    );
    expect(affiliations).toHaveLength(1);
  });
});
