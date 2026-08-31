import "server-only";
import type { WeatherDay } from "./core/weather";

/**
 * The second place this pack talks to the outside world, and the same rules as
 * the first (`parcel-lookup-service.ts`).
 *
 * **SERVER-SIDE, ALWAYS**, and here the reason is not CORS: it is that a fetch
 * the server makes can be given a timeout, a size and a CACHE, and a browser
 * hitting a public archive once per page view cannot be trusted to do any of
 * those. There is no key to protect — Open-Meteo is free and unauthenticated —
 * which is exactly why it needs a cache more than most.
 *
 * **THE URL IS BUILT, NEVER PASSED.** The host is a constant and the only
 * caller-supplied values are numbers that go through `Number.isFinite` and a
 * range check before they reach a query string. Same rule as the parcel
 * lookup: there is no path where something a user typed becomes a hostname.
 */

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

/** Somebody else's server on the public internet gets fifteen seconds. */
const TIMEOUT_MS = 15_000;

/**
 * **A DAY THAT HAS HAPPENED NEVER CHANGES, SO IT IS CACHED FOR A DAY.**
 *
 * The archive lags real time by about five days and is then stable forever, so
 * the only thing a short cache would buy is the newest few days arriving
 * sooner — and this answers a question about a season, not about this
 * afternoon. A day is long enough to make a page load free for everybody after
 * the first, and short enough that the tail of the series is never more than a
 * day behind what is published.
 */
const REVALIDATE_SECONDS = 86_400;

/**
 * How far back to ask for.
 *
 * **SIX CALENDAR YEARS, WHICH IS THIS ONE AND FIVE TO COMPARE IT WITH.** The
 * brief's own sentence is "30% below the five-year average", so five is the
 * number the product promises. Asking for more would cost nothing in money and
 * something in honesty: a farm's ground changes, and a fifteen-year mean says
 * less about this field than five does.
 */
export const COMPARISON_YEARS = 5;

export type WeatherResult =
  | { ok: true; days: WeatherDay[]; timezone: string }
  | { ok: false; error: string };

interface ArchiveResponse {
  timezone?: string;
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
  };
}

/** A finite coordinate inside the range the earth actually has. */
function usable(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * The daily record over one point, from the first of January `years` ago to
 * `through`.
 *
 * **THE CENTROID IS PRECISE ENOUGH AND NO MORE**, so it is rounded to three
 * decimals — about a hundred metres. Weather does not vary across a field, and
 * rounding is what makes the cache work: two parcels on the same farm, and the
 * same parcel viewed by two people, become one request instead of several.
 *
 * Failure is reported, never thrown and never faked. A season with no numbers
 * shows as "no record yet" — inventing an average would be a figure somebody
 * plans a rotation against.
 */
export async function dailyWeather(
  latitude: number,
  longitude: number,
  through: string,
  years: number = COMPARISON_YEARS,
): Promise<WeatherResult> {
  if (!usable(latitude, longitude)) {
    return { ok: false, error: "That parcel has no location to look up." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
    return { ok: false, error: "Could not work out today's date." };
  }

  const lat = Math.round(latitude * 1000) / 1000;
  const lon = Math.round(longitude * 1000) / 1000;
  const start = `${Number(through.slice(0, 4)) - years}-01-01`;

  const url =
    `${ARCHIVE}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}&end_date=${through}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=auto`;

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: "The weather archive did not answer. Try again later.",
      };
    }
    const body = (await response.json()) as ArchiveResponse;
    const time = body.daily?.time ?? [];
    const max = body.daily?.temperature_2m_max ?? [];
    const min = body.daily?.temperature_2m_min ?? [];
    const rain = body.daily?.precipitation_sum ?? [];

    const days: WeatherDay[] = time.map((date, i) => ({
      date,
      maxC: typeof max[i] === "number" ? max[i] : null,
      minC: typeof min[i] === "number" ? min[i] : null,
      rainMm: typeof rain[i] === "number" ? rain[i] : null,
    }));
    return { ok: true, days, timezone: body.timezone ?? "UTC" };
  } catch {
    // A timeout and a DNS failure read the same to somebody looking at a farm.
    return {
      ok: false,
      error: "The weather archive did not answer. Try again later.",
    };
  }
}
