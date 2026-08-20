/**
 * Finding your own ground in the public parcel record. PURE — no imports, no
 * database, no network. The fetch lives in `parcel-lookup-service.ts`; this
 * file decides what to ask and what the answer means.
 *
 * **THE ENTRY PATH THE FOUNDER ACTUALLY ASKED FOR.** 2a.0 shipped a GeoJSON
 * paste box and 2a.1 replaced it with tracing by hand, both of which still ask
 * somebody to produce a boundary. The county already has one. Ohio publishes
 * every county's parcels as one statewide service, free and without a key, so
 * for an Ohio farm the boundary is a lookup rather than an afternoon.
 *
 * Two searches, because two questions:
 *
 *   - **By parcel number**, when you are holding the tax bill.
 *   - **By tax mailing address**, when you want the whole farm at once. Ohio's
 *     statewide layer carries NO owner name — only where the bill goes — and
 *     for this purpose that is better than a name: it is how the county groups
 *     a holding. One address in Knox County returns nine parcels across four
 *     roads and 462 acres, which is what a farm actually looks like in the
 *     records.
 *
 * **It proposes; the person disposes.** Mailing address groups by where the
 * bill goes, not by who owns the land: a trust, an LLC or a farm manager's
 * address pulls in ground that is not yours, and an owner who has moved splits
 * their own holding across two searches. So this returns CANDIDATES and
 * something else decides. Same rule as the rest of the pack — report, never
 * assert.
 */

export type ParcelSearchKind = "parcel_number" | "mailing_address";

/**
 * How to talk to one public parcel service.
 *
 * ARCGIS ONLY, and that is not a limitation worth apologising for: every county
 * and state parcel service worth querying is an ArcGIS FeatureServer, and they
 * all answer the same `/query` shape. What differs is the field NAMES, which is
 * why they are data here rather than assumptions in the code.
 */
export interface ParcelSource {
  /** Stable key, used in config and in the audit trail. */
  id: string;
  label: string;
  /** The FeatureServer LAYER url, ending in a layer index. */
  url: string;
  /** Field holding the county name, and whether a search must name one. */
  regionField: string | null;
  regionLabel: string;
  /** The number a person reads off a tax bill. */
  parcelField: string;
  /** Where the tax bill is posted. Null when the service has none. */
  mailingField: string | null;
  /** Street address of the ground itself. Frequently empty on farm parcels. */
  situsField: string | null;
  /** The county's own acreage, which becomes the DECLARED figure. */
  areaField: string | null;
  attribution: string;
}

/**
 * Ohio, statewide, all 88 counties.
 *
 * Verified against Knox County before this was written: 40 of 40 parcels parsed
 * by `core/geo.ts` with no failures, centroids landing where they should.
 * `LandArea` is populated, so an imported parcel arrives with the county's
 * acreage already in it and the measured-against-recorded comparison works from
 * the first second.
 */
export const OHIO_STATEWIDE: ParcelSource = {
  id: "oh-statewide",
  label: "Ohio statewide parcels",
  url: "https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0",
  regionField: "County",
  regionLabel: "County",
  parcelField: "LocalParcelID",
  mailingField: "MailAddressAll",
  situsField: "SitusAddressAll",
  areaField: "LandArea",
  attribution: "Ohio statewide parcels (OGRIP)",
};

/**
 * Every source this build will talk to.
 *
 * **A CLOSED REGISTRY, AND THAT IS THE SECURITY DESIGN.** The obvious next
 * feature is letting a tenant paste their own county's service URL — and that
 * is a server-side fetch of an attacker-chosen address, which is the textbook
 * shape of an SSRF. A fixed list means the question does not arise. When
 * custom sources are wanted they need a host allowlist and a deliberate
 * decision, not a text input.
 */
export const PARCEL_SOURCES: ParcelSource[] = [OHIO_STATEWIDE];

export function parcelSourceById(id: string | null | undefined): ParcelSource | null {
  if (!id) return null;
  return PARCEL_SOURCES.find((source) => source.id === id) ?? null;
}

/**
 * The tenant's source, from `packConfig.land.parcelSource`.
 *
 * TOTAL BY CONSTRUCTION, like `areaUnitFrom` and `basemapFrom`: an unreadable
 * or unknown value means "no lookup for this tenant", which hides the feature
 * rather than breaking the page. A farm outside the one state covered here is
 * the ordinary case, not an error.
 */
export function parcelSourceFrom(config: unknown): ParcelSource | null {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).parcelSource;
    if (typeof value === "string") return parcelSourceById(value);
  }
  return null;
}

/** The default region (county) for the search box, from the same config. */
export function parcelRegionFrom(config: unknown): string {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).parcelRegion;
    if (typeof value === "string") return value.trim();
  }
  return "";
}

/**
 * A parcel number as the service stores it.
 *
 * **THE NUMBER ON THE BILL IS NOT THE NUMBER IN THE DATABASE.** Ohio stores
 * `2900403000`; auditors print it with dashes and spaces. Without this, a
 * farmer typing his own parcel number correctly finds nothing at all, which is
 * the worst possible first impression of a lookup.
 */
