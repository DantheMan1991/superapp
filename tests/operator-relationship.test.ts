import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  ensureOperatorParty,
  readOperatorParty,
  RelationshipError,
} from "../src/app/admin/relationship";
import { obtainOperator } from "./isolation/_shared";

/**
 * A client is a party in the operator tenant (ADR 0041, back-office slice 1):
 * `ensureOperatorParty` writes the party, its contact point and the CRM
 * record under the OPERATOR's context, then the one pointer under
 * `withSystem`; `readOperatorParty` reads it back the same narrow way.
 *
 * Runs against the named operator when the database has one — so on the dev
 * branch it writes a real party into Yosher's CRM for a few seconds and takes
 * it back — and against a minted one otherwise. CRM may or may not be on for
 * a real operator; the test reads which and expects accordingly.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `rel-test-${process.pid}`;

let operator: string;
let operatorMinted = false;
let crmOn = false;
let client: string;
const createdParties: string[] = [];

d("a client is a party in the operator tenant", () => {
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

      const [c] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-c`,
          name: "Relationship Client",
          slug: `${STAMP}-c`,
          contactEmail: `owner-${process.pid}@example.test`,
        })
        .returning();
      client = c.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, client));
      for (const partyId of createdParties) {
        // Details and contact points cascade from the party.
        await tx
          .delete(schema.parties)
          .where(
            and(eq(schema.parties.tenantId, operator), eq(schema.parties.id, partyId)),
          );
      }
      if (operatorMinted) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, operator));
      }
    });
  });

  it("makes an organization party in the operator's CRM and points the workspace at it", async () => {
    const result = await ensureOperatorParty(client, { userId: "user-actor" });
    createdParties.push(result.partyId);
    expect(result.created).toBe(true);

    const party = await withTenant(
      operator,
      (tx) =>
        tx.query.parties.findFirst({
          where: and(
            eq(schema.parties.tenantId, operator),
            eq(schema.parties.id, result.partyId),
          ),
        }),
      { role: "owner" },
    );
    expect(party?.kind).toBe("organization");
    expect(party?.displayName).toBe("Relationship Client");

    const points = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ kind: schema.partyContactPoints.kind })
          .from(schema.partyContactPoints)
          .where(eq(schema.partyContactPoints.partyId, result.partyId)),
      { role: "owner" },
    );
    expect(points.map((p) => p.kind)).toContain("email");

    const [row] = await withSystem((tx) =>
      tx
        .select({ pointer: schema.tenants.operatorPartyId })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, client)),
    );
    expect(row.pointer).toBe(result.partyId);

    if (crmOn) {
      const [details] = await withTenant(
        operator,
        (tx) =>
          tx
            .select({ source: schema.crmPartyDetails.source })
            .from(schema.crmPartyDetails)
            .where(eq(schema.crmPartyDetails.partyId, result.partyId)),
        { role: "owner" },
      );
      expect(details?.source).toBe("platform");
    }
  });

  it("is idempotent: a linked workspace answers with its party and writes nothing", async () => {
    const again = await ensureOperatorParty(client, { userId: "user-actor" });
    expect(again.created).toBe(false);
    expect(again.partyId).toBe(createdParties[0]);
  });

  it("refuses to make the operator a client of itself", async () => {
    let code: string | null = null;
    try {
      await ensureOperatorParty(operator, { userId: "user-actor" });
    } catch (err) {
      if (err instanceof RelationshipError) code = err.code;
      else throw err;
    }
    expect(code).toBe("IS_OPERATOR");
  });

  it("reads the party back through the operator's context, and null for one that is gone", async () => {
    const view = await readOperatorParty(createdParties[0]);
    expect(view?.displayName).toBe("Relationship Client");
    expect(
      await readOperatorParty("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
