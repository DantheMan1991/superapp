import { describe, expect, it } from "vitest";
import {
  ageInDays,
  formatAge,
  formatRate,
  headEffect,
  mortalityRate,
  preferredIdentifier,
  splitInHead,
  summariseHead,
  summarisePen,
} from "../src/packs/livestock/core/herd";
import {
  checkStreak,
  daysSinceCheck,
  describeLeft,
  formatLastChecked,
  lossesOn,
  roundProgress,
  soldOn,
} from "../src/packs/livestock/core/daily";
import {
  formatSnapshot,
  starterQuestions,
  type AdvisorLot,
  type FarmSnapshot,
} from "../src/packs/livestock/core/digest";
import { breedHint } from "../src/packs/livestock/vocabulary";
import {
  ADVISOR_DAILY_CAP,
  THREAD_TITLE_MAX,
  capMessage,
  historyForModel,
  threadTitle,
} from "../src/packs/livestock/core/threads";
import {
  ROUND_STALE_AFTER_DAYS,
  roundAttention,
  withdrawalAttention,
} from "../src/packs/livestock/core/attention";

/**
 * The pure half of `livestock`: head arithmetic.
 *
 * The head count is a BALANCE, never a counter — so all of this is a fold over
 * the ledger `inventory` already keeps. What is worth asserting is the
 * classification (which movement kinds mean a death rather than a move) and the
 * two places a wrong answer would be actively misleading: mortality before
 * anything has arrived, and an unknown birth date.
 */

const m = (movementKind: string, quantity: number) => ({ movementKind, quantity });

describe("headEffect", () => {
  it("classifies the kinds livestock writes", () => {
    expect(headEffect("placement")).toBe("intake");
    expect(headEffect("death")).toBe("death");
    expect(headEffect("cull")).toBe("removal");
    expect(headEffect("sold_live")).toBe("removal");
    expect(headEffect("split_out")).toBe("transfer");
    expect(headEffect("split_in")).toBe("transfer");
  });

  it("treats an unrecognised kind as a transfer", () => {
    // `movement_kind` is an open taxonomy, so this file WILL meet kinds it has
    // never heard of. Transfer is the safe assumption: it moves head without
    // claiming anything was placed or lost.
    expect(headEffect("weighed_out")).toBe("transfer");
  });
});

describe("summariseHead", () => {
  it("reproduces the design's worked example, and it balances to zero", () => {
    // Placed +70, died −4, culled −2, transferred −64 → balance 0.
    const summary = summariseHead([
      m("placement", 70),
      m("death", -4),
      m("cull", -2),
      m("split_out", -64),
    ]);
    expect(summary.intake).toBe(70);
    expect(summary.died).toBe(4);
    expect(summary.removed).toBe(2);
    expect(summary.balance).toBe(0);
  });

  it("counts a transfer IN as intake, so a pen has a mortality denominator", () => {
    // A pen split off a batch has no `placement` of its own. Without this its
    // mortality would divide by zero and read as unknown forever, which is the
    // number the broiler enterprise actually lives on.
    const summary = summariseHead([m("split_in", 70), m("death", -7)]);
    expect(summary.intake).toBe(70);
    expect(summary.balance).toBe(63);
    expect(mortalityRate(summary)).toBeCloseTo(0.1, 5);
  });

  it("does not let a transfer OUT reduce intake", () => {
    const summary = summariseHead([m("placement", 100), m("split_out", -40)]);
    expect(summary.intake).toBe(100);
    expect(summary.balance).toBe(60);
  });

  it("is all zeros for a lot with no movements", () => {
    const summary = summariseHead([]);
    expect(summary).toEqual({
      intake: 0,
      died: 0,
      removed: 0,
      transferred: 0,
      balance: 0,
    });
  });
});

