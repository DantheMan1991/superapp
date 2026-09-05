import { describe, expect, it } from "vitest";
import { blockKey, blockLabel, blockSectionsOf, defaultConfig, filterCatalog, newBlockSection, packOfKind } from "../src/lib/site-blocks/core";
import type { BlockCatalogEntry } from "../src/lib/site-blocks/types";
import { sectionSummary } from "../src/lib/sites/pages";
import { PageContentSchema, SectionSchema } from "../src/lib/sites/schema";
import { parsePriceBlockConfig, presentPriceList, priceBlockFields, priceDetail } from "../src/packs/retail/core/site-prices";

const CHANNEL = "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f";
const OTHER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const prices: BlockCatalogEntry = {
  kind: "retail.prices",
  pack: "retail",
  label: "Price list",
  hint: "What you sell and what it costs.",
  fields: priceBlockFields([{ value: CHANNEL, label: "Saturday market" }]),
};

describe("the declared slot", () => {
  it("takes a block section with a pack-shaped kind and bounded settings, and nothing else", () => {
    const section = SectionSchema.parse({ type: "block", kind: "retail.prices", config: { channel: CHANNEL, soldOut: "mark" } });
    expect(section).toMatchObject({ type: "block", heading: "", note: "", emptyText: "", config: { channel: CHANNEL, soldOut: "mark" } });
    expect(SectionSchema.safeParse({ type: "block", kind: "prices" }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "block", kind: "Retail.Prices" }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "block", kind: "retail.prices", config: { nested: { a: 1 } } }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "block", kind: "retail.prices", config: { long: "x".repeat(201) } }).success).toBe(false);
    expect(PageContentSchema.parse({ sections: [{ type: "block", kind: "retail.prices" }] }).sections[0]).toMatchObject({ type: "block", config: {} });
    expect(packOfKind("retail.prices")).toBe("retail");
  });

  it("starts a section from the catalogue with every field at its default, and names it", () => {
    const section = newBlockSection(prices);
    expect(section).toEqual({ type: "block", kind: "retail.prices", heading: "Price list", note: "", emptyText: "", config: { channel: CHANNEL, soldOut: "mark" } });
    // With two channels nobody is chosen for the owner.
    const two = priceBlockFields([{ value: CHANNEL, label: "A" }, { value: OTHER, label: "B" }]);
    expect(defaultConfig(two)).toEqual({ channel: "", soldOut: "mark" });
    expect(blockLabel("retail.prices", [prices])).toBe("Price list");
    expect(blockLabel("retail.pickup_windows", [])).toBe("Pickup windows");
    expect(sectionSummary(section)).toBe("Price list");
    expect(sectionSummary({ ...section, heading: "" })).toBe("retail.prices");
  });

  it("files a view under the kind and the settings, whatever order the keys came in", () => {
    const a = blockKey({ kind: "retail.prices", config: { channel: CHANNEL, soldOut: "mark" } });
    const b = blockKey({ kind: "retail.prices", config: { soldOut: "mark", channel: CHANNEL } });
    expect(a).toBe(b);
    expect(blockKey({ kind: "retail.prices", config: { channel: OTHER, soldOut: "mark" } })).not.toBe(a);
    expect(blockKey({ kind: "retail.prices", config: { channel: CHANNEL, soldOut: "hide" } })).not.toBe(a);
  });

  it("offers only the blocks whose pack is on, and picks the block sections off a page", () => {
    const shop = { ...prices, kind: "retail.shop", label: "Shop" };
    const other = { ...prices, kind: "inventory.stock", pack: "inventory", label: "Stock" };
    expect(filterCatalog([prices, shop, other], ["retail"]).map((e) => e.kind)).toEqual(["retail.prices", "retail.shop"]);
    expect(filterCatalog([prices, shop, other], [])).toEqual([]);
    const sections = PageContentSchema.parse({
      sections: [{ type: "text", body: ["Hi"] }, { type: "block", kind: "retail.prices" }, { type: "cta", headline: "Go", cta: { label: "Go", href: "/contact" } }],
    }).sections;
    expect(blockSectionsOf(sections).map((s) => s.kind)).toEqual(["retail.prices"]);
  });
});

describe("retail's price list block", () => {
  const items = [
    { id: "beef", name: "Ground beef", stockingUnit: "lb", current: { priceCents: 899, priceBasis: "lb" } },
    { id: "eggs", name: "Eggs", stockingUnit: "dozen", current: { priceCents: 600, priceBasis: "unit" } },
    { id: "chicken", name: "Whole chicken", stockingUnit: "package", current: { priceCents: 2200, priceBasis: "unit" } },
    { id: "honey", name: "Honey", stockingUnit: "jar", current: null },
    { id: "apples", name: "Apples", stockingUnit: "each", current: { priceCents: 150, priceBasis: "unit" } },
  ];
  const onHand = new Map([
    ["beef", 12],
    ["eggs", 0],
    ["apples", -1],
  ]);

  it("checks its settings: a channel id and a sold-out rule", () => {
    expect(parsePriceBlockConfig({ channel: CHANNEL })).toEqual({ channel: CHANNEL, soldOut: "mark" });
    expect(parsePriceBlockConfig({ channel: CHANNEL, soldOut: "hide" })).toEqual({ channel: CHANNEL, soldOut: "hide" });
    expect(parsePriceBlockConfig({ channel: CHANNEL, soldOut: "maybe" })?.soldOut).toBe("mark");
    expect(parsePriceBlockConfig({})).toBeNull();
    expect(parsePriceBlockConfig({ channel: "" })).toBeNull();
    expect(parsePriceBlockConfig({ channel: "not-a-uuid" })).toBeNull();
    expect(parsePriceBlockConfig({ channel: 42 })).toBeNull();
  });

  it("lists priced items by name, says what a price is per, and marks what has run out", () => {
    const view = presentPriceList(items, onHand, { channel: CHANNEL, soldOut: "mark" }, "$");
    expect(view.rows).toEqual([
      { name: "Apples", detail: "each", amount: "$1.50", status: "sold_out" },
      { name: "Eggs", detail: "per dozen", amount: "$6.00", status: "sold_out" },
      { name: "Ground beef", detail: "per lb", amount: "$8.99", status: "" },
      // Never counted by inventory is not sold out.
      { name: "Whole chicken", detail: "each", amount: "$22.00", status: "" },
    ]);
    expect(view.rows.map((r) => r.name)).not.toContain("Honey");
    expect(view.footnote).toBe("");
  });

  it("leaves sold-out items off when the owner asks, and follows the tenant's money", () => {
    const view = presentPriceList(items, onHand, { channel: CHANNEL, soldOut: "hide" }, null);
    expect(view.rows.map((r) => [r.name, r.amount])).toEqual([
      ["Ground beef", "8.99"],
      ["Whole chicken", "22.00"],
    ]);
    expect(priceDetail({ stockingUnit: "Each" }, { priceBasis: "unit" })).toBe("each");
    expect(priceDetail({ stockingUnit: "" }, { priceBasis: "unit" })).toBe("each");
    expect(priceDetail({ stockingUnit: "package" }, { priceBasis: "lb" })).toBe("per lb");
    expect(priceDetail({ stockingUnit: "bunch" }, { priceBasis: undefined })).toBe("per bunch");
  });
});
