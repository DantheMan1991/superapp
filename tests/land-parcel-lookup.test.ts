import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES,
  OHIO_STATEWIDE,
  PARCEL_SOURCES,
  buildCurrencyUrl,
  buildLookupUrl,
  buildWhere,
  currencyFrom,
  candidatesFrom,
  escapeSqlLiteral,
  normaliseParcelNumber,
  parcelRegionFrom,
  parcelSourceById,
  parcelSourceFrom,
  suggestedParcelName,
  type ParcelCandidate,
} from "../src/packs/land/core/parcel-lookup";

/**
 * Finding a farm in the public parcel record.
 *
 * The tests worth writing are the ones where a defensible implementation is
 * silently wrong on real data: a parcel number that matches nothing because
 * nobody strips the dashes, an apostrophe in an Ohio road name breaking the
 * query, and a county's "0 acres" arriving as a real measurement.
 */

describe("normaliseParcelNumber", () => {
  it("makes the number on the bill match the number in the database", () => {
    // Ohio stores `2900403000`; every auditor prints it with punctuation.
    // Without this, a farmer typing his own parcel number correctly finds
    // nothing at all.
    expect(normaliseParcelNumber("29-004-03-000")).toBe("2900403000");
    expect(normaliseParcelNumber("29 004 03 000")).toBe("2900403000");
    expect(normaliseParcelNumber("  2900403000  ")).toBe("2900403000");
  });

  it("keeps the letters, because some parcels are not numbers", () => {
    // Knox County really does hold `18ROW` and `66RAIL`.
    expect(normaliseParcelNumber("18row")).toBe("18ROW");
    expect(normaliseParcelNumber("66-RAIL")).toBe("66RAIL");
  });
});

describe("escapeSqlLiteral", () => {
  it("survives an apostrophe, which is an ordinary Ohio address", () => {
    // `O'Brien Rd` both breaks the query and opens it up. This is a
    // correctness fix before it is a security one.
    expect(escapeSqlLiteral("O'Brien Rd")).toBe("O''Brien Rd");
    expect(escapeSqlLiteral("' OR 1=1 --")).toBe("'' OR 1=1 --");
  });
});

describe("buildWhere", () => {
  const request = { kind: "parcel_number" as const, query: "29-004-03-000", region: "Knox" };

  it("scopes to the county and matches the normalised number", () => {
    const result = buildWhere(OHIO_STATEWIDE, request);
    expect(result.ok && result.where).toBe(
      "County='Knox' AND LocalParcelID='2900403000'",
    );
  });

  it("asks which county rather than searching the whole state", () => {
    // Ohio is 88 counties and several million parcels; an unscoped search is
    // slow for everyone and returns somebody else's Leedy Rd.
    const result = buildWhere(OHIO_STATEWIDE, { ...request, region: "  " });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("ounty");
  });

  it("refuses a search too short to mean anything", () => {
    expect(buildWhere(OHIO_STATEWIDE, { ...request, query: "29" }).ok).toBe(false);
  });

  it("turns a typed address into a pattern the county data can match", () => {
    // Stored as `11729  LEEDY RD  FREDERICKTOWN 43019` — two spaces, no
    // commas. Nobody types that, so whitespace becomes a wildcard.
    const result = buildWhere(OHIO_STATEWIDE, {
      kind: "mailing_address",
      query: "11729 Leedy Rd",
      region: "Knox",
    });
    expect(result.ok && result.where).toBe(
      "County='Knox' AND UPPER(MailAddressAll) LIKE '%11729%LEEDY%RD%'",
    );
  });

  it("escapes the address too", () => {
    const result = buildWhere(OHIO_STATEWIDE, {
      kind: "mailing_address",
      query: "O'Brien Rd",
      region: "Knox",
    });
    expect(result.ok && result.where).toContain("O''BRIEN");
  });

  it("refuses an address search against a source that has no such field", () => {
    const source = { ...OHIO_STATEWIDE, mailingField: null };
    const result = buildWhere(source, {
      kind: "mailing_address",
      query: "anywhere",
      region: "Knox",
    });
    expect(result.ok).toBe(false);
  });
});

