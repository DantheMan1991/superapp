import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  ENTERPRISE_DIMENSION,
  EnterpriseError,
  archiveEnterprise,
  createEnterprise,
  enterpriseMemberIds,
  listEnterprises,
  restoreEnterprise,
  updateEnterprise,
} from "../src/lib/enterprises";
import { listDimensionMembers } from "../src/modules/accounting/core";
import type { LedgerCtx } from "../src/modules/accounting/core";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The enterprise subsystem, and **above all the dimension mirror.**
 *
 * `tests/isolation/enterprises.test.ts` builds its fixtures under `withSystem`
 * on purpose, so a bug in `src/lib/enterprises/` cannot make that suite agree
 * with it. The consequence is that the mirror — the thing that makes an
 * enterprise reportable at all — is covered by nothing except this file.
 */
d("enterprise subsystem", () => {
  const STAMP = `entops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ownerCtx = (): LedgerCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): LedgerCtx => ({ tenantId, userId: STAFF, role: "staff" });

  const members = () =>
    asOwner((tx) => listDimensionMembers(tx, tenantId, ENTERPRISE_DIMENSION));

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Enterprise Ops",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("MIRRORS INTO dimension_members IN THE SAME TRANSACTION", async () => {
    // The whole reason the table exists at Layer 0 rather than in a pack: this
    // mirror is what makes "Enterprise" appear in the P&L's grouping picker,
    // which is built from whatever types are present rather than from a list in
    // code. No report was written to make that happen.
    const broilers = await asOwner((tx) =>
      createEnterprise(tx, ownerCtx(), { name: "Broilers", kind: "livestock" }),
    );
    const mine = (await members()).filter((m) => m.packEntityId === broilers.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].displayName).toBe("Broilers");
    expect(mine[0].isActive).toBe(true);
  });

  it("derives a handle and never asks anybody for one", async () => {
    const eggs = await asOwner((tx) =>
      createEnterprise(tx, ownerCtx(), { name: "Laying hens & eggs" }),
    );
    expect(eggs.slug).toBe("laying_hens_eggs");
    // Unstated kind falls to `other` rather than to a guess.
    expect(eggs.kind).toBe("other");
  });

  it("A RENAME MOVES THE MEMBER'S NAME AND LEAVES THE HANDLE ALONE", async () => {
    /**
     * Two rules in one test because they are two halves of one decision. The
     * display name is a COPY that every report reads, so a rename that skipped
     * the re-sync would label the business by a name it no longer uses. The
     * slug is what anything holding a reference kept, so re-deriving it would
     * break those to keep a handle nobody reads pretty.
     */
    const pigs = await asOwner((tx) =>
      createEnterprise(tx, ownerCtx(), { name: "Pigs" }),
    );
    expect(pigs.slug).toBe("pigs");

    const renamed = await asOwner((tx) =>
      updateEnterprise(tx, ownerCtx(), pigs.id, { name: "Weaner pigs" }),
    );
    expect(renamed.name).toBe("Weaner pigs");
    expect(renamed.slug).toBe("pigs");

    const member = (await members()).find((m) => m.packEntityId === pigs.id);
    expect(member?.displayName).toBe("Weaner pigs");
  });

  it("REFUSES A DUPLICATE NAME, case-insensitively", async () => {
    // "Broilers" and "broilers" are the same line of business to everybody
    // except a byte comparison, and two rows reading the same makes the
    // person's own list unreadable.
    await expect(
      asOwner((tx) => createEnterprise(tx, ownerCtx(), { name: "broilers" })),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("refuses a name with no handle in it rather than inventing one", async () => {
    await expect(
      asOwner((tx) => createEnterprise(tx, ownerCtx(), { name: "🐔" })),
    ).rejects.toMatchObject({ code: "INVALID_NAME" });
  });

  it("ARCHIVES THE MEMBER RATHER THAN DELETING IT, so last year still reports", async () => {
    /**
     * `archiveDimensionMember`'s own comment: *archived members stop being
     * taggable; existing tags keep reporting*. A business that ran pigs for two
     * years and stopped still has two years of pig costs, and a report over
     * last year has to keep showing them.
     */
    const sheep = await asOwner((tx) =>
      createEnterprise(tx, ownerCtx(), { name: "Sheep" }),
    );
    await asOwner((tx) => archiveEnterprise(tx, ownerCtx(), sheep.id));

    const member = (await members()).find((m) => m.packEntityId === sheep.id);
    expect(member).toBeDefined();
    expect(member!.isActive).toBe(false);

    const active = await asOwner((tx) =>
      listEnterprises(tx, tenantId, { status: "active" }),
    );
    expect(active.map((e) => e.id)).not.toContain(sheep.id);
  });

  it("puts one back, member and all", async () => {
    const goats = await asOwner((tx) =>
      createEnterprise(tx, ownerCtx(), { name: "Goats" }),
    );
    await asOwner((tx) => archiveEnterprise(tx, ownerCtx(), goats.id));
    await asOwner((tx) => restoreEnterprise(tx, ownerCtx(), goats.id));

    const member = (await members()).find((m) => m.packEntityId === goats.id);
    expect(member?.isActive).toBe(true);
    const restored = await asOwner((tx) =>
      listEnterprises(tx, tenantId, { status: "active" }),
    );
    expect(restored.map((e) => e.id)).toContain(goats.id);
  });

  it("KEEPS WRITES WITH THE OWNER, and it is core's check doing it", async () => {
    // Not a role check in `src/lib/enterprises/` — `upsertDimensionMember`
    // calls `requireOwnerRole`, and the mirror is unconditional, so a staff
    // write cannot complete. The action layer refuses first so a person gets a
    // redirect rather than this; that leaves this as the backstop it was
    // written to be.
    await expect(
      withTenant(
        tenantId,
        (tx) => createEnterprise(tx, staffCtx(), { name: "Sneaky" }),
        { role: "staff", userId: STAFF },
      ),
    ).rejects.toThrow();

    const none = await asOwner((tx) => listEnterprises(tx, tenantId));
    expect(none.map((e) => e.name)).not.toContain("Sneaky");
  });

  it("translates enterprise ids to MEMBER ids, which is what a journal line needs", async () => {
    // The lookup every posting path will use in slice 3. It lives here rather
    // than in each pack because a pack doing it itself would be reaching into
    // core's tables.
    const beef = await asOwner((tx) =>
      createEnterprise(tx, ownerCtx(), { name: "Beef" }),
    );
    const byEnterprise = await asOwner((tx) =>
      enterpriseMemberIds(tx, tenantId),
    );
    const memberId = byEnterprise.get(beef.id);
    expect(memberId).toBeDefined();

    const member = (await members()).find((m) => m.id === memberId);
    expect(member?.packEntityId).toBe(beef.id);
  });

  it("throws EnterpriseError rather than a database error for a missing row", async () => {
    await expect(
      asOwner((tx) =>
        updateEnterprise(
          tx,
          ownerCtx(),
          "00000000-0000-0000-0000-000000000000",
          { name: "Ghost" },
        ),
      ),
    ).rejects.toBeInstanceOf(EnterpriseError);
  });
});