export function normaliseParcelNumber(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Escape a value for an ArcGIS `where` clause.
 *
 * SQL-ish string literals, so a lone apostrophe both breaks the query and is
 * the beginning of an injection. `O'Brien Rd` is an ordinary Ohio address, so
 * this is a correctness fix before it is a security one.
 */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export interface LookupRequest {
  kind: ParcelSearchKind;
  /** What the person typed. */
  query: string;
  /** County, when the source needs one. */
  region?: string;
}

/** Nothing useful comes back from a one-character search, and it costs the service dearly. */
export const MIN_QUERY_LENGTH = 3;

/** More than this and the person is browsing a county, not finding their farm. */
export const MAX_CANDIDATES = 50;

export type WhereResult =
  | { ok: true; where: string }
  | { ok: false; error: string };

/**
 * The `where` clause for one search.
 *
 * Parcel numbers match EXACTLY on the normalised value; addresses match as a
 * prefix-ish `LIKE`, because nobody types a mailing address the way a county
 * stores it — `11729 LEEDY RD FREDERICKTOWN 43019` has two spaces in the real
 * data and no comma anywhere.
 */
export function buildWhere(source: ParcelSource, request: LookupRequest): WhereResult {
  const query = request.query.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return { ok: false, error: `Type at least ${MIN_QUERY_LENGTH} characters.` };
  }

  const clauses: string[] = [];
  if (source.regionField) {
    const region = (request.region ?? "").trim();
    if (!region) {
      return { ok: false, error: `Which ${source.regionLabel.toLowerCase()}?` };
    }
    clauses.push(`${source.regionField}='${escapeSqlLiteral(region)}'`);
  }

  if (request.kind === "parcel_number") {
    clauses.push(
      `${source.parcelField}='${escapeSqlLiteral(normaliseParcelNumber(query))}'`,
    );
  } else {
    if (!source.mailingField) {
      return { ok: false, error: "This source does not carry a mailing address." };
    }
    // Collapse runs of whitespace to a wildcard: the stored form is
    // inconsistently spaced and a person's typing never matches it exactly.
    const pattern = escapeSqlLiteral(query.replace(/\s+/g, "%").toUpperCase());
    clauses.push(`UPPER(${source.mailingField}) LIKE '%${pattern}%'`);
  }

  return { ok: true, where: clauses.join(" AND ") };
}

/** The full query URL. GeoJSON out, WGS84, geometry included. */
export function buildLookupUrl(source: ParcelSource, where: string): string {
  const fields = [
    source.parcelField,
    source.mailingField,
    source.situsField,
    source.areaField,
  ].filter((field): field is string => Boolean(field));
  const params = new URLSearchParams({
    where,
    outFields: fields.join(","),
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: String(MAX_CANDIDATES),
    f: "geojson",
  });
  return `${source.url}/query?${params.toString()}`;
}

export interface ParcelCandidate {
  /** The county's parcel number, as stored. */
  parcelNumber: string;
  /** Street address of the ground. Usually absent on farm parcels. */
  situsAddress: string | null;
  mailingAddress: string | null;
  /** The county's acreage. Becomes the parcel's DECLARED area on import. */
  declaredAcres: number | null;
  /** GeoJSON geometry, unvalidated here — `core/geo.ts` owns that. */
  geometry: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Candidates out of whatever the service returned.
 *
 * TOLERANT ON PURPOSE. This is somebody else's data over the public internet:
 * a feature with no geometry, a null parcel number or an area of `0` are all
 * things Ohio actually returns, and none of them is a reason to fail the whole
 * search. Rows that cannot become a parcel are dropped; the rest come through.
 */
export function candidatesFrom(
  source: ParcelSource,
  payload: unknown,
): ParcelCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as Record<string, unknown>).features;
  if (!Array.isArray(features)) return [];

  const out: ParcelCandidate[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const node = feature as Record<string, unknown>;
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    const parcelNumber = text(properties[source.parcelField]);
    if (!parcelNumber || !node.geometry) continue;

    const rawArea = source.areaField ? properties[source.areaField] : null;
    // A recorded 0 acres is the county saying "we have not measured it", not a
    // parcel with no ground. Storing it would put a zero in every per-acre
    // divisor downstream.
    const declaredAcres =
      typeof rawArea === "number" && Number.isFinite(rawArea) && rawArea > 0
        ? rawArea
        : null;

    out.push({
      parcelNumber,
      situsAddress: source.situsField ? text(properties[source.situsField]) : null,
      mailingAddress: source.mailingField
        ? text(properties[source.mailingField])
        : null,
      declaredAcres,
      geometry: node.geometry,
    });
  }
  return out;
}

/**
 * What to call an imported parcel.
 *
 * The situs address when there is one, and the parcel number when there is not
 * — which on farm ground is most of the time, because a field has no street
 * number. Ohio returns `0 ROBERTS RD` for exactly this, so a leading zero with
 * no number is stripped rather than shown.
 */
export function suggestedParcelName(candidate: ParcelCandidate): string {
  const situs = candidate.situsAddress?.replace(/^0\s+/, "").trim();
  if (situs) return situs;
  return `Parcel ${candidate.parcelNumber}`;
}