describe("buildLookupUrl", () => {
  it("asks for GeoJSON in WGS84 with the geometry", () => {
    // Anything else and `core/geo.ts` cannot read the answer: projected
    // coordinates would measure acres in the wrong units entirely.
    const url = buildLookupUrl(OHIO_STATEWIDE, "County='Knox'");
    expect(url.startsWith(`${OHIO_STATEWIDE.url}/query?`)).toBe(true);
    expect(url).toContain("f=geojson");
    expect(url).toContain("outSR=4326");
    expect(url).toContain("returnGeometry=true");
    expect(url).toContain(`resultRecordCount=${MAX_CANDIDATES}`);
  });

  it("requests only the fields the source declares", () => {
    const url = new URL(buildLookupUrl(OHIO_STATEWIDE, "1=1"));
    expect(url.searchParams.get("outFields")).toBe(
      "LocalParcelID,MailAddressAll,SitusAddressAll,LandArea",
    );
  });

  it("encodes the where clause rather than splicing it", () => {
    const url = new URL(buildLookupUrl(OHIO_STATEWIDE, "County='Knox' AND X='a b'"));
    expect(url.searchParams.get("where")).toBe("County='Knox' AND X='a b'");
  });
});

describe("candidatesFrom", () => {
  const feature = (properties: Record<string, unknown>, geometry: unknown = {
    type: "Polygon",
    coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
  }) => ({ type: "Feature", properties, geometry });

  it("reads a real Ohio row", () => {
    const [candidate] = candidatesFrom(OHIO_STATEWIDE, {
      type: "FeatureCollection",
      features: [
        feature({
          LocalParcelID: "0100009000",
          MailAddressAll: "11729  LEEDY RD  FREDERICKTOWN 43019",
          SitusAddressAll: "0  ROBERTS RD   ",
          LandArea: 25.05,
        }),
      ],
    });
    expect(candidate.parcelNumber).toBe("0100009000");
    // Runs of whitespace collapse, because the county's padding is not data.
    expect(candidate.mailingAddress).toBe("11729 LEEDY RD FREDERICKTOWN 43019");
    expect(candidate.situsAddress).toBe("0 ROBERTS RD");
    expect(candidate.declaredAcres).toBe(25.05);
  });

  it("treats a county's ZERO acres as not measured, not as no land", () => {
    // Ohio returns 0 for parcels it has never measured. Storing that would put
    // a zero into every per-acre divisor downstream.
    const [candidate] = candidatesFrom(OHIO_STATEWIDE, {
      features: [feature({ LocalParcelID: "0100005000", LandArea: 0 })],
    });
    expect(candidate.declaredAcres).toBeNull();
  });

  it("drops rows that could never become a parcel", () => {
    // Somebody else's data over the public internet: a feature with no
    // geometry or no parcel number is a real thing Ohio returns, and neither
    // is a reason to fail the whole search.
    const candidates = candidatesFrom(OHIO_STATEWIDE, {
      features: [
        feature({ LocalParcelID: null, LandArea: 4 }),
        { type: "Feature", properties: { LocalParcelID: "X1" }, geometry: null },
        feature({ LocalParcelID: "GOOD", LandArea: 4 }),
      ],
    });
    expect(candidates.map((c) => c.parcelNumber)).toEqual(["GOOD"]);
  });

  it("returns nothing for a shape it cannot read at all", () => {
    expect(candidatesFrom(OHIO_STATEWIDE, null)).toEqual([]);
    expect(candidatesFrom(OHIO_STATEWIDE, { error: { message: "nope" } })).toEqual([]);
    expect(candidatesFrom(OHIO_STATEWIDE, { features: "not an array" })).toEqual([]);
  });
});

