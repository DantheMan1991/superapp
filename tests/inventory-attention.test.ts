import { describe, expect, it } from "vitest";
import {
  belowZeroAttention,
  daysFrom,
  goingOffAttention,
  lowStockAttention,
  plusDays,
  staleCountAttention,
  unbilledAttention,
} from "../src/packs/inventory/core/attention";

const TODAY = "2026-09-09";

describe("day arithmetic", () => {
  it("counts whole days either way, and adds them", () => {
    expect(daysFrom("2026-09-01", TODAY)).toBe(8);
    expect(daysFrom(TODAY, "2026-09-01")).toBe(-8);
    expect(plusDays(TODAY, 7)).toBe("2026-09-16");
    expect(plusDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("belowZeroAttention", () => {
  it("raises what is below zero, today, and nothing else", () => {
    const items = belowZeroAttention([
      { id: "a", name: "Grower crumble", unit: "lb", onHand: -20, reorderPoint: null },
      { id: "b", name: "Cartons", unit: "each", onHand: 0, reorderPoint: null },
      { id: "c", name: "Never counted", unit: "lb", onHand: null, reorderPoint: 5 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "inventory-negative:a",
      title: "Grower crumble is below zero",
      urgency: "today",
      dueOn: null,
      href: "/dashboard/m/inventory/a",
    });
    expect(items[0].detail).toMatch(/^-20 pounds on hand/);
  });
});

describe("lowStockAttention", () => {
  it("raises at or below the reorder point, and says the point", () => {
    const items = lowStockAttention([
      { id: "a", name: "Grower crumble", unit: "lb", onHand: 90, reorderPoint: 100 },
      { id: "b", name: "Layer pellets", unit: "lb", onHand: 100, reorderPoint: 100 },
      { id: "c", name: "Cartons", unit: "each", onHand: 500, reorderPoint: 100 },
    ]);
    expect(items.map((i) => i.title)).toEqual([
      "Grower crumble is down to 90 pounds",
      "Layer pellets is down to 100 pounds",
    ]);
    expect(items[0]).toMatchObject({
      key: "inventory-low:a",
      detail: "Reorder at 100 pounds",
      urgency: "soon",
      href: "/dashboard/m/inventory/a",
    });
  });

  it("says OUT for nothing left, today", () => {
    const [item] = lowStockAttention([
      { id: "a", name: "Cartons", unit: "each", onHand: 0, reorderPoint: 10 },
    ]);
    expect(item.title).toBe("Cartons is out");
    expect(item.urgency).toBe("today");
  });

  it("leaves below zero to the other line, and never-recorded to nobody", () => {
    expect(
      lowStockAttention([
        { id: "a", name: "Feed", unit: "lb", onHand: -5, reorderPoint: 10 },
        { id: "b", name: "Feed", unit: "lb", onHand: null, reorderPoint: 10 },
        { id: "c", name: "Feed", unit: "lb", onHand: 2, reorderPoint: null },
      ]),
    ).toEqual([]);
  });
});

describe("goingOffAttention", () => {
  const lot = (code: string, expiresOn: string, balance = 2) => ({
    lotId: `lot-${code}`,
    code,
    itemId: "pen",
    itemName: "Penicillin G",
    unit: "floz",
    balance,
    expiresOn,
  });

  it("is overdue past the date, today on the day, soon within the week", () => {
    const items = goingOffAttention(
      [
        lot("PAST", "2026-09-01"),
        lot("TODAY", "2026-09-09"),
        lot("TOMORROW", "2026-09-10"),
        lot("WEEK", "2026-09-16"),
        lot("LATER", "2026-09-17"),
      ],
      TODAY,
    );
    expect(items.map((i) => [i.title, i.urgency, i.dueOn])).toEqual([
      ["PAST of Penicillin G is past its date", "overdue", "2026-09-01"],
      ["TODAY of Penicillin G goes off today", "today", "2026-09-09"],
      ["TOMORROW of Penicillin G goes off tomorrow", "soon", "2026-09-10"],
      ["WEEK of Penicillin G goes off in 7 days", "soon", "2026-09-16"],
    ]);
    expect(items[0].detail).toBe("2 fluid ounces on hand · good until 2026-09-01");
    expect(items[0].key).toBe("inventory-expiry:lot-PAST");
  });

  it("does not raise a batch with nothing on hand — it cannot go off into a loss", () => {
    expect(goingOffAttention([lot("EMPTY", "2026-09-01", 0)], TODAY)).toEqual([]);
  });
});

describe("staleCountAttention", () => {
  it("raises a walked count left unposted for two weeks, and not a fresher one", () => {
    const items = staleCountAttention(
      [
        { id: "old", countedOn: "2026-08-26", where: "Everywhere", lines: 3 },
        { id: "fresh", countedOn: "2026-08-27", where: "Everywhere", lines: 3 },
      ],
      TODAY,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "inventory-count:old",
      title: "A count from 2026-08-26 has not been posted",
      detail: "Everywhere · 3 shelves written down · 14 days ago",
      urgency: "today",
      href: "/dashboard/m/inventory/counts/old",
    });
  });

  it("never raises an empty draft, because nothing can clear it", () => {
    expect(
      staleCountAttention(
        [{ id: "empty", countedOn: "2026-01-01", where: "Freezer", lines: 0 }],
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe("unbilledAttention", () => {
  const r = (itemName: string, occurredOn: string) => ({
    movementId: `${itemName}-${occurredOn}`,
    itemName,
    occurredOn,
  });

  it("is one line for the business, naming the oldest", () => {
    const [item] = unbilledAttention(
      [
        r("Grower crumble", "2026-07-01"),
        r("Penicillin G", "2026-08-01"),
        r("Grower crumble", "2026-06-15"),
      ],
      TODAY,
    );
    expect(item).toMatchObject({
      key: "inventory-unbilled",
      title: "2 deliveries have waited 60 days or more for an invoice",
      detail: "Grower crumble (2026-06-15), Grower crumble (2026-07-01)",
      urgency: "soon",
      href: "/dashboard/m/inventory/matching",
    });
  });

  it("names the one delivery when there is one, with its days", () => {
    const [item] = unbilledAttention([r("Grower crumble", "2026-07-01")], TODAY);
    expect(item.title).toBe(
      "A Grower crumble delivery from 2026-07-01 has waited 70 days for its invoice",
    );
  });

  it("counts a delivery that turned sixty days TODAY — the boundary the threshold is for", () => {
    // `>=` is the filter, so exactly 60 days is raised; the title used to say
    // "more than 60 days" about it, which was wrong on the one day it matters.
    const sixty = unbilledAttention([r("Grower crumble", "2026-07-11")], TODAY);
    expect(sixty).toHaveLength(1);
    expect(sixty[0].title).toBe(
      "A Grower crumble delivery from 2026-07-11 has waited 60 days for its invoice",
    );
    // 59 days is not yet.
    expect(unbilledAttention([r("Grower crumble", "2026-07-12")], TODAY)).toEqual([]);
    expect(
      unbilledAttention(
        [r("Grower crumble", "2026-07-11"), r("Penicillin G", "2026-07-11")],
        TODAY,
      )[0].title,
    ).toBe("2 deliveries have waited 60 days or more for an invoice");
  });

  it("says how many more past four, and is nothing under sixty days", () => {
    const many = ["01", "02", "03", "04", "05", "06"].map((d) =>
      r(`Item ${d}`, `2026-06-${d}`),
    );
    expect(unbilledAttention(many, TODAY)[0].detail).toMatch(/, and 2 more$/);
    expect(unbilledAttention([r("Penicillin G", "2026-08-01")], TODAY)).toEqual([]);
  });
});
