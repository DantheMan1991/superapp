import { describe, expect, it } from "vitest";
import {
  DUE_ATTENTION_DAYS,
  EARLY_BIRTH_SLACK_DAYS,
  PREG_CHECK_SLACK_DAYS,
  breedingAttention,
  breedingCycles,
  currentCycle,
  describeCycle,
  dueStanding,
  dueWindow,
  isRunning,
  type BreedingEvidence,
  type ExposureLike,
} from "../src/packs/livestock/core/breeding";
import { gestationDaysFrom } from "../src/packs/livestock/vocabulary";

/**
 * Livestock slice 4c — the breeding calendar.
 *
 * **A bull means windows, not dates**, and the calendar is a fold over the
 * evidence rather than a stored due date. What is worth pinning:
 *
 *   1. The window an exposure sets, and that it grows while he is still in.
 *   2. A check narrows it, an open or a loss closes it, a birth fixes it —
 *      and says where in the window she calved.
 *   3. A check with no exposure still makes a cycle; a birth too early for
 *      the window does not close it.
 *   4. What the digest raises: the edges of the window, never the middle.
 */

const G = 283;

const exposure = (over: Partial<ExposureLike> = {}): ExposureLike => ({
  id: "x1",
  livestockLotId: "cows",
  sireLotId: "duke",
  exposedFrom: "2026-05-01",
  exposedTo: "2026-08-01",
  gestationDays: G,
  via: "own",
  ...over,
});

const evidence = (over: Partial<BreedingEvidence> = {}): BreedingEvidence => ({
  exposures: [],
  checks: [],
  births: [],
  gestationDays: G,
  ...over,
});

describe("the window an exposure sets", () => {
  it("in May 1, out Aug 1 means calves from Feb 8 to May 11", () => {
    expect(dueWindow(exposure(), "2026-09-08")).toEqual({
      from: "2027-02-08",
      to: "2027-05-11",
    });
  });

  it("grows by a day for every day the bull is still in", () => {
    const open = exposure({ exposedTo: null });
    expect(dueWindow(open, "2026-06-01").to).toBe("2027-03-11");
    expect(dueWindow(open, "2026-06-02").to).toBe("2027-03-12");
    // Never earlier than the day he went in, however the clock is set.
    expect(dueWindow(open, "2026-04-01")).toEqual({
      from: "2027-02-08",
      to: "2027-02-08",
    });
  });

  it("a hand service is a window of one day", () => {
    expect(
      dueWindow(
        { exposedFrom: "2026-06-10", exposedTo: "2026-06-10", gestationDays: 114 },
        "2026-09-08",
      ),
    ).toEqual({ from: "2026-10-02", to: "2026-10-02" });
  });
});