describe("suggestedParcelName", () => {
  const base: ParcelCandidate = {
    parcelNumber: "0101305000",
    situsAddress: null,
    mailingAddress: null,
    declaredAcres: null,
    geometry: null,
  };

  it("uses the street address when the ground has one", () => {
    expect(suggestedParcelName({ ...base, situsAddress: "11729 Leedy Rd" })).toBe(
      "11729 Leedy Rd",
    );
  });

  it("does not name a field after the number zero", () => {
    // `0 ROBERTS RD` is Ohio's way of saying "on Roberts Rd, no building".
    expect(suggestedParcelName({ ...base, situsAddress: "0 ROBERTS RD" })).toBe(
      "ROBERTS RD",
    );
  });

  it("falls back to the parcel number, which farm ground usually needs", () => {
    expect(suggestedParcelName(base)).toBe("Parcel 0101305000");
  });
});

describe("the source registry", () => {
  it("resolves by id and refuses anything else", () => {
    // **THE SSRF DEFENCE.** A caller may choose BETWEEN sources and can never
    // introduce one, so no user-supplied string reaches `fetch`.
    expect(parcelSourceById("oh-statewide")).toBe(OHIO_STATEWIDE);
    expect(parcelSourceById("https://evil.example/query")).toBeNull();
    expect(parcelSourceById("")).toBeNull();
    expect(parcelSourceById(undefined)).toBeNull();
  });

  it("only ever points at https", () => {
    for (const source of PARCEL_SOURCES) {
      expect(source.url.startsWith("https://")).toBe(true);
      expect(source.attribution.trim()).not.toBe("");
    }
  });

  it("reads a pinned source from pack config, and degrades to none", () => {
    expect(parcelSourceFrom({ parcelSource: "oh-statewide" })).toBe(OHIO_STATEWIDE);
    expect(parcelSourceFrom({ parcelSource: "made-up" })).toBeNull();
    expect(parcelSourceFrom({})).toBeNull();
    expect(parcelSourceFrom("nonsense")).toBeNull();
  });

  it("reads the default county the same way", () => {
    expect(parcelRegionFrom({ parcelRegion: " Knox " })).toBe("Knox");
    expect(parcelRegionFrom({})).toBe("");
    expect(parcelRegionFrom(null)).toBe("");
  });
});

describe("how old the records are", () => {
  it("asks the service for the county's own min and max", () => {
    // READ, never written down. A hardcoded date would itself go stale and
    // then lie about staleness, which is worse than saying nothing.
    const url = new URL(buildCurrencyUrl(OHIO_STATEWIDE, "Knox")!);
    expect(url.searchParams.get("where")).toBe("County='Knox'");
    const stats = JSON.parse(url.searchParams.get("outStatistics")!);
    expect(stats.map((s: { outStatisticFieldName: string }) => s.outStatisticFieldName)).toEqual([
      "oldest",
      "newest",
    ]);
    expect(stats.every((s: { onStatisticField: string }) => s.onStatisticField === "CurrentTo")).toBe(true);
  });

  it("has nothing to ask when a source does not date its records", () => {
    expect(buildCurrencyUrl({ ...OHIO_STATEWIDE, currencyField: null }, "Knox")).toBeNull();
  });

  it("reads ArcGIS epoch milliseconds as a date", () => {
    // 2023-05-16, which is the real answer for all 41,757 Knox parcels.
    const currency = currencyFrom({
      features: [{ attributes: { oldest: 1684195200000, newest: 1684195200000 } }],
    });
    expect(currency).toEqual({
      oldest: "2023-05-16",
      newest: "2023-05-16",
      uniform: true,
    });
  });

  it("knows a snapshot from a range", () => {
    // Uniform means one snapshot, which is what a county contribution looks
    // like. A range means rows of different ages and the sentence has to change.
    const currency = currencyFrom({
      features: [{ attributes: { oldest: 1684195200000, newest: 1715731200000 } }],
    });
    expect(currency?.uniform).toBe(false);
    expect(currency?.newest).toBe("2024-05-15");
  });

  it("says nothing rather than something wrong", () => {
    // A footnote must never be the reason a page fails, or shows the word
    // "null" in a sentence about how current somebody's records are.
    expect(currencyFrom(null)).toBeNull();
    expect(currencyFrom({ features: [] })).toBeNull();
    expect(currencyFrom({ features: [{ attributes: { oldest: null, newest: null } }] })).toBeNull();
    expect(currencyFrom({ features: [{ attributes: { oldest: "unknown" } }] })).toBeNull();
  });
});
