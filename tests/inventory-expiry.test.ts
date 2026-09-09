import { describe, expect, it } from "vitest";
import {
  daysUntil,
  describeExpiring,
  expiryLabel,
  isPastDate,
  splitExpiring,
} from "../src/packs/inventory/core/expiry";

const TODAY = "2026-09-09";

describe("daysUntil", () => {
  it("counts whole days either side of today", () => {
    expect(daysUntil("2026-09-09", TODAY)).toBe(0);
    expect(daysUntil("2026-09-10", TODAY)).toBe(1);
    expect(daysUntil("2026-10-21", TODAY)).toBe(42);
    expect(daysUntil("2026-09-01", TODAY)).toBe(-8);
  });

  it("is not moved by a daylight-saving change in between", () => {
    // 2026-11-01 is the US fall-back; a local-time diff would come out 0.96
    // days short of a whole number somewhere in here.
    expect(daysUntil("2026-11-05", "2026-10-25")).toBe(11);
  });
});

describe("expiryLabel", () => {
  it("says past its date, today, tomorrow, and in N days", () => {
    expect(expiryLabel("2026-09-01", TODAY)).toBe("past its date");
    expect(expiryLabel("2026-09-09", TODAY)).toBe("goes off today");
    expect(expiryLabel("2026-09-10", TODAY)).toBe("goes off tomorrow");
    expect(expiryLabel("2026-09-14", TODAY)).toBe("goes off in 5 days");
    expect(expiryLabel("2026-10-21", TODAY)).toBe("goes off in 42 days");
  });

  it("names the date beyond the horizon rather than counting to it", () => {
    expect(expiryLabel("2026-10-22", TODAY)).toBe("good until 2026-10-22");
    expect(expiryLabel("2026-09-20", TODAY, 7)).toBe("good until 2026-09-20");
  });
});

describe("splitExpiring", () => {
  it("keeps the past apart from the soon, in the order given", () => {
    const rows = [
      { code: "a", expiresOn: "2026-08-01" },
      { code: "b", expiresOn: "2026-09-08" },
      { code: "c", expiresOn: "2026-09-09" },
      { code: "d", expiresOn: "2026-09-30" },
    ];
    const { past, soon } = splitExpiring(rows, TODAY);
    expect(past.map((r) => r.code)).toEqual(["a", "b"]);
    // Today is not past — it is the day to use it.
    expect(soon.map((r) => r.code)).toEqual(["c", "d"]);
    expect(isPastDate("2026-09-09", TODAY)).toBe(false);
  });

  it("is empty both sides for nothing", () => {
    expect(splitExpiring([], TODAY)).toEqual({ past: [], soon: [] });
  });
});

describe("describeExpiring", () => {
  it("is one sentence for each of the four cases", () => {
    expect(describeExpiring(0, 0)).toBe("Nothing within six weeks");
    expect(describeExpiring(1, 0)).toBe(
      "1 past its date, nothing else within six weeks",
    );
    expect(describeExpiring(3, 0)).toBe(
      "3 past their date, nothing else within six weeks",
    );
    expect(describeExpiring(0, 4)).toBe("Within six weeks, soonest first below");
    expect(describeExpiring(2, 3)).toBe("2 past their date, 3 more within six weeks");
  });
});