describe("the fold", () => {
  it("an exposure alone is a running cycle with the whole window", () => {
    const [cycle] = breedingCycles(evidence({ exposures: [exposure()] }), "2026-09-08");
    expect(cycle.state).toBe("exposed");
    expect(cycle.due).toEqual({ from: "2027-02-08", to: "2027-05-11" });
    expect(isRunning(cycle)).toBe(true);
    expect(describeCycle(cycle, "2026-09-08")).toBe(
      "Due 2027-02-08 to 2027-05-11 · in 153 days",
    );
  });

  it("a check that found her pregnant at 90 days narrows the window to a week either side", () => {
    const [cycle] = breedingCycles(
      evidence({
        exposures: [exposure()],
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 90 }],
      }),
      "2026-09-08",
    );
    expect(cycle.state).toBe("bred");
    expect(cycle.conceivedOn).toBe("2026-06-03");
    // 2026-06-03 + 283 = 2027-03-13, ± 7
    expect(cycle.due).toEqual({ from: "2027-03-06", to: "2027-03-20" });
    expect(describeCycle(cycle, "2026-09-08")).toBe("Due about 2027-03-13 · in 179 days");
  });

  it("the vet's date is kept inside the exposure window when they overlap, and trusted over it when they do not", () => {
    // 60 days bred on Sept 1 puts conception on July 3, inside the window;
    // the narrowed span is clipped to the window's own end where it runs past.
    const inside = breedingCycles(
      evidence({
        exposures: [exposure({ exposedTo: "2026-07-05" })],
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 60 }],
      }),
      "2026-09-08",
    )[0];
    // 2026-07-03 + 283 = 2027-04-12 ± 7 → 04-05..04-19, window ends 07-05+283 = 2027-04-14
    expect(inside.due).toEqual({ from: "2027-04-05", to: "2027-04-14" });

    // 200 days bred says she settled in February, before he went in at all —
    // the arm wins, and the window is hers alone.
    const outside = breedingCycles(
      evidence({
        exposures: [exposure()],
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 200 }],
      }),
      "2026-09-08",
    )[0];
    expect(outside.conceivedOn).toBe("2026-02-13");
    expect(outside.due).toEqual({ from: "2026-11-16", to: "2026-11-30" });
  });

  it("a confirmation with no estimate keeps the window as it was", () => {
    const [cycle] = breedingCycles(
      evidence({
        exposures: [exposure()],
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: null }],
      }),
      "2026-09-08",
    );
    expect(cycle.state).toBe("bred");
    expect(cycle.due).toEqual({ from: "2027-02-08", to: "2027-05-11" });
    expect(cycle.conceivedOn).toBeNull();
  });

  it("open closes the cycle with no due date, and so does a loss", () => {
    const open = breedingCycles(
      evidence({
        exposures: [exposure()],
        checks: [{ id: "c1", checkedOn: "2026-10-01", result: "open", daysBred: null }],
      }),
      "2026-10-08",
    )[0];
    expect(open.state).toBe("open");
    expect(open.due).toBeNull();
    expect(isRunning(open)).toBe(false);
    expect(describeCycle(open, "2026-10-08")).toBe("Found open 2026-10-01");

    const lost = breedingCycles(
      evidence({
        exposures: [exposure()],
        checks: [
          { id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 90 },
          { id: "c2", checkedOn: "2026-11-05", result: "lost", daysBred: null },
        ],
      }),
      "2026-11-08",
    )[0];
    expect(lost.state).toBe("lost");
    expect(lost.due).toBeNull();
    expect(describeCycle(lost, "2026-11-08")).toBe("Lost the pregnancy 2026-11-05");
  });

  it("A BIRTH FIXES IT, and says where in the window she calved", () => {
    const [cycle] = breedingCycles(
      evidence({
        exposures: [exposure()],
        births: [{ id: "calf", bornOn: "2027-03-01", head: 1 }],
      }),
      "2027-03-08",
    );
    expect(cycle.state).toBe("born");
    expect(cycle.due).toEqual({ from: "2027-03-01", to: "2027-03-01" });
    expect(cycle.conceivedOn).toBe("2026-05-22");
    expect(cycle.daysIntoWindow).toBe(21);
    expect(describeCycle(cycle, "2027-03-08")).toBe(
      "Gave birth 2027-03-01 · 21 days into the window",
    );
    expect(isRunning(cycle)).toBe(false);
  });

  it("a farrowing of ten is one birth, and an early one is said to be early", () => {
    const [cycle] = breedingCycles(
      evidence({
        exposures: [exposure({ exposedFrom: "2026-05-01", exposedTo: "2026-05-01", gestationDays: 114 })],
        births: [{ id: "litter", bornOn: "2026-08-20", head: 10 }],
        gestationDays: 114,
      }),
      "2026-09-08",
    );
    // Due 2026-08-23; born three days early.
    expect(cycle.daysIntoWindow).toBe(-3);
    expect(describeCycle(cycle, "2026-09-08")).toBe(
      "Gave birth 2026-08-20 · 10 born · 3 days before the window",
    );
  });

  it("a birth too early for the window is NOT this cycle's calf", () => {
    // A calf on Christmas Day out of a May–August exposure was conceived in
    // March, before he went in: an exposure nobody recorded. The May cycle
    // stays running rather than closing itself with a negative six weeks.
    const [cycle] = breedingCycles(
      evidence({
        exposures: [exposure()],
        births: [{ id: "early", bornOn: "2026-12-25", head: 1 }],
      }),
      "2027-01-08",
    );
    expect(cycle.state).toBe("exposed");
    expect(cycle.birth).toBeNull();
    // The boundary itself: exactly the slack before the window still counts.
    const edge = breedingCycles(
      evidence({
        exposures: [exposure()],
        births: [{ id: "edge", bornOn: "2027-01-09", head: 1 }],
      }),
      "2027-01-10",
    )[0];
    expect(edge.state).toBe("born");
    expect(edge.daysIntoWindow).toBe(-EARLY_BIRTH_SLACK_DAYS);
  });

  it("A CHECK WITH NO EXPOSURE ON FILE STILL MAKES A CYCLE", () => {
    const [cycle] = breedingCycles(
      evidence({
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 90 }],
      }),
      "2026-09-08",
    );
    expect(cycle.exposure).toBeNull();
    expect(cycle.state).toBe("bred");
    expect(cycle.due).toEqual({ from: "2027-03-06", to: "2027-03-20" });
    expect(cycle.openedOn).toBe("2026-09-01");

    // And with no gestation to push it forward, an honest blank.
    const undated = breedingCycles(
      evidence({
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 90 }],
        gestationDays: null,
      }),
      "2026-09-08",
    )[0];
    expect(undated.due).toBeNull();
    expect(describeCycle(undated, "2026-09-08")).toBe("Pregnant · due date not known");
    expect(dueStanding(undated, "2026-09-08")).toBe("undated");
  });

  it("a birth after a bare check closes that cycle", () => {
    const [cycle] = breedingCycles(
      evidence({
        checks: [{ id: "c1", checkedOn: "2026-09-01", result: "bred", daysBred: 90 }],
        births: [{ id: "calf", bornOn: "2027-03-10", head: 1 }],
      }),
      "2027-03-12",
    );
    expect(cycle.state).toBe("born");
    // No exposure, so no window to measure against.
    expect(cycle.daysIntoWindow).toBeNull();
    expect(describeCycle(cycle, "2027-03-12")).toBe("Gave birth 2027-03-10");
  });

  it("a second season is a second cycle, newest first", () => {
    const cycles = breedingCycles(
      evidence({
        exposures: [
          exposure({ id: "x2025", exposedFrom: "2025-05-01", exposedTo: "2025-08-01" }),
          exposure({ id: "x2026" }),
        ],
        births: [{ id: "calf-2026", bornOn: "2026-03-01", head: 1 }],
      }),
      "2026-09-08",
    );
    expect(cycles.map((c) => c.exposure?.id)).toEqual(["x2026", "x2025"]);
    expect(cycles[1].state).toBe("born");
    expect(cycles[0].state).toBe("exposed");
    expect(currentCycle(cycles)?.exposure?.id).toBe("x2026");
    expect(currentCycle([])).toBeNull();
  });

  it("an open found after a calving is its own line of history, not a rewrite of the calving", () => {
    const cycles = breedingCycles(
      evidence({
        exposures: [exposure({ exposedFrom: "2025-05-01", exposedTo: "2025-08-01" })],
        births: [{ id: "calf", bornOn: "2026-03-01", head: 1 }],
        checks: [{ id: "c1", checkedOn: "2026-10-01", result: "open", daysBred: null }],
      }),
      "2026-10-08",
    );
    expect(cycles.map((c) => c.state)).toEqual(["open", "born"]);
  });
});