describe("summarisePen", () => {
  // A pen of a hundred, five dead, four cows named out of it.
  const pen = summariseHead([m("placement", 100), m("death", -5), m("split_out", -4)]);
  const namedOutOfHere = (extra: { movementKind: string; quantity: number }[] = []) => {
    const movements = [m("split_in", 1), ...extra];
    return {
      summary: summariseHead(movements),
      splitInHead: splitInHead(movements),
      splitFromHere: true,
    };
  };

  it("counts the pen and its named animals ONCE", () => {
    // Summed naively the population would have taken in 104 head: the four
    // split-ins are transfers, and a transfer in is intake to the cow's own
    // fold so a split-off lot has a mortality denominator. Inside the pen she
    // came out of, it is the same head twice.
    const p = summarisePen(pen, [namedOutOfHere(), namedOutOfHere(), namedOutOfHere(), namedOutOfHere()]);
    expect(p.balance).toBe(95);
    expect(p.intake).toBe(100);
    expect(p.died).toBe(5);
    expect(mortalityRate(p)).toBeCloseTo(0.05);
  });

  it("a death inside a named animal is the pen's loss", () => {
    const p = summarisePen(pen, [
      namedOutOfHere([m("death", -1)]),
      namedOutOfHere(),
      namedOutOfHere(),
      namedOutOfHere(),
    ]);
    expect(p.died).toBe(6);
    expect(p.balance).toBe(94);
    expect(mortalityRate(p)).toBeCloseTo(0.06);
  });

  it("an animal that arrived from ANOTHER pen genuinely arrived", () => {
    const movements = [m("split_in", 1)];
    const p = summarisePen(pen, [
      { summary: summariseHead(movements), splitInHead: 1, splitFromHere: false },
    ]);
    expect(p.intake).toBe(101);
    expect(p.balance).toBe(92);
  });

  it("is the pen itself with nobody inside", () => {
    expect(summarisePen(pen, [])).toEqual(pen);
  });
});

describe("splitInHead", () => {
  it("adds up what arrived by split and nothing else", () => {
    expect(splitInHead([m("split_in", 3), m("placement", 10), m("split_out", -2)])).toBe(3);
    expect(splitInHead([m("placement", 10)])).toBe(0);
  });
});

describe("roundAttention", () => {
  const TODAY = "2026-09-08";
  const lot = (code: string, lastCheckedOn: string | null) => ({ id: code, code, lastCheckedOn });

  it("is nothing while every lot was looked at today or yesterday", () => {
    // Yesterday is an ordinary morning: today's round is still to come, and
    // raising it at 7am would raise every lot on the farm every day.
    expect(roundAttention([lot("PEN-1", TODAY), lot("PEN-2", "2026-09-07")], TODAY)).toBeNull();
  });

  it("raises ONE lot by name, overdue, due the day the round was first missed", () => {
    expect(ROUND_STALE_AFTER_DAYS).toBe(2);
    const item = roundAttention([lot("PEN-1", "2026-09-05"), lot("PEN-2", TODAY)], TODAY);
    expect(item).toMatchObject({
      key: "livestock_round:stale",
      title: "PEN-1 has not been looked at for 3 days",
      urgency: "overdue",
      dueOn: "2026-09-07",
      href: "/dashboard/m/livestock/log",
    });
  });

  it("says never rather than a number for a lot with no check at all", () => {
    expect(roundAttention([lot("Cows", null)], TODAY)?.title).toBe(
      "Cows has never been looked at",
    );
  });

  it("is ONE line for the farm however many lots were missed, naming four", () => {
    const item = roundAttention(
      ["A", "B", "C", "D", "E", "F"].map((c) => lot(c, "2026-09-01")),
      TODAY,
    );
    expect(item?.title).toBe("6 lots have not been looked at for 2 days or more");
    expect(item?.detail).toBe("A, B, C, D and 2 more");
  });
});

