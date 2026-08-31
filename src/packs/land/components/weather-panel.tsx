import { Panel } from "@/components/app/panel";
import {
  compareSeason,
  formatBase,
  formatDegreeDays,
  formatRain,
  recentRain,
  WETTING_RAIN_MM,
  type TemperatureUnit,
  type WeatherDay,
} from "../core/weather";

/**
 * What the weather has done over this ground. Slice 3.
 *
 * **IT REPORTS AND DOES NOT PREDICT**, which is the whole shape of the slice.
 * The destination the design brief names — *"you return to Paddock 4 in 16
 * days, not 21"* — is a regrowth model, and turning degree days into a date is
 * a correlation nobody here has validated on ground nobody here has measured.
 * The brief says the same in its own words: log from day one, insight in year
 * three. So this puts the season next to the same window in previous years and
 * lets the person draw the line, next to the rotation panel where that line
 * gets drawn.
 *
 * **TWO NUMBERS, NOT A DASHBOARD.** Heat, because it is what the rest target is
 * really asking about, and rain, because it decides whether you can get on the
 * ground at all. Everything else Open-Meteo returns is a chart nobody reads.
 */
export function WeatherPanel({
  days,
  today,
  baseC,
  unit,
  error,
}: {
  days: WeatherDay[];
  today: string;
  baseC: number;
  unit: TemperatureUnit;
  error: string | null;
}) {
  const season = compareSeason(days, today, baseC);
  const rain = recentRain(days, today, 7);
  const usable = season.gdd > 0 || rain.days > 0;

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-semibold tracking-heading">
          Growing weather
        </h2>
        <p className="text-xs text-muted-foreground">
          Free, from this parcel&rsquo;s middle. Nobody types it in.
        </p>
      </div>

      {error !== null ? (
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
      ) : !usable ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No record yet for this ground. Draw the boundary and this fills itself
          in.
        </p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <span className="font-heading text-2xl font-semibold tabular-nums">
              {formatDegreeDays(season.gdd, unit)}
            </span>
            <span className="ml-2 text-muted-foreground">
              since 1 January, over {formatBase(baseC, unit)}
            </span>
          </div>

          {/*
            **THE COMPARISON IS THE PRODUCT.** A degree-day total on its own
            means nothing to anybody. "Behind the five-year average" is the
            sentence that changes a decision — and where there is nothing to
            compare with, it says so rather than showing a lonely number as
            though it meant something.
          */}
          <p className="text-muted-foreground">
            {season.difference === null || season.averageGdd === null ? (
              <>Nothing to compare it with yet.</>
            ) : (
              <>
                {Math.abs(season.difference) < 0.05 ? (
                  <>About level with</>
                ) : (
                  <>
                    <span
                      className={
                        season.difference > 0 ? "text-success" : "text-warning"
                      }
                    >
                      {Math.round(Math.abs(season.difference) * 100)}%{" "}
                      {season.difference > 0 ? "ahead of" : "behind"}
                    </span>
                  </>
                )}{" "}
                the {season.years === 1 ? "same window last year" : `${season.years}-year average`}
                {season.years > 1 && " for this date"}.
              </>
            )}
          </p>

          <div className="border-t pt-3">
            <span className="tabular-nums">{formatRain(rain.mm, unit)}</span>
            <span className="ml-2 text-muted-foreground">
              of rain in the last {rain.days} days
              {rain.sinceWetting === null
                ? `, none of it over ${formatRain(WETTING_RAIN_MM, unit)} in a day`
                : rain.sinceWetting === 0
                  ? " — it rained today"
                  : `, last worth the name ${rain.sinceWetting} day${
                      rain.sinceWetting === 1 ? "" : "s"
                    } ago`}
              .
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}