describe("what the words say", () => {
  const running = (due: { from: string; to: string } | null) =>
    breedingCycles(
      evidence({
        exposures: due
          ? [exposure({ exposedFrom: "2026-05-01", exposedTo: "2026-08-01" })]
          : [],
      }),
      "2026-09-08",
    )[0];

  it("reads now, past and today off the window", () => {
    const cycle = running({ from: "2027-02-08", to: "2027-05-11" });
    expect(describeCycle(cycle, "2027-03-01")).toBe("Due now · 2027-02-08 to 2027-05-11");
    expect(dueStanding(cycle, "2027-03-01")).toBe("now");
    expect(describeCycle(cycle, "2027-05-23")).toBe(
      "12 days past the window · was due by 2027-05-11",
    );
    expect(dueStanding(cycle, "2027-05-23")).toBe("past");
    expect(describeCycle(cycle, "2027-05-12")).toBe(
      "1 day past the window · was due by 2027-05-11",
    );
    expect(dueStanding(cycle, "2027-01-20")).toBe("soon");
    expect(dueStanding(cycle, "2026-09-08")).toBe("later");
  });

  it("a single-day window reads as a date", () => {
    const [cycle] = breedingCycles(
      evidence({
        exposures: [exposure({ exposedFrom: "2026-06-10", exposedTo: "2026-06-10" })],
      }),
      "2027-03-19",
    );
    expect(describeCycle(cycle, "2027-03-19")).toBe("Due 2027-03-20 · in 1 day");
    expect(describeCycle(cycle, "2027-03-20")).toBe("Due today");
  });
});