describe("withdrawalAttention", () => {
  const TODAY = "2026-09-08";
  const clock = (
    code: string,
    state: "clear" | "under" | "unknown",
    clearsOn: string | null,
    product: string | null = "Tylan",
    treatmentId: string | null = `t-${code}`,
    ownsTreatment = true,
  ) => ({ id: code, code, state, clearsOn, product, treatmentId, ownsTreatment });

  it("raises ONE line per treatment, on the record it was given to", () => {
    // A pen dosed in the water puts the same clock on the pen and on every
    // named animal in it. Five lines saying one label was never read is the
    // digest somebody mutes, and the fix is on the pen — whichever order
    // the rows arrive in.
    const items = withdrawalAttention(
      [
        clock("Speckles", "unknown", null, "Tylan", "t-pen", false),
        clock("PEN-1", "unknown", null, "Tylan", "t-pen", true),
        clock("Dot", "unknown", null, "Tylan", "t-pen", false),
        // Her own dose is a different treatment, and stays a line of its own.
        clock("Rosie", "unknown", null, "Penicillin G", "t-rosie", true),
      ],
      TODAY,
    );
    expect(items.map((i) => i.title)).toEqual([
      "PEN-1's withdrawal was never looked up",
      "Rosie's withdrawal was never looked up",
    ]);
  });

  it("raises a clock nobody looked up as overdue with no date", () => {
    const [item] = withdrawalAttention([clock("PEN-1", "unknown", null)], TODAY);
    expect(item).toMatchObject({
      key: "livestock_withdrawal_unknown:PEN-1",
      title: "PEN-1's withdrawal was never looked up",
      urgency: "overdue",
      dueOn: null,
      href: "/dashboard/m/livestock/PEN-1",
    });
    expect(item.detail).toContain("Tylan was given and nobody read the label");
  });

  it("raises the day it clears as today, and the day before as soon", () => {
    // `withdrawalStatus` clears ON the day, so the clearing day reads `clear`
    // with `clearsOn` today; the day before it is still `under`.
    const items = withdrawalAttention(
      [clock("HOGS-1", "clear", TODAY), clock("PEN-2", "under", "2026-09-09")],
      TODAY,
    );
    expect(items.map((i) => [i.title, i.urgency])).toEqual([
      ["HOGS-1 clears withdrawal today", "today"],
      ["PEN-2 clears withdrawal tomorrow", "soon"],
    ]);
  });

  it("says nothing about a clock with days to run, one that cleared last week, or no clock", () => {
    expect(
      withdrawalAttention(
        [
          clock("A", "under", "2026-09-20"),
          clock("B", "clear", "2026-09-01"),
          clock("C", "clear", null, null),
        ],
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe("mortalityRate", () => {
  it("is deaths over everything that arrived", () => {
    expect(
      mortalityRate(summariseHead([m("placement", 1000), m("death", -50)])),
    ).toBeCloseTo(0.05, 5);
  });

  it("is NULL when nothing has arrived, not zero", () => {
    // "No deaths" and "no animals" are different facts, and a lot showing 0%
    // before a single chick is placed reads as reassurance.
    expect(mortalityRate(summariseHead([]))).toBeNull();
    expect(formatRate(null)).toBe("—");
  });

  it("formats to one decimal, which is the precision that matters", () => {
    // At 1,000 birds the gap between 5% and 12% is most of the margin.
    expect(formatRate(0.05)).toBe("5.0%");
    expect(formatRate(0.1234)).toBe("12.3%");
  });
});

describe("age", () => {
  it("is null when the birth date is unknown", () => {
    // The ordinary case for stock bought in, and it must not read as newborn.
    expect(ageInDays(null, "2026-08-15")).toBeNull();
    expect(formatAge(null)).toBe("—");
  });

  it("counts days across months and a leap day", () => {
    expect(ageInDays("2026-08-01", "2026-08-15")).toBe(14);
    expect(ageInDays("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("switches units with the animal, because precision matters differently", () => {
    // A broiler's life is measured in weeks and it matters; nobody describes a
    // cow as 1,340 days old.
    expect(formatAge(1)).toBe("1 day");
    expect(formatAge(10)).toBe("10 days");
    expect(formatAge(49)).toBe("7 weeks");
    expect(formatAge(200)).toBe("6 months");
    expect(formatAge(1340)).toBe("3 years");
  });

  it("says 'not yet' rather than a negative age", () => {
    expect(formatAge(-3)).toBe("not yet");
  });
});

describe("preferredIdentifier", () => {
  const id = (kind: string, value: string, removedOn: string | null = null) => ({
    identifierKind: kind,
    value,
    removedOn,
  });

  it("prefers a current tag over a removed one", () => {
    const chosen = preferredIdentifier([
      id("visual", "47", "2026-07-01"),
      id("official", "USA-840", null),
    ]);
    expect(chosen?.value).toBe("USA-840");
  });

  it("prefers what a person says over what paperwork says", () => {
    const chosen = preferredIdentifier([
      id("official", "USA-840"),
      id("name", "Daisy"),
      id("visual", "47"),
    ]);
    expect(chosen?.value).toBe("Daisy");
  });

  it("falls back to a removed tag rather than nothing", () => {
    // "#47 (removed)" beats no answer when somebody is trying to identify an
    // animal in front of them.
    const chosen = preferredIdentifier([id("visual", "47", "2026-07-01")]);
    expect(chosen?.value).toBe("47");
  });

  it("handles a kind it has never heard of", () => {
    const chosen = preferredIdentifier([id("brand", "Lazy K")]);
    expect(chosen?.value).toBe("Lazy K");
  });

  it("is null when there are none", () => {
    expect(preferredIdentifier([])).toBeNull();
  });
});

describe("breedHint", () => {
  /**
   * The breed field carried a fixed "e.g. Cornish Cross", which sat under
   * Species: Cattle and read as an instruction rather than an example.
   * Reported by the founder, 2026-08-16.
   */
  it("follows the species chosen", () => {
    expect(breedHint("cattle")).toBe("e.g. Angus");
    expect(breedHint("poultry")).toBe("e.g. Cornish Cross");
  });

  it("gives NO hint for a species it does not know", () => {
    // Species is an open taxonomy fed by profile config, so this is the
    // ordinary path for anything a profile invents. An empty box beats a
    // confident irrelevance, which is the bug being fixed.
    expect(breedHint("alpaca")).toBeUndefined();
    expect(breedHint("")).toBeUndefined();
  });

  it("matches the way the form slugs a typed species", () => {
    // The picker's "Something else…" lets a person type "Beef Cattle", and
    // the form lowercases and underscores it before submitting. The hint has
    // to survive the same treatment or it only works for picker values.
    expect(breedHint("Cattle")).toBe("e.g. Angus");
    expect(breedHint("  POULTRY  ")).toBe("e.g. Cornish Cross");
  });
});

/**
 * The daily round.
 *
 * What is worth asserting here is not the arithmetic — it is the two places a
 * defensible-looking answer would quietly destroy the habit the slice exists to
 * build: a streak that resets every morning, and a "never checked" that renders
 * as zero days.
 */
describe("checkStreak", () => {
  it("counts consecutive days back from today", () => {
    expect(
      checkStreak(["2026-08-19", "2026-08-18", "2026-08-17"], "2026-08-19"),
    ).toBe(3);
  });

  it("does NOT break because today has not been walked yet", () => {
    // The whole point. At breakfast today has no entry, and a counter that
    // dropped to zero every morning would be a counter nobody keeps — so the
    // run is measured from yesterday when today is untouched.
    expect(checkStreak(["2026-08-18", "2026-08-17"], "2026-08-19")).toBe(2);
  });

  it("breaks after two days of silence", () => {
    // Yesterday is the furthest back the grace extends. A missed day is a
    // missed day, and a streak that forgives them means nothing.
    expect(checkStreak(["2026-08-17", "2026-08-16"], "2026-08-19")).toBe(0);
  });

  it("stops at the first gap rather than counting every entry", () => {
    expect(
      checkStreak(
        ["2026-08-19", "2026-08-18", "2026-08-15", "2026-08-14"],
        "2026-08-19",
      ),
    ).toBe(2);
  });

  it("ignores duplicate days and unsorted input", () => {
    // The query returns distinct days, but the order is the database's choice
    // and this must not depend on it.
    expect(
      checkStreak(
        ["2026-08-18", "2026-08-19", "2026-08-18", "2026-08-17"],
        "2026-08-19",
      ),
    ).toBe(3);
  });

  it("is zero when nothing has ever been recorded", () => {
    expect(checkStreak([], "2026-08-19")).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(
      checkStreak(["2026-09-01", "2026-08-31", "2026-08-30"], "2026-09-01"),
    ).toBe(3);
  });
});

describe("roundProgress", () => {
  const check = (livestockLotId: string, status = "normal") => ({
    livestockLotId,
    loggedOn: "2026-08-19",
    status,
  });

  it("names the lots still to look at, not just how many", () => {
    // `remaining` is what the "all normal" button acts on, so it has to be the
    // exact set — a count could not tell it which lots to leave alone.
    const progress = roundProgress(["a", "b", "c"], [check("b")]);
    expect(progress).toEqual({
      total: 3,
      checked: 1,
      remaining: ["a", "c"],
      needsAttention: [],
    });
  });

  it("separates a lot that was flagged from one that was never touched", () => {
    // The distinction this slice is built on. A flagged lot has been looked at
    // — it must not reappear in the list the one-tap button sweeps.
    const progress = roundProgress(["a", "b"], [check("a", "attention")]);
    expect(progress.remaining).toEqual(["b"]);
    expect(progress.needsAttention).toEqual(["a"]);
    expect(progress.checked).toBe(1);
  });

  it("ignores checks for lots that are not in the round", () => {
    // A lot whose animals have all gone is off the list, but its check for
    // today still exists and must not inflate the count.
    const progress = roundProgress(["a"], [check("a"), check("gone")]);
    expect(progress.total).toBe(1);
    expect(progress.checked).toBe(1);
  });

  it("is empty and complete when there is nothing to check", () => {
    expect(roundProgress([], [])).toEqual({
      total: 0,
      checked: 0,
      remaining: [],
      needsAttention: [],
    });
  });
});

describe("last checked", () => {
  it("distinguishes never from today", () => {
    // NULL IS NOT ZERO. A lot nobody has ever checked is the thing the round
    // screen exists to surface, and "0 days ago" would read as the opposite.
    expect(daysSinceCheck(null, "2026-08-19")).toBeNull();
    expect(formatLastChecked(null, "2026-08-19")).toBe("Never");
    expect(formatLastChecked("2026-08-19", "2026-08-19")).toBe("Today");
  });

  it("says yesterday rather than 1 day ago", () => {
    expect(formatLastChecked("2026-08-18", "2026-08-19")).toBe("Yesterday");
    expect(formatLastChecked("2026-08-16", "2026-08-19")).toBe("3 days ago");
  });

  it("treats a future-dated check as today rather than as negative days", () => {
    // Possible across a timezone boundary at midnight. "-1 days ago" is
    // nonsense; "Today" is at worst a few hours early.
    expect(formatLastChecked("2026-08-20", "2026-08-19")).toBe("Today");
  });
});

describe("lossesOn", () => {
  const mv = (occurredOn: string, movementKind: string, quantity: number) => ({
    occurredOn,
    movementKind,
    quantity,
  });

  it("adds up the day's losses from the LEDGER, not from the check", () => {
    // The losses are not stored on the daily log, so this is how the round
    // screen shows them. One number, read twice — never two kept in step.
    expect(
      lossesOn(
        [
          mv("2026-08-19", "death", -3),
          mv("2026-08-19", "cull", -1),
          mv("2026-08-18", "death", -9),
        ],
        "2026-08-19",
      ),
    ).toBe(4);
  });

  it("counts neither placements nor splits as losses", () => {
    expect(
      lossesOn(
        [
          mv("2026-08-19", "placement", 210),
          mv("2026-08-19", "split_out", -70),
          mv("2026-08-19", "sold_live", -2),
        ],
        "2026-08-19",
      ),
    ).toBe(0);
  });

  it("is zero on a day nothing was recorded", () => {
    expect(lossesOn([mv("2026-08-18", "death", -3)], "2026-08-19")).toBe(0);
  });
});

describe("soldOn", () => {
  const mv = (occurredOn: string, movementKind: string, quantity: number) => ({
    occurredOn,
    movementKind,
    quantity,
  });

  it("counts a live sale, which lossesOn deliberately does not", () => {
    // Recorded on the round as `Sold live`, the head left the count and then
    // showed nowhere — not under Lost today, because it is not a loss, and not
    // anywhere else, because nothing read it back. This is the other half.
    const day = [
      mv("2026-08-19", "sold_live", -2),
      mv("2026-08-19", "death", -3),
      mv("2026-08-18", "sold_live", -5),
    ];
    expect(soldOn(day, "2026-08-19")).toBe(2);
    expect(lossesOn(day, "2026-08-19")).toBe(3);
  });

  it("is zero when nothing was sold that day", () => {
    expect(soldOn([mv("2026-08-19", "death", -3)], "2026-08-19")).toBe(0);
    expect(soldOn([mv("2026-08-18", "sold_live", -3)], "2026-08-19")).toBe(0);
  });
});

describe("describeLeft", () => {
  it("says what left in the round's own words", () => {
    expect(describeLeft(3, 0)).toBe("3 lost");
    expect(describeLeft(0, 2)).toBe("2 sold live");
    expect(describeLeft(3, 2)).toBe("3 lost, 2 sold live");
  });

  it("is empty when nothing left, so a caller can say its own sentence", () => {
    expect(describeLeft(0, 0)).toBe("");
  });
});

/**
 * The farm digest.
 *
 * This is the advisory layer's whole differentiation — a model with no digest
 * is a worse search engine — so what is worth asserting is that the digest
 * never quietly misrepresents the farm: no silent truncation, no "0 days
 * rested" for ground nobody has grazed, and an empty farm that says so instead
 * of producing an answer-shaped void.
 */
const emptySnapshot: FarmSnapshot = {
  today: "2026-08-19",
  species: [],
  lots: [],
  lotsOmitted: 0,
  zones: [],
  zonesOmitted: 0,
  stock: [],
  streakDays: 0,
  checkedToday: 0,
};

const lot = (over: Partial<AdvisorLot> = {}): AdvisorLot => ({
  code: "B-1",
  species: "poultry",
  breed: "Cornish Cross",
  sex: "mixed",
  ageDays: 21,
  head: 66,
  intake: 70,
  died: 4,
  where: "Creek Paddock (Pen 3)",
  whereSince: "2026-08-10",
  losses: [{ on: "2026-08-14", ageDays: 16, head: 4 }],
  lastCheckedOn: "2026-08-19",
  feed: null,
  weight: null,
  withdrawal: null,
  ...over,
});

describe("formatSnapshot", () => {
  it("tells the advisor plainly when there is nothing recorded", () => {
    // The day-one case, and the one the advisory layer exists for. It must not
    // read as an error or produce a digest that looks like a farm with zeros.
    const text = formatSnapshot(emptySnapshot);
    expect(text).toContain("NO animal lots recorded yet");
    expect(text).toContain("general husbandry");
  });

  it("carries the loss RATE, not just the count", () => {
    // "Is this normal" is the commonest orienting question and it needs a rate.
    const text = formatSnapshot({ ...emptySnapshot, lots: [lot()] });
    expect(text).toContain("4 lost of 70 placed (5.7%)");
    expect(text).toContain("66 head");
    expect(text).toContain("3w old");
  });

  it("says where they are, since when, and when they were last looked at", () => {
    // "Since when" is what makes "where should they go next" answerable — the
    // first draft of this digest omitted it and the advisor said so itself.
    const text = formatSnapshot({ ...emptySnapshot, lots: [lot()] });
    expect(text).toContain("on Creek Paddock (Pen 3) since 2026-08-10");
    expect(text).toContain("last checked 2026-08-19");
  });

  it("dates the losses, and gives the age at each one", () => {
    // TIMING IMPLIES CAUSE. First-week losses point at chick quality or
    // brooding; late ones at heat and the leg and heart problems of fast
    // growth. A total with no dates cannot tell those apart, and an advisor
    // given one has to ask instead of answering.
    const text = formatSnapshot({
      ...emptySnapshot,
      lots: [
        lot({
          losses: [
            { on: "2026-08-14", ageDays: 16, head: 4 },
            { on: "2026-07-31", ageDays: 2, head: 3 },
          ],
        }),
      ],
    });
    expect(text).toContain("losses: 4 on 2026-08-14 (day 16), 3 on 2026-07-31 (day 2)");
  });

  it("omits the day number when the birth date is unknown", () => {
    // Ordinary for bought-in stock. "day null" would be worse than no day.
    const text = formatSnapshot({
      ...emptySnapshot,
      lots: [lot({ ageDays: null, losses: [{ on: "2026-08-14", ageDays: null, head: 2 }] })],
    });
    expect(text).toContain("losses: 2 on 2026-08-14");
    expect(text).not.toContain("(day");
  });

  it("states 'never checked' and 'not on a paddock' rather than omitting them", () => {
    // An advisor that cannot tell "no record" from "not applicable" answers
    // confidently about animals nobody has looked at in a fortnight.
    const text = formatSnapshot({
      ...emptySnapshot,
      lots: [lot({ where: null, lastCheckedOn: null })],
    });
    expect(text).toContain("not on a paddock");
    expect(text).toContain("never checked");
  });

  it("omits the loss rate when nothing has been placed", () => {
    // 0 of 0 is not 0%; it is unknown, and the same rule `mortalityRate`
    // follows for the same reason.
    const text = formatSnapshot({
      ...emptySnapshot,
      lots: [lot({ intake: 0, died: 0, head: 0 })],
    });
    expect(text).not.toContain("placed");
  });

  it("SAYS when the list was capped", () => {
    // Silent truncation is the bug: an advisor that saw 40 of 200 lots must not
    // answer as though it saw all of them.
    const text = formatSnapshot({
      ...emptySnapshot,
      lots: [lot()],
      lotsOmitted: 160,
    });
    expect(text).toContain("160 more lots NOT listed");
  });

  it("never reports rest days for ground that was never grazed", () => {
    const text = formatSnapshot({
      ...emptySnapshot,
      zones: [
        {
          name: "New Paddock",
          parcel: "Home Farm",
          areaAcres: 4,
          status: "never_grazed",
          restDays: null,
        },
        {
          name: "Creek",
          parcel: "Home Farm",
          areaAcres: 6,
          status: "resting",
          restDays: 14,
        },
        {
          name: "Barn Lot",
          parcel: "Home Farm",
          areaAcres: null,
          status: "occupied",
          restDays: null,
        },
      ],
    });
    expect(text).toContain("**New Paddock** (Home Farm) · 4 ac · never grazed");
    expect(text).toContain("rested 14 days");
    expect(text).toContain("occupied now");
    expect(text).not.toContain("rested 0 days");
  });

  it("reports the recording habit, because a stale record deserves a caveat", () => {
    const text = formatSnapshot({
      ...emptySnapshot,
      lots: [lot(), lot({ code: "B-2" })],
      checkedToday: 1,
      streakDays: 11,
    });
    expect(text).toContain("1 of 2 listed lots checked today");
    expect(text).toContain("11-day streak");
  });
});

describe("starterQuestions", () => {
  it("asks about a real lot first when there is one", () => {
    const starters = starterQuestions({
      species: ["poultry"],
      sampleLotCode: "B-2026-04-15",
      hasZones: true,
    });
    expect(starters[0]).toBe("Is the loss rate on B-2026-04-15 normal?");
  });

  it("is species-led, because the useful question differs per animal", () => {
    expect(
      starterQuestions({ species: ["swine"], sampleLotCode: null, hasZones: false }),
    ).toEqual(["How much should a 3-month pig be eating?"]);
    expect(
      starterQuestions({ species: ["cattle"], sampleLotCode: null, hasZones: false }),
    ).toEqual(["When should I wean the calves?"]);
  });

  it("falls back to general questions on a farm with nothing at all", () => {
    // The advisory layer's whole claim is that it works before anything is
    // recorded, so this is a first-class case rather than an empty state.
    const starters = starterQuestions({
      species: [],
      sampleLotCode: null,
      hasZones: false,
    });
    expect(starters.length).toBeGreaterThan(0);
    expect(starters[0]).toContain("mortality");
  });

  it("never offers more than four", () => {
    expect(
      starterQuestions({
        species: ["poultry", "swine", "cattle"],
        sampleLotCode: "B-1",
        hasZones: true,
      }),
    ).toHaveLength(4);
  });
});
describe("the advisor's threads", () => {
  it("titles a thread from its first question, cut to a line on a word", () => {
    expect(threadTitle("  Is the loss rate\non PEN-1   normal? ")).toBe(
      "Is the loss rate on PEN-1 normal?",
    );
    const long =
      "How much should a three month old pig be eating each day if it is on pasture and getting whey as well as a grower ration";
    const title = threadTitle(long);
    expect(title.length).toBeLessThanOrEqual(THREAD_TITLE_MAX + 1);
    expect(title.endsWith("…")).toBe(true);
    expect(title).toBe("How much should a three month old pig be eating each day if it is on pasture…");
    expect(threadTitle("   ")).toBe("Untitled");
    // A single unbroken word longer than the line is cut hard.
    expect(threadTitle("x".repeat(200))).toBe(`${"x".repeat(THREAD_TITLE_MAX)}…`);
  });

  it("hands the model the last turns, starting on a question", () => {
    const turns = [
      { role: "user" as const, content: "q1" },
      { role: "assistant" as const, content: "a1" },
      { role: "user" as const, content: "q2" },
      { role: "assistant" as const, content: "a2" },
      { role: "user" as const, content: "q3" },
      { role: "assistant" as const, content: "a3" },
    ];
    expect(historyForModel(turns, 20)).toEqual(turns);
    // Four back would open on a1; it opens on q2 instead.
    expect(historyForModel(turns, 5).map((t) => t.content)).toEqual(["q2", "a2", "q3", "a3"]);
    expect(historyForModel(turns, 2).map((t) => t.content)).toEqual(["q3", "a3"]);
    expect(historyForModel(turns, 0)).toEqual([]);
    expect(historyForModel([], 20)).toEqual([]);
    // A window that is all answers hands over nothing rather than a reply to nothing.
    expect(historyForModel([{ role: "assistant" as const, content: "a" }], 5)).toEqual([]);
  });

  it("says what the cap is, and how big", () => {
    expect(ADVISOR_DAILY_CAP).toBe(100);
    expect(capMessage(ADVISOR_DAILY_CAP)).toContain("100 questions");
  });
});
