import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  attachWorkspaceToParty,
  ProvisionError,
  resolveProvisionTarget,
} from "../src/app/admin/provision";
import { obtainOperator, seedParty } from "./isolation/_shared";

/**
 * A workspace is provisioned FROM a party (ADR 0041, back-office slice 3).
 * Everything around the one Clerk call is here: what the console refuses
 * before asking Clerk for anything, the name and slug it will use, and the
 * attach that follows — the pointer once, the contact, the note.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `prov-test-${process.pid}`;

let operator: string;
let operatorMinted = false;
let crmOn = false;
let business: string;
let person: string;
let taken: string;
let takenWorkspace: string;
let freshWorkspace: string;

async function refusal(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof ProvisionError) return err.code;
    throw err;
  }
}

d("provisioning from a party", () => {
  beforeAll(async () => {
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
      business = await seedParty(tx, operator, `${STAMP} Fresh Co`);
      await tx.insert(schema.partyContactPoints).values({
        tenantId: operator,
        partyId: business,
        kind: "email",
        value: `owner-${process.pid}@example.test`,
        normalizedValue: `owner-${process.pid}@example.test`,
      });
      const [p] = await tx
        .insert(schema.parties)
        .values({ tenantId: operator, kind: "person", displayName: `${STAMP} Person` })
        .returning({ id: schema.parties.id });
      person = p.id;
      taken = await seedParty(tx, operator, `${STAMP} Taken Co`);
      const [w] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-taken`,
          name: `${STAMP} Taken Co`,
          slug: `${STAMP}-taken`,
          operatorPartyId: taken,
        })
        .returning({ id: schema.tenants.id });
      takenWorkspace = w.id;
      // A row the way upsertTenantFromOrg leaves it: no pointer yet.
      const [f] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-fresh`,
          name: `${STAMP} Fresh Co`,
          slug: `${STAMP}-fresh`,
        })
        .returning({ id: schema.tenants.id });
      freshWorkspace = f.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, takenWorkspace));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, freshWorkspace));
      for (const id of [business, person, taken]) {
        await tx
          .delete(schema.parties)
          .where(and(eq(schema.parties.tenantId, operator), eq(schema.parties.id, id)));
      }
      if (operatorMinted) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, operator));
      }
    });
  });

  it("refuses a party the operator does not hold, a person, and a business that has a workspace", async () => {
    expect(await refusal(() => resolveProvisionTarget("00000000-0000-0000-0000-000000000000"))).toBe(
      "PARTY_NOT_FOUND",
    );
    expect(await refusal(() => resolveProvisionTarget(person))).toBe("NOT_A_BUSINESS");
    expect(await refusal(() => resolveProvisionTarget(taken))).toBe("HAS_WORKSPACE");
  });

  it("resolves a fresh business: its name, its email, and a slug a person would type", async () => {
    const target = await resolveProvisionTarget(business);
    expect(target.operatorId).toBe(operator);
    expect(target.name).toBe(`${STAMP} Fresh Co`);
    expect(target.email).toBe(`owner-${process.pid}@example.test`);
    // The row minted above already holds `<stamp>-fresh`; the slug is deduped
    // against tenants.slug, never handed to Clerk as a clash.
    expect(target.slug).toBe(`${STAMP.toLowerCase()}-fresh-co`);
  });

  it("attaches once: the pointer, the contact email, and the note on the timeline", async () => {
    const target = await resolveProvisionTarget(business);
    const first = await attachWorkspaceToParty(freshWorkspace, target, { userId: "user-actor" });
    expect(first.linked).toBe(true);

    const [row] = await withSystem((tx) =>
      tx
        .select({ pointer: schema.tenants.operatorPartyId, email: schema.tenants.contactEmail })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, freshWorkspace)),
    );
    expect(row.pointer).toBe(business);
    expect(row.email).toBe(target.email);

    const second = await attachWorkspaceToParty(freshWorkspace, target, { userId: "user-actor" });
    expect(second.linked).toBe(false);

    if (crmOn) {
      const notes = await withTenant(
        operator,
        (tx) =>
          tx
            .select({ subject: schema.crmActivities.subject })
            .from(schema.crmActivities)
            .where(eq(schema.crmActivities.partyId, business)),
        { role: "owner" },
      );
      expect(notes).toEqual([{ subject: "Workspace provisioned" }]);
    }

    // Now the business has a workspace, and says so.
    expect(await refusal(() => resolveProvisionTarget(business))).toBe("HAS_WORKSPACE");
  });
});