describe("what the digest raises", () => {
  const lot = (id: string, due: { from: string; to: string }, state: "exposed" | "bred" = "exposed") => ({
    id,
    code: id.toUpperCase(),
    cycle: {
      exposure: null,
      check: null,
      birth: null,
      state,
      due,
      conceivedOn: null,
      daysIntoWindow: null,
      openedOn: "2026-05-01",
    },
  });

  it("the week before, the day itself, and past the end — never the middle", () => {
    const window = { from: "2027-02-08", to: "2027-05-11" };
    expect(breedingAttention([lot("rosie", window)], "2027-01-31")).toEqual([]);
    expect(breedingAttention([lot("rosie", window)], "2027-02-01")).toMatchObject([
      { urgency: "soon", title: "ROSIE is due in 7 days", dueOn: "2027-02-08" },
    ]);
    expect(breedingAttention([lot("rosie", window)], "2027-02-07")).toMatchObject([
      { title: "ROSIE is due in 1 day" },
    ]);
    expect(breedingAttention([lot("rosie", window)], "2027-02-08")).toMatchObject([
      { urgency: "today", title: "ROSIE is due from today", href: "/dashboard/m/livestock/rosie" },
    ]);
    expect(breedingAttention([lot("rosie", window)], "2027-03-15")).toEqual([]);
    expect(breedingAttention([lot("rosie", window)], "2027-05-11")).toEqual([]);
    expect(breedingAttention([lot("rosie", window)], "2027-05-12")).toMatchObject([
      {
        urgency: "overdue",
        title: "ROSIE is 1 day past the due window",
        detail: "Was due 2027-02-08 to 2027-05-11. Record the birth, or a check that found her open",
        dueOn: "2027-05-11",
      },
    ]);
    expect(DUE_ATTENTION_DAYS).toBe(7);
  });

  it("a closed cycle and an undated one are not raised", () => {
    const closed = lot("hazel", { from: "2027-02-08", to: "2027-02-08" });
    closed.cycle = { ...closed.cycle, state: "born" as never };
    expect(breedingAttention([closed], "2027-02-08")).toEqual([]);
    const undated = lot("mabel", { from: "x", to: "x" });
    undated.cycle = { ...undated.cycle, due: null as never };
    expect(breedingAttention([undated], "2027-02-08")).toEqual([]);
  });

  it("a hand service reads as one day", () => {
    expect(
      breedingAttention([lot("sow", { from: "2026-10-02", to: "2026-10-02" }, "bred")], "2026-10-02"),
    ).toMatchObject([{ detail: "Due window on 2026-10-02. Record the birth on her page when it comes" }]);
  });
});

describe("the gestation from the profile", () => {
  it("reads the species' figure, and nothing for a species nobody described", () => {
    const config = { gestationDays: { cattle: 283, swine: 114 } };
    expect(gestationDaysFrom(config, "cattle")).toBe(283);
    expect(gestationDaysFrom(config, " Swine ")).toBe(114);
    expect(gestationDaysFrom(config, "poultry")).toBeNull();
    expect(gestationDaysFrom({}, "cattle")).toBeNull();
    expect(gestationDaysFrom(null, "cattle")).toBeNull();
    expect(gestationDaysFrom({ gestationDays: { cattle: "283" } }, "cattle")).toBeNull();
    expect(gestationDaysFrom({ gestationDays: { cattle: 0 } }, "cattle")).toBeNull();
    expect(PREG_CHECK_SLACK_DAYS).toBe(7);
  });
});
