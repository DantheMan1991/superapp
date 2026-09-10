import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  attachDiscovery,
  createDiscovery,
  deleteDiscovery,
  getDiscovery,
  listDiscoveries,
  loadDiscoveryBusiness,
  messagesOf,
  saveMessages,
  saveReport,
  setDiscoveryStatus,
} from "../src/packs/professional-services/discovery-ops";
import { EngagementError, type EngagementCtx } from "../src/packs/professional-services/ops";
import { isBriefed } from "../src/packs/professional-services/core/discovery-prompt";
import { seedParty } from "./isolation/_shared";

/**
 * Discovery in the tenant's own context (back-office slice 7d).
 *
 * The claim the slice rests on: **staff can run discovery**. The same rows
 * were reachable only behind `requireSuperAdmin()`, so somebody doing sales
 * had to be given the god view of every client on the platform to write down
 * what a prospect said. Nothing about the data changed for that to stop being
 * true — which is why there is no migration — so what is worth certifying is
 * the guard.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("discovery ops", () => {
  const STAMP = `disc-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId = "";
  let clientId = "";
  let otherClientId = "";

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: STAFF });

  const ownerCtx = (): EngagementCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): EngagementCtx => ({ tenantId, userId: STAFF, role: "staff" });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Hollis & Co",
          slug: `${STAMP}-slug`,
          industry: "agency",
        })
        .returning({ id: schema.tenants.id });
      tenantId = tenant.id;
      clientId = await seedParty(tx, tenantId, "Baxter Plumbing");
      otherClientId = await seedParty(tx, tenantId, "Kerr Joinery");
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  // ---- the claim the slice rests on --------------------------------------

  it("STAFF can start a discovery — that is the whole point of the move", async () => {
    const audit = await asStaff((tx) =>
      createDiscovery(tx, staffCtx(), {
        partyId: clientId,
        context: "Referred by the co-op. Quotes take all weekend.",
      }),
    );
    expect(audit.partyId).toBe(clientId);
    // The name is snapshotted so the copilot's context survives a rename.
    expect(audit.businessName).toBe("Baxter Plumbing");
    expect(audit.context).toContain("Quotes take all weekend");
    expect(audit.status).toBe("open");
  });

  it("staff can hold the conversation and write the report", async () => {
    const audit = await asStaff((tx) =>
      createDiscovery(tx, staffCtx(), { partyId: clientId }),
    );
    await asStaff((tx) =>
      saveMessages(tx, staffCtx(), audit.id, [
        { role: "user", content: "He loses one job in three." },
        { role: "assistant", content: "That is the number to price against." },
      ]),
    );
    await asStaff((tx) => saveReport(tx, staffCtx(), audit.id, "# Business Health Check"));

    const after = await asStaff((tx) => getDiscovery(tx, tenantId, audit.id));
    expect(messagesOf(after!)).toHaveLength(2);
    expect(after!.report).toContain("Health Check");
    // Writing the report is what moves it on.
    expect(after!.status).toBe("report_ready");
  });

  it("staff can move it back to open", async () => {
    const audit = await asStaff((tx) => createDiscovery(tx, staffCtx(), { partyId: clientId }));
    await asStaff((tx) =>
      setDiscoveryStatus(tx, staffCtx(), { id: audit.id, status: "report_ready" }),
    );
    await asStaff((tx) => setDiscoveryStatus(tx, staffCtx(), { id: audit.id, status: "open" }));
    const after = await asStaff((tx) => getDiscovery(tx, tenantId, audit.id));
    expect(after!.status).toBe("open");
  });

  // ---- what staff may NOT do ---------------------------------------------

  it("only an owner deletes one — it destroys a conversation somebody had", async () => {
    const audit = await asOwner((tx) => createDiscovery(tx, ownerCtx(), { partyId: clientId }));
    await expect(asStaff((tx) => deleteDiscovery(tx, staffCtx(), audit.id))).rejects.toThrow(
      EngagementError,
    );
    const gone = await asOwner((tx) => deleteDiscovery(tx, ownerCtx(), audit.id));
    expect(gone.id).toBe(audit.id);
    expect(await asOwner((tx) => getDiscovery(tx, tenantId, audit.id))).toBeNull();
  });

  // ---- attaching ---------------------------------------------------------

  it("a record with no business shows its own snapshot, and can be attached", async () => {
    // The shape a public health check leaves behind: a conversation about a
    // business the CRM did not know yet.
    const [orphan] = await withSystem((tx) =>
      tx
        .insert(schema.audits)
        .values({
          tenantId,
          partyId: null,
          businessName: "Someone From The Website",
          industry: "general",
          source: "self_serve",
        })
        .returning(),
    );

    const before = await asStaff((tx) => listDiscoveries(tx, tenantId));
    const row = before.find((r) => r.audit.id === orphan.id)!;
    expect(row.audit.partyId).toBeNull();
    expect(row.clientName).toBe("Someone From The Website");

    await asStaff((tx) =>
      attachDiscovery(tx, staffCtx(), { id: orphan.id, partyId: otherClientId }),
    );
    const after = await asStaff((tx) => listDiscoveries(tx, tenantId));
    const attached = after.find((r) => r.audit.id === orphan.id)!;
    // Once attached the list follows the CRM's current name, not the snapshot.
    expect(attached.clientName).toBe("Kerr Joinery");
  });

  it("refuses a business that is not in this workspace's CRM", async () => {
    const stranger = await withSystem(async (tx) => {
      const [other] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-other`,
          name: "Somebody Else",
          slug: `${STAMP}-other`,
        })
        .returning({ id: schema.tenants.id });
      const party = await seedParty(tx, other.id, "Not Ours");
      return { tenantId: other.id, party };
    });
    await expect(
      asStaff((tx) => createDiscovery(tx, staffCtx(), { partyId: stranger.party })),
    ).rejects.toThrow(EngagementError);
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, stranger.tenantId)),
    );
  });

  // ---- what the copilot is told ------------------------------------------

  it("is not briefed until somebody fills the brief in, and then it is", async () => {
    const bare = await asStaff((tx) =>
      loadDiscoveryBusiness(tx, tenantId, "agency", "Hollis & Co"),
    );
    expect(bare.name).toBe("Hollis & Co");
    expect(isBriefed(bare)).toBe(false);

    // The brief is Layer 3 — one company's own tailoring — so it lives on the
    // tenant's module row, which only a superadmin may write.
    await withSystem((tx) =>
      tx
        .insert(schema.tenantModules)
        .values({
          tenantId,
          moduleId: "professional-services",
          enabled: true,
          config: { discovery: { what: "We run the back office for small builders." } },
        })
        .onConflictDoUpdate({
          target: [schema.tenantModules.tenantId, schema.tenantModules.moduleId],
          set: { config: { discovery: { what: "We run the back office for small builders." } } },
        }),
    );

    const briefed = await asStaff((tx) =>
      loadDiscoveryBusiness(tx, tenantId, "agency", "Hollis & Co"),
    );
    expect(isBriefed(briefed)).toBe(true);
    expect(briefed.what).toContain("small builders");
  });
});
