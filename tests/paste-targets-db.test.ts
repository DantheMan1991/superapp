import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { resetPasteCooldown, type ProposeModel } from "../src/lib/paste-targets/model";
import {
  enabledPasteTarget,
  friendlyPasteError,
  pasteTargetBySlug,
  proposeForTarget,
  saveForTarget,
} from "../src/lib/paste-targets/resolve";
import type { PasteCtx, PasteRow } from "../src/lib/paste-targets/types";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { listCustomers } from "../src/modules/accounting/invoicing/customers";
import { listVendors } from "../src/modules/accounting/payables/vendors";
import { listAssets } from "../src/packs/assets/ops";
import { listItems } from "../src/packs/inventory/ops";
import { createParcel, listZones } from "../src/packs/land/ops";
import { getLivestockLot, listLivestockLots } from "../src/packs/livestock/ops";
import { createChannel, pricesForChannel } from "../src/packs/retail/ops";

/**
 * The four paste targets, run as an owner through real RLS with the model
 * replaced by a function that answers what a test says the list held.
 *
 * What this file certifies: a target whose module is off does not exist; a
 * proposal writes nothing and a save writes only what it is given, through
 * the module's own verb, so a pasted vendor has a party and a pasted animal
 * has a tag; a second reading names what is already here; a cell the model
 * could not place comes back as a hint and holds the save until it is fixed;
 * a row the module refuses stops the whole batch, named, with nothing
 * written; an animal's dam three rows up is her dam; and the pack's own
 * rules surface in the pack's own words.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const model =
  (rows: Array<Record<string, unknown>>): ProposeModel =>
  async () => ({ rows });

d("paste targets", () => {
  const STAMP = `paste-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;

  const ctx = (role: PasteCtx["role"] = "owner"): PasteCtx => ({
    tenantId,
    userId: role === "owner" ? OWNER : STAFF,
    role,
    industry: "homestead-farm",
  });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const propose = (slug: string, rows: Array<Record<string, unknown>>, role: PasteCtx["role"] = "owner") => {
    resetPasteCooldown(tenantId);
    return proposeForTarget(ctx(role), pasteTargetBySlug(slug)!, { text: "the list", image: null }, model(rows));
  };
  const save = (slug: string, rows: PasteRow[], role: PasteCtx["role"] = "owner") =>
    saveForTarget(ctx(role), pasteTargetBySlug(slug)!, rows);
  const failing = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work();
    } catch (err) {
      return friendlyPasteError(err);
    }
    throw new Error("expected a refusal");
  };

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Paste Farm", slug: STAMP, industry: "homestead-farm" })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values([
          { tenantId, moduleId: "accounting", enabled: true },
          { tenantId, moduleId: "inventory", enabled: true },
          { tenantId, moduleId: "assets", enabled: true },
          { tenantId, moduleId: "land", enabled: true },
          { tenantId, moduleId: "retail", enabled: true },
          // Off to begin with: the first test is that the target does not exist.
          { tenantId, moduleId: "livestock", enabled: false },
        ])
        .onConflictDoNothing();
    });
    await asOwner((tx) => provisionAccounting(tx, tenantId));
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("a target exists only when its module is on, and an unknown slug is refused", async () => {
    expect(pasteTargetBySlug("scheduling.calendars")).toBeNull();
    await expect(enabledPasteTarget(tenantId, "scheduling.calendars")).rejects.toMatchObject({
      code: "TARGET_UNKNOWN",
    });
    await expect(enabledPasteTarget(tenantId, "livestock.animals")).rejects.toMatchObject({
      code: "TARGET_OFF",
    });
    await withSystem((tx) =>
      tx
        .update(schema.tenantModules)
        .set({ enabled: true })
        .where(
          and(eq(schema.tenantModules.tenantId, tenantId), eq(schema.tenantModules.moduleId, "livestock")),
        ),
    );
    expect((await enabledPasteTarget(tenantId, "livestock.animals")).slug).toBe("livestock.animals");
  });

  it("vendors: a proposal writes nothing, a save goes through createVendor, and the second reading names what is here", async () => {
    const proposal = await propose("accounting.vendors", [
      { name: "Tractor Supply Co.", email: "ap@tsc.example", phone: null, address: null, notes: "feed" },
      { name: "   ", email: null, phone: null, address: null, notes: null },
      { name: "Rural King", phone: "555-0100" },
    ]);
    expect(proposal.fields.map((f) => f.key)).toEqual(["name", "email", "phone", "address", "notes"]);
    expect(proposal.rows.map((r) => r.values.name)).toEqual(["Tractor Supply Co.", "Rural King"]);
    expect(proposal.rows.every((r) => r.duplicateOf === null)).toBe(true);
    expect(await asOwner((tx) => listVendors(tx, tenantId, { includeInactive: true }))).toHaveLength(0);

    const saved = await save("accounting.vendors", proposal.rows.map((r) => r.values));
    expect(saved.map((s) => s.label)).toEqual(["Tractor Supply Co.", "Rural King"]);

    const vendors = await asOwner((tx) => listVendors(tx, tenantId, { includeInactive: true }));
    expect(vendors.map((v) => v.name).sort()).toEqual(["Rural King", "Tractor Supply Co."]);
    // The party is born with the vendor, exactly as the form makes one.
    const party = await asOwner((tx) =>
      tx.query.parties.findFirst({ where: eq(schema.parties.id, vendors[0].partyId) }),
    );
    expect(party).toBeTruthy();
    // Audited as counts, never as names.
    const audit = await withSystem((tx) =>
      tx.query.auditLog.findFirst({
        where: and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "paste.rows_saved")),
      }),
    );
    expect(audit?.meta).toEqual({ target: "accounting.vendors", rows: 2 });

    const again = await propose("accounting.vendors", [
      { name: "tractor  supply co" },
      { name: "Orscheln Farm & Home" },
    ]);
    expect(again.rows.map((r) => r.duplicateOf)).toEqual(["Tractor Supply Co.", null]);
  });

  it("a row without its required field stops the batch, named, before anything is written", async () => {
    const message = await failing(() =>
      save("accounting.vendors", [
        { name: "Orscheln Farm & Home", email: null, phone: null, address: null, notes: null },
        { name: null, email: "nobody@example.com", phone: null, address: null, notes: null },
      ]),
    );
    expect(message).toBe("Row 2: Name is missing.");
    expect(await asOwner((tx) => listVendors(tx, tenantId, { includeInactive: true }))).toHaveLength(2);

    expect(await failing(() => save("accounting.vendors", []))).toBe("Nothing is ticked.");
  });

  it("customers: the same five fields, saved through createCustomer", async () => {
    const proposal = await propose("accounting.customers", [
      { name: "Maple Street Market", email: "orders@maple.example", address: "12 Maple St" },
    ]);
    const saved = await save("accounting.customers", proposal.rows.map((r) => r.values));
    expect(saved.map((s) => s.label)).toEqual(["Maple Street Market"]);
    const customers = await asOwner((tx) => listCustomers(tx, tenantId));
    expect(customers.map((c) => c.name)).toEqual(["Maple Street Market"]);
    expect(customers[0].address).toBe("12 Maple St");
  });

  it("kinds of stock: the choices are the pack's units and kinds, a cell it could not place is a hint, and staff are refused in the pack's words", async () => {
    const proposal = await propose("inventory.items", [
      { name: "Layer pellets", kind: "Feed", unit: "pounds (lb)", purchaseUnit: "bag", purchaseUnitQty: "50", storage: "Dry" },
      { name: "Eggs", kind: "Egg", unit: "dozen" },
      { name: "Fence staples", kind: "Supply", unit: "boxes" },
    ]);
    const unit = proposal.fields.find((f) => f.key === "unit")!;
    expect(unit.required).toBe(true);
    expect(unit.choices!.map((c) => c.value)).toEqual(expect.arrayContaining(["lb", "each", "dozen", "head", "pkg"]));
    const kind = proposal.fields.find((f) => f.key === "kind")!;
    expect(kind.choices!.map((c) => c.value)).toEqual(expect.arrayContaining(["feed", "egg", "supply", "livestock"]));

    expect(proposal.rows[0].values).toMatchObject({
      name: "Layer pellets",
      kind: "feed",
      unit: "lb",
      purchaseUnit: "bag",
      purchaseUnitQty: 50,
      storage: "dry",
    });
    expect(proposal.rows[1].values).toMatchObject({ kind: "egg", unit: "dozen" });
    expect(proposal.rows[2].values.unit).toBeNull();
    expect(proposal.rows[2].hints).toEqual({ unit: "boxes" });

    // Kept with the unit still blank: refused before a row is written.
    const message = await failing(() => save("inventory.items", proposal.rows.map((r) => r.values)));
    expect(message).toBe("Row 3 (Fence staples): Counted in is missing.");
    expect(await asOwner((tx) => listItems(tx, tenantId))).toHaveLength(0);

    const rows = proposal.rows.map((r) => r.values);
    rows[2] = { ...rows[2], unit: "each" };
    expect(await save("inventory.items", rows)).toHaveLength(3);
    const items = await asOwner((tx) => listItems(tx, tenantId));
    const pellets = items.find((i) => i.name === "Layer pellets")!;
    expect(pellets).toMatchObject({ itemKind: "feed", stockingUnit: "lb", purchaseUnit: "bag", storageRequirement: "dry" });
    expect(Number(pellets.purchaseUnitQty)).toBe(50);

    // Creating a kind of stock is an owner's decision; the pack says so, and
    // this dialog does not argue.
    const refused = await failing(() => save("inventory.items", [{ name: "Bedding", unit: "lb" }], "staff"));
    expect(refused).toBe("Row 1 (Bedding): only an owner can change this");
  });

  it("animals: individuals and a group, one stock line for three rows, a dam three rows up, and a tag told from a name", async () => {
    const proposal = await propose("livestock.animals", [
      { name: "Bluebell", tagKind: "Name", species: "Cattle", sex: "Female", breed: "Angus", bornOn: "2021-04-02", stockLine: "Beef cattle" },
      { name: "Rosie", species: "cattle", sex: "female", bornOn: "2024-03-01", dam: "Bluebell", stockLine: "Beef cattle" },
      { name: "840 9917", species: "Cattle", sex: "Male", dam: "bluebell", stockLine: "beef cattle" },
      { name: "Spring broilers", species: "Poultry", head: 25, arrivedOn: "2026-05-01", stockLine: "Broilers" },
    ]);
    const species = proposal.fields.find((f) => f.key === "species")!;
    expect(species.kind).toBe("choice");
    expect(species.choices!.map((c) => c.value)).toEqual(expect.arrayContaining(["cattle", "swine", "poultry"]));
    expect(proposal.rows.map((r) => r.values.species)).toEqual(["cattle", "cattle", "cattle", "poultry"]);
    expect(proposal.rows[0].values.tagKind).toBe("name");
    expect(proposal.rows[1].values.sex).toBe("female");
    expect(proposal.rows[3].values.head).toBe(25);

    const saved = await save("livestock.animals", proposal.rows.map((r) => r.values));
    expect(saved.map((s) => s.label)).toEqual(["Bluebell", "Rosie", "840 9917", "Spring broilers"]);
    const byLabel = new Map(saved.map((s) => [s.label, s.id]));

    // Three rows said "Beef cattle" three ways; one line was made.
    const items = await asOwner((tx) => listItems(tx, tenantId));
    expect(
      items.filter((i) => i.stockingUnit === "head").map((i) => i.name).sort(),
    ).toEqual(["Beef cattle", "Broilers"]);
    expect(await asOwner((tx) => listLivestockLots(tx, tenantId))).toHaveLength(4);

    const rosie = await asOwner((tx) => getLivestockLot(tx, tenantId, byLabel.get("Rosie")!));
    expect(rosie).toMatchObject({ recordKind: "animal", damLotId: byLabel.get("Bluebell"), bornOn: "2024-03-01" });
    const tagged = await asOwner((tx) => getLivestockLot(tx, tenantId, byLabel.get("840 9917")!));
    expect(tagged?.damLotId).toBe(byLabel.get("Bluebell"));
    const tags = await asOwner((tx) =>
      tx.query.livestockIdentifiers.findMany({
        where: and(
          eq(schema.livestockIdentifiers.tenantId, tenantId),
          eq(schema.livestockIdentifiers.livestockLotId, byLabel.get("840 9917")!),
        ),
      }),
    );
    expect(tags.map((t) => [t.identifierKind, t.value])).toEqual([["visual", "840 9917"]]);
    const group = await asOwner((tx) => getLivestockLot(tx, tenantId, byLabel.get("Spring broilers")!));
    expect(group?.recordKind).toBe("lot");

    const again = await propose("livestock.animals", [
      { name: "bluebell", species: "Cattle" },
      { name: "Daisy", species: "Cattle" },
    ]);
    expect(again.rows.map((r) => r.duplicateOf)).toEqual(["Bluebell", null]);
  });

  it("a dam nobody has is a refusal that names the row, and the pack's own rules surface the same way", async () => {
    const missing = await failing(() =>
      save("livestock.animals", [{ name: "Clover", species: "cattle", sex: "female", dam: "Marigold" }]),
    );
    expect(missing).toBe(
      "Row 1 (Clover): its dam “Marigold” is not an animal here or in this list. Blank it, or add her.",
    );
    expect(await asOwner((tx) => listLivestockLots(tx, tenantId))).toHaveLength(4);

    // A dam that is recorded male: the pack refuses, in its words, row named.
    const contradiction = await failing(() =>
      save("livestock.animals", [{ name: "Clover", species: "cattle", sex: "female", dam: "840 9917" }]),
    );
    expect(contradiction).toMatch(/^Row 1 \(Clover\): /);
    expect(await asOwner((tx) => listLivestockLots(tx, tenantId))).toHaveLength(4);
  });

  it("equipment and buildings: the pack's kinds, dollars into cents, and a place is a place", async () => {
    const proposal = await propose("assets.assets", [
      { name: "Chest freezer (garage)", kind: "Equipment", keeps: "Yes", cost: "450" },
      { name: "North barn", kind: "Building", keeps: "yes", acquired: "2015-06-01" },
      { name: "Kubota L3901", kind: "Equipment", identifier: "KL3901-0042", cost: "$18,500", keeps: "No" },
    ]);
    const kind = proposal.fields.find((f) => f.key === "kind")!;
    expect(kind.choices!.map((c) => c.value)).toEqual(
      expect.arrayContaining(["building", "equipment", "vehicle"]),
    );
    expect(proposal.rows.map((r) => [r.values.keeps, r.values.cost])).toEqual([
      ["yes", 450],
      ["yes", null],
      ["no", 18500],
    ]);

    expect(await save("assets.assets", proposal.rows.map((r) => r.values))).toHaveLength(3);
    const assets = await asOwner((tx) => listAssets(tx, tenantId));
    expect(assets.find((a) => a.name === "Chest freezer (garage)")).toMatchObject({
      kind: "equipment",
      isStorageLocation: true,
      acquisitionCostCents: 45000,
    });
    expect(assets.find((a) => a.name === "North barn")).toMatchObject({
      kind: "building",
      isStorageLocation: true,
      acquiredOn: "2015-06-01",
      acquisitionCostCents: null,
    });
    expect(assets.find((a) => a.name === "Kubota L3901")).toMatchObject({
      isStorageLocation: false,
      identifier: "KL3901-0042",
      acquisitionCostCents: 1850000,
    });

    const again = await propose("assets.assets", [{ name: "north barn" }]);
    expect(again.rows[0].duplicateOf).toBe("North barn");
  });

  it("paddocks: blocked until a parcel exists, the only parcel used when blank, and a choice once there are two", async () => {
    expect(await failing(() => propose("land.paddocks", [{ name: "North 40" }]))).toBe(
      "Add a parcel first, so a paddock has somewhere to be.",
    );

    const home = await asOwner((tx) => createParcel(tx, ctx(), { name: "Home place", areaAcres: 80 }));
    const proposal = await propose("land.paddocks", [
      { name: "North 40", acres: "38" },
      { name: "Creek field", acres: "12.5", parcel: "Home place" },
    ]);
    expect(proposal.fields.find((f) => f.key === "parcel")!.required).toBe(false);
    expect(proposal.rows.map((r) => r.values.parcel)).toEqual([null, home.id]);
    expect(await save("land.paddocks", proposal.rows.map((r) => r.values))).toHaveLength(2);
    const zones = await asOwner((tx) => listZones(tx, tenantId));
    expect(zones.map((z) => [z.name, z.parcelId, Number(z.areaAcres)]).sort()).toEqual([
      ["Creek field", home.id, 12.5],
      ["North 40", home.id, 38],
    ]);

    // A second parcel: the column is now required, and a parcel the list
    // names that is not one of them comes back as the words beside an empty
    // cell, which holds the save.
    await asOwner((tx) => createParcel(tx, ctx(), { name: "Back forty" }));
    const two = await propose("land.paddocks", [
      { name: "north 40" },
      { name: "Pen 3", parcel: "the back 40" },
    ]);
    expect(two.fields.find((f) => f.key === "parcel")!.required).toBe(true);
    expect(two.rows[0].duplicateOf).toBe("North 40");
    expect(two.rows[1].values.parcel).toBeNull();
    expect(two.rows[1].hints.parcel).toBe("the back 40");
    expect(await failing(() => save("land.paddocks", [two.rows[1].values]))).toBe(
      "Row 1 (Pen 3): Parcel is missing.",
    );
    expect(await asOwner((tx) => listZones(tx, tenantId))).toHaveLength(2);
  });

  it("prices: blocked with nowhere to sell, item and place by label, dollars into cents, and the pack's own refusal per pound", async () => {
    expect(await failing(() => propose("retail.prices", [{ item: "Eggs", price: "6" }]))).toBe(
      "Add somewhere to sell first.",
    );

    const market = await asOwner((tx) => createChannel(tx, ctx(), { name: "Saturday market" }));
    const proposal = await propose("retail.prices", [
      { item: "Eggs", price: "6", per: "Each" },
      { item: "eggs", price: "$5.50", from: "2026-10-01" },
      { item: "Goat milk soap", price: "7" },
    ]);
    expect(proposal.fields.find((f) => f.key === "channel")!.required).toBe(false);
    expect(proposal.rows[0].values).toMatchObject({ price: 6, per: "unit", channel: null });
    expect(proposal.rows[1].values).toMatchObject({ price: 5.5, from: "2026-10-01" });
    expect(proposal.rows[0].values.item).toBe(proposal.rows[1].values.item);
    // Not something the farm holds: the words stay, the cell is empty.
    expect(proposal.rows[2].values.item).toBeNull();
    expect(proposal.rows[2].hints.item).toBe("Goat milk soap");
    // A price change is a new row by design, so nothing is ever a duplicate.
    expect(proposal.rows.every((r) => r.duplicateOf === null)).toBe(true);

    expect(await failing(() => save("retail.prices", proposal.rows.map((r) => r.values)))).toBe(
      "Row 3: Item is missing.",
    );
    expect(await save("retail.prices", proposal.rows.slice(0, 2).map((r) => r.values))).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    const prices = await asOwner((tx) => pricesForChannel(tx, tenantId, market.id));
    expect(prices.map((p) => [p.priceCents, p.effectiveFrom, p.priceBasis]).sort()).toEqual(
      [
        [550, "2026-10-01", "unit"],
        [600, today, "unit"],
      ].sort(),
    );

    // Per pound for something already measured in pounds: the pack's rule,
    // in the pack's words, and nothing written.
    const pellets = (await asOwner((tx) => listItems(tx, tenantId))).find((i) => i.name === "Layer pellets")!;
    const refused = await failing(() => save("retail.prices", [{ item: pellets.id, price: 0.45, per: "lb" }]));
    expect(refused).toMatch(/^Row 1: /);
    expect(await asOwner((tx) => pricesForChannel(tx, tenantId, market.id))).toHaveLength(2);
  });
});
