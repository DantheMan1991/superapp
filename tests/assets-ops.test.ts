import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  ASSET_DIMENSION,
  AssetError,
  createAsset,
  disposeAsset,
  getAsset,
  listAssets,
  listChildren,
  listContainerCandidates,
  listKindsInUse,
  listRoots,
  updateAsset,
  type AssetCtx,
} from "../src/packs/assets/ops";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The ops behind the assets pack.
 *
 * `tests/isolation/assets.test.ts` deliberately builds its fixtures under
 * `withSystem`, because that suite certifies what the DATABASE enforces and
 * routing setup through this file would let a bug here make those tests agree
 * with it. The consequence is that the pack's CENTRAL CLAIM — that creating an
 * asset also makes it a cost object — was covered by nothing at all until this
 * file. That is what most of it is about.
 *
 * Tested at the op rather than through the action, because an action's other
 * half is `requireTenant()` and a Clerk session, and what is worth certifying
 * here is the rules rather than the framework.
 */
d("assets ops", () => {
  const STAMP = `assetops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ownerCtx = (): AssetCtx => ({
    tenantId,
    userId: OWNER,
    role: "owner",
  });
  const staffCtx = (): AssetCtx => ({
    tenantId,
    userId: STAFF,
    role: "staff",
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Assets Ops",
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

  // ---- the claim the whole pack rests on -------------------------------

  it("creating an asset makes it a cost object in the same transaction", async () => {
    const asset = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), {
        kind: "equipment",
        name: "Tractor",
        acquisitionCostCents: 2_850_000,
      }),
    );

    const members = await asOwner((tx) =>
      tx
        .select()
        .from(schema.dimensionMembers)
        .where(
          and(
            eq(schema.dimensionMembers.tenantId, tenantId),
            eq(schema.dimensionMembers.dimensionType, ASSET_DIMENSION),
            eq(schema.dimensionMembers.packEntityId, asset.id),
          ),
        ),
    );
    expect(members).toHaveLength(1);
    expect(members[0].displayName).toBe("Tractor");
    expect(members[0].isActive).toBe(true);
  });

  it("keeps 'things are kept here', through create AND update", async () => {
    /**
     * The property `inventory` reads for its location picker. Same round-trip
     * this file already runs for `assetAccountId`, and for the same reason: that
     * field was declared everywhere, sent by the form, written by these ops —
     * and silently dropped by a zod schema that did not name it. A column with
     * no test asserting it survives the boundary is a column waiting to do that
     * again.
     */
    const created = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), {
        kind: "equipment",
        name: "Walk-in cooler",
        isStorageLocation: true,
      }),
    );
    expect(created.isStorageLocation).toBe(true);

    // The default is false: most things a business owns are not places.
    const plain = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "equipment", name: "Post driver" }),
    );
    expect(plain.isStorageLocation).toBe(false);

    const turnedOn = await asOwner((tx) =>
      updateAsset(tx, ownerCtx(), plain.id, { isStorageLocation: true }),
    );
    expect(turnedOn.isStorageLocation).toBe(true);
    const turnedOff = await asOwner((tx) =>
      updateAsset(tx, ownerCtx(), plain.id, { isStorageLocation: false }),
    );
    expect(turnedOff.isStorageLocation).toBe(false);
  });

  it("keeps the account its cost sits in, through create AND update", async () => {
    /**
     * FOUND BY DRIVING, 2026-08-18. "Cost sits in" could not be saved from the
     * UI at all: `assetAccountId` was missing from the action's zod schema, and
     * zod STRIPS what it does not declare — so the form sent it, the boundary
     * dropped it, and this layer (which has always handled it) never saw it.
     *
     * That is the explanation for an anomaly the dossier recorded three days
     * earlier: an asset with 6,706.78 of accumulated depreciation against a cost
     * on no account. Not a column nobody had filled in — a column nobody COULD.
     *
     * This covers the ops half. The boundary is covered by the schema being
     * `.strict()`, which turns the next silently-dropped field into a refusal.
     */
    const account = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .insert(schema.accounts)
        .values({
          tenantId,
          code: "1690",
          name: "Test fixed asset",
          accountType: "asset",
          subtype: "fixed_asset",
        })
        .returning();
      return rows[0].id;
    });

    const created = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), {
        kind: "equipment",
        name: "Costed thing",
        assetAccountId: account,
      }),
    );
    expect(created.assetAccountId).toBe(account);

    const cleared = await asOwner((tx) =>
      updateAsset(tx, ownerCtx(), created.id, { assetAccountId: null }),
    );
    expect(cleared.assetAccountId).toBeNull();

    const reset = await asOwner((tx) =>
      updateAsset(tx, ownerCtx(), created.id, { assetAccountId: account }),
    );
    expect(reset.assetAccountId).toBe(account);
  });

  it("rolls the dimension member back when the asset write fails", async () => {
    // The reason ops take a `Tx` instead of opening their own: if the two could
    // land separately, a cost object could point at a row that never existed.
    const before = await asOwner((tx) =>
      tx.select().from(schema.dimensionMembers),
    );

    await expect(
      asOwner(async (tx) => {
        await createAsset(tx, ownerCtx(), { kind: "vehicle", name: "Truck" });
        // Same transaction, and this violates the name CHECK.
        await tx
          .insert(schema.assets)
          .values({ tenantId, kind: "vehicle", name: "   " });
      }),
    ).rejects.toThrow();

    const after = await asOwner((tx) =>
      tx.select().from(schema.dimensionMembers),
    );
    expect(after).toHaveLength(before.length);
    const names = after.map((m) => m.displayName);
    expect(names).not.toContain("Truck");
  });

  it("renaming an asset renames its cost object", async () => {
    const asset = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "Shed" }),
    );
    await asOwner((tx) =>
      updateAsset(tx, ownerCtx(), asset.id, { name: "Workshop" }),
    );

    const members = await asOwner((tx) =>
      tx
        .select()
        .from(schema.dimensionMembers)
        .where(eq(schema.dimensionMembers.packEntityId, asset.id)),
    );
    // The display name is a COPY, so a rename that skipped the sync would
    // leave every report labelling the asset by its old name.
    expect(members).toHaveLength(1);
    expect(members[0].displayName).toBe("Workshop");
  });

  it("disposal archives the cost object instead of deleting it", async () => {
    const asset = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "equipment", name: "Old baler" }),
    );
    await asOwner((tx) =>
      disposeAsset(tx, ownerCtx(), asset.id, "2026-08-14"),
    );

    const row = await asOwner((tx) => getAsset(tx, tenantId, asset.id));
    expect(row?.status).toBe("disposed");
    expect(row?.disposedOn).toBe("2026-08-14");

    const members = await asOwner((tx) =>
      tx
        .select()
        .from(schema.dimensionMembers)
        .where(eq(schema.dimensionMembers.packEntityId, asset.id)),
    );
    // Archived, NOT removed: an asset that cost money for six years does not
    // stop having done so when it is sold, and every journal line tagged with
    // it must keep reporting.
    expect(members).toHaveLength(1);
    expect(members[0].isActive).toBe(false);
  });

  // ---- the owner gate ---------------------------------------------------

  it("refuses a write from staff", async () => {
    // Chosen (capital is owner territory) and forced from below:
    // upsertDimensionMember calls requireOwnerRole, so a staff-created asset
    // could not sync its cost object and would be invisible to every report.
    await expect(
      asOwner((tx) =>
        createAsset(tx, staffCtx(), { kind: "equipment", name: "Sneaky" }),
      ),
    ).rejects.toThrow(AssetError);

    const rows = await asOwner((tx) => listAssets(tx, tenantId));
    expect(rows.map((r) => r.name)).not.toContain("Sneaky");
  });

  // ---- containment ------------------------------------------------------

  it("nests an asset inside another and reads it back", async () => {
    const garage = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "Garage" }),
    );
    const freezer = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), {
        kind: "equipment",
        name: "Chest freezer",
        parentId: garage.id,
      }),
    );

    const kids = await asOwner((tx) => listChildren(tx, tenantId, garage.id));
    expect(kids.map((k) => k.id)).toEqual([freezer.id]);

    const roots = await asOwner((tx) => listRoots(tx, tenantId));
    expect(roots.map((r) => r.id)).toContain(garage.id);
    expect(roots.map((r) => r.id)).not.toContain(freezer.id);
  });

  it("refuses a parent that does not exist", async () => {
    await expect(
      asOwner((tx) =>
        createAsset(tx, ownerCtx(), {
          kind: "equipment",
          name: "Orphan",
          parentId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).rejects.toThrow(AssetError);
  });

  it("refuses a two-step containment cycle", async () => {
    // The assets_parent_not_self CHECK catches only the one-row case; a CHECK
    // cannot see other rows. Left unguarded this would make descendantIds loop
    // forever, so the guard lives in ops.ts and this is what proves it.
    const outer = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "Barn" }),
    );
    const inner = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), {
        kind: "fixture",
        name: "Stall",
        parentId: outer.id,
      }),
    );

    await expect(
      asOwner((tx) =>
        updateAsset(tx, ownerCtx(), outer.id, { parentId: inner.id }),
      ),
    ).rejects.toThrow(AssetError);
  });

  it("refuses a deeper cycle too", async () => {
    const a = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "A" }),
    );
    const b = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "B", parentId: a.id }),
    );
    const c = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "C", parentId: b.id }),
    );

    await expect(
      asOwner((tx) => updateAsset(tx, ownerCtx(), a.id, { parentId: c.id })),
    ).rejects.toThrow(AssetError);
  });

  it("excludes an asset and its descendants from its own container picker", async () => {
    const top = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "building", name: "Top" }),
    );
    const mid = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), {
        kind: "building",
        name: "Mid",
        parentId: top.id,
      }),
    );

    const options = await asOwner((tx) =>
      listContainerCandidates(tx, tenantId, top.id),
    );
    const ids = options.map((o) => o.id);
    expect(ids).not.toContain(top.id);
    expect(ids).not.toContain(mid.id);
  });

  // ---- the open taxonomy ------------------------------------------------

  it("accepts a kind nobody anticipated", async () => {
    const pen = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "chicken_tractor", name: "Pen 3" }),
    );
    expect(pen.kind).toBe("chicken_tractor");
  });

  it("normalises a kind rather than rejecting a reasonable one", async () => {
    const row = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "  EQUIPMENT  ", name: "Mower" }),
    );
    expect(row.kind).toBe("equipment");
  });

  it("refuses a kind that would break querying", async () => {
    await expect(
      asOwner((tx) =>
        createAsset(tx, ownerCtx(), { kind: "chicken tractor", name: "Pen 4" }),
      ),
    ).rejects.toThrow(AssetError);
  });

  it("counts kinds in use", async () => {
    const kinds = await asOwner((tx) => listKindsInUse(tx, tenantId));
    const byKind = Object.fromEntries(kinds.map((k) => [k.kind, k.count]));
    expect(byKind.chicken_tractor).toBe(1);
    expect(byKind.building).toBeGreaterThan(0);
  });

  // ---- cost -------------------------------------------------------------

  it("keeps an unknown cost null rather than zero", async () => {
    const row = await asOwner((tx) =>
      createAsset(tx, ownerCtx(), { kind: "fixture", name: "Inherited bench" }),
    );
    // "Cost unknown" and "cost nothing" are different facts, and depreciation
    // needs to tell them apart.
    expect(row.acquisitionCostCents).toBeNull();
  });

  it("filters by status so disposed assets stay out of the list", async () => {
    const active = await asOwner((tx) =>
      listAssets(tx, tenantId, { status: "active" }),
    );
    expect(active.map((a) => a.name)).not.toContain("Old baler");

    const all = await asOwner((tx) => listAssets(tx, tenantId));
    expect(all.map((a) => a.name)).toContain("Old baler");
  });
});
