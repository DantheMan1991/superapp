import "server-only";
import {
  buildCurrencyUrl,
  buildLookupUrl,
  buildWhere,
  candidatesFrom,
  currencyFrom,
  type RecordCurrency,
  type LookupRequest,
  type ParcelCandidate,
  type ParcelSource,
} from "./core/parcel-lookup";

/**
 * The one place this pack talks to the outside world.
 *
 * **SERVER-SIDE, ALWAYS.** Not for secrecy — Ohio's service is public and needs
 * no key — but because the browser is the wrong place for it three times over:
 * the service sets no CORS headers we can rely on, the URL would become
 * client-editable the moment it shipped in a bundle, and a fetch the server
 * makes can be given a timeout and a size the browser cannot be trusted to
 * respect.
 *
 * The source is chosen from a CLOSED REGISTRY (`PARCEL_SOURCES`), never from
 * caller input. That is what keeps this from being an SSRF: there is no code
 * path where a URL a user typed reaches `fetch`.
 */

/** Somebody else's server on the public internet gets fifteen seconds. */
const TIMEOUT_MS = 15_000;

export type LookupResult =
  | { ok: true; candidates: ParcelCandidate[] }
  | { ok: false; error: string };

export async function lookupParcels(
  source: ParcelSource,
  request: LookupRequest,
): Promise<LookupResult> {
  const where = buildWhere(source, request);
  if (!where.ok) return { ok: false, error: where.error };

  let payload: unknown;
  try {
    const response = await fetch(buildLookupUrl(source, where.where), {
      // County GIS moves at the speed of county GIS; a stale boundary is fine
      // and a repeated identical search should not go out twice.
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `The ${source.label} service answered ${response.status}. Try again in a minute.`,
      };
    }
    payload = await response.json();
  } catch (err) {
    // A timeout here is the ordinary failure, not an exceptional one — these
    // services go down for maintenance without notice.
    console.error("parcel lookup failed", { source: source.id, err });
    return {
      ok: false,
      error: `Could not reach the ${source.label} service. It may be down — the map still lets you trace by hand.`,
    };
  }

  // **ARCGIS REPORTS FAILURE WITH HTTP 200.** A bad field name or a malformed
  // where clause comes back as `{ error: { message } }` with an OK status, so
  // trusting the status code alone would turn every query mistake into "no
  // parcels found" and send somebody looking for their farm in the wrong county.
  if (payload && typeof payload === "object" && "error" in payload) {
    const detail = (payload as { error?: { message?: string } }).error?.message;
    console.error("parcel lookup rejected", { source: source.id, detail });
    return { ok: false, error: "That search was refused by the parcel service." };
  }

  return { ok: true, candidates: candidatesFrom(source, payload) };
}

/**
 * How current this county's records are, from the service rather than a note in
 * a comment.
 *
 * Asked SEPARATELY from the search, and deliberately: the moment somebody most
 * needs to know the data is three years old is when their parcel is not in it,
 * and a search that returns nothing has no rows to read a date off. One extra
 * request, cached for a day, so a zero-result search can still explain itself.
 *
 * Returns null rather than throwing. This is a footnote on a page, and a
 * footnote must never be the reason the page fails.
 */
export async function lookupCurrency(
  source: ParcelSource,
  region: string,
): Promise<RecordCurrency | null> {
  const url = buildCurrencyUrl(source, region);
  if (!url) return null;
  try {
    const response = await fetch(url, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return currencyFrom(await response.json());
  } catch {
    return null;
  }
}
