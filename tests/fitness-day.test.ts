import { describe, expect, it } from "vitest";
import {
  aimFor,
  aimWords,
  canHalve,
  dayOf,
  dayPartsWords,
  dayProgress,
  daySessionOf,
  hourIn,
  localDayIn,
  partOfDay,
  sessionsOn,
  shiftDay,
  toDayItem,
  type DaySession,
} from "../src/modules/fitness/core/day";
import {
  beginSession,
  canAddSet,
  finishExercise,
  finishSession,
  fullSets,
  nextStep,
  oneMoreSet,
  recordSet,
  sessionDocSchema,
  sessionSummary,
  type SessionDoc,
  type SessionPlan,
} from "../src/modules/fitness/core/session";

/**
 * SPLIT DAYS (docs/modules/fitness.md, F2c; approved from a mockup,
 * 2026-09-27): the program says "1–2 sets in the morning, 1–2 at night", and a
 * day counts when its sessions together meet every exercise's minimum. A day
 * walked from a morning half to an evening that picks up, with no clock. An
 * invented program, as every fitness test uses.
 */

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 27, hour, minute, 0));
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const DAY = "2026-09-27";

function plan(): SessionPlan {
  const base = { purpose: "", cues: [], notes: "", video: null, targetMax: null };
  return {
    programId: "11111111-1111-4111-8111-111111111111",
    programName: "Starter Mobility",
    phaseId: "22222222-2222-4222-8222-222222222222",
    phaseName: "Weeks 1–2",
    phaseIndex: 0,
    phaseCount: 1,
    phases: [{ id: "22222222-2222-4222-8222-222222222222", name: "Weeks 1–2" }],
    breath: { outS: 5, inS: 5 },
    effort: null,
    items: [
      {
        ...base,
        itemId: "44444444-4444-4444-8444-444444444444",
        exerciseId: "55555555-5555-4555-8555-555555555555",
        name: "Foam roll",
        unit: "rolls",
        perSide: false,
        optional: false,
        setsMin: 1,
        setsMax: null,
        targetMin: 15,
      },
      {
        ...base,
        itemId: "66666666-6666-4666-8666-666666666666",
        exerciseId: "77777777-7777-4777-8777-777777777777",
        name: "Side-lying pullback",
        unit: "breaths",
        perSide: true,
        optional: false,
        setsMin: 2,
        setsMax: 3,
        targetMin: 5,
      },
      {
        ...base,
        itemId: "88888888-8888-4888-8888-888888888888",
        exerciseId: "99999999-9999-4999-8999-999999999999",
        name: "Wall stack",
        unit: "reps",
        perSide: false,
        optional: false,
        setsMin: 3,
        setsMax: null,
        targetMin: 10,
      },
      {
        ...base,
        itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        exerciseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Extra drill",
        unit: "reps",
        perSide: false,
        optional: true,
        setsMin: 2,
        setsMax: null,
        targetMin: 10,
      },
    ],
  };
}

const items = () => plan().items.map(toDayItem);

/** Every set the session has next, done at the target, then the three taps, to the finish. */
function doAll(p: SessionPlan, doc: SessionDoc, hour: number): SessionDoc {
  let d = doc;
  for (let guard = 0; guard < 50; guard++) {
    const step = nextStep(p, d);
    if (step.kind === "finish") break;
    d =
      step.kind === "set"
        ? recordSet(p, d, { itemIndex: step.itemIndex, count: 5, setId: id(), exerciseId: id(), now: at(hour, 10) })
        : finishExercise(p, d, {
            itemIndex: step.itemIndex,
            effort: null,
            cuesFelt: [],
            hurt: null,
            hurtNote: "",
            now: at(hour, 12),
          });
  }
  return finishSession(d, { feelAfter: null, now: at(hour, 20) });
}

describe("a set is a full set", () => {
  it("counts a per-side set once both sides are done", () => {
    expect(fullSets(false, [null, null, null])).toBe(3);
    expect(fullSets(true, ["right", "left", "right"])).toBe(1);
    expect(fullSets(true, ["right", "left", "right", "left"])).toBe(2);
    expect(fullSets(true, ["right"])).toBe(0);
    expect(fullSets(true, [])).toBe(0);
  });
});

describe("a split day, from a morning half to an evening that picks up", () => {
  it("plans half of every exercise's sets in the morning, rounded up", () => {
    const p = plan();
    const fresh = dayProgress(items(), []);
    expect(fresh).toMatchObject({ done: 0, left: 6, complete: false, parts: [] });
    expect(canHalve(fresh)).toBe(true);
    expect(aimFor(fresh, "all").map((a) => a.sets)).toEqual([1, 2, 3, 2]);
    const half = aimFor(fresh, "half");
    expect(half.map((a) => a.sets)).toEqual([1, 1, 2, 1]);
    // "One more set" may reach the program's maximum for the day.
    expect(half.map((a) => a.max)).toEqual([1, 3, 3, 2]);

    let morning = beginSession(p, { id: id(), now: at(8), feelBefore: 5, aim: half });
    expect(sessionDocSchema.safeParse(morning).success).toBe(true);
    morning = doAll(p, morning, 8);
    expect(morning.exercises.map((e) => e.plannedSets)).toEqual([1, 1, 2, 1]);
    // One set of the per-side exercise is both sides: two rows, one set.
    expect(morning.exercises[1].sets.map((s) => s.side)).toEqual(["right", "left"]);
    expect(sessionSummary(morning).sets).toBe(5);

    const day = dayProgress(items(), sessionsOn(DAY, [], [daySessionOf(morning)]));
    expect(day.items.map((i) => [i.done, i.left])).toEqual([
      [1, 0],
      [1, 1],
      [2, 1],
      [1, 1],
    ]);
    // The optional drill is never "left" for the day.
    expect(day).toMatchObject({ done: 5, left: 2, complete: false });
    expect(day.parts).toEqual([
      { id: morning.id, startedAt: morning.startedAt, sets: 5, minutes: 20, finished: true },
    ]);
  });

  it("starts the evening on what is left, passing over what the morning finished", () => {
    const p = plan();
    const morning = doAll(p, beginSession(p, { id: id(), now: at(8), feelBefore: null, aim: aimFor(dayProgress(items(), []), "half") }), 8);
    const day = dayProgress(items(), sessionsOn(DAY, [daySessionOf(morning)], []));
    // Every exercise has one set or fewer to go: halving would change nothing.
    expect(canHalve(day)).toBe(false);
    const rest = aimFor(day, "all");
    expect(rest.map((a) => a.sets)).toEqual([0, 1, 1, 1]);

    let evening = beginSession(p, { id: id(), now: at(19), feelBefore: null, aim: rest });
    // The foam roll was done this morning: the evening begins at the pullback.
    expect(nextStep(p, evening)).toEqual({ kind: "set", itemIndex: 1, number: 1, side: "right" });
    evening = doAll(p, evening, 19);
    expect(evening.exercises.map((e) => e.name)).toEqual(["Side-lying pullback", "Wall stack", "Extra drill"]);

    const after = dayProgress(items(), sessionsOn(DAY, [daySessionOf(morning)], [daySessionOf(evening)]));
    expect(after).toMatchObject({ left: 0, complete: true });
    expect(after.parts.map((part) => part.sets)).toEqual([5, 3]);
    expect(dayPartsWords(after, (iso) => new Date(iso).getUTCHours())).toBe("Morning · 5 sets, Evening · 3 sets");
  });

  it("keeps the day within the program's maximum when one more set is added", () => {
    const p = plan();
    const morning = doAll(p, beginSession(p, { id: id(), now: at(8), feelBefore: null, aim: aimFor(dayProgress(items(), []), "half") }), 8);
    const rest = aimFor(dayProgress(items(), sessionsOn(DAY, [daySessionOf(morning)], [])), "all");
    // The pullback is "2–3 sets": one this morning, so tonight may go to two.
    expect(rest[1]).toMatchObject({ sets: 1, max: 2 });
    let evening = beginSession(p, { id: id(), now: at(19), feelBefore: null, aim: rest });
    for (const side of [0, 1]) {
      evening = recordSet(p, evening, { itemIndex: 1, count: 5, setId: id(), exerciseId: id(), now: at(19, side) });
    }
    expect(nextStep(p, evening)).toEqual({ kind: "check", itemIndex: 1 });
    expect(canAddSet(p, evening, 1)).toBe(true);
    evening = oneMoreSet(p, evening, 1);
    expect(canAddSet(p, evening, 1)).toBe(false);
    expect(oneMoreSet(p, evening, 1)).toBe(evening);
  });

  it("offers a whole session again once the day is complete, which counts too", () => {
    const p = plan();
    const whole = doAll(p, beginSession(p, { id: id(), now: at(8), feelBefore: null, aim: aimFor(dayProgress(items(), []), "all") }), 8);
    const day = dayProgress(items(), [daySessionOf(whole)]);
    expect(day.complete).toBe(true);
    expect(canHalve(day)).toBe(false);
    expect(aimFor(day, "again").map((a) => a.sets)).toEqual([1, 2, 3, 2]);
  });

  it("treats a session from before split days as a whole one", () => {
    const p = plan();
    const old = beginSession(p, { id: id(), now: at(8), feelBefore: null });
    expect(old).not.toHaveProperty("aim");
    expect(sessionDocSchema.safeParse(old).success).toBe(true);
    expect(nextStep(p, old)).toEqual({ kind: "set", itemIndex: 0, number: 1, side: null });
  });

  it("counts a one-sided exercise's sets once each, so its day can be done (F4b)", () => {
    const base = plan();
    // The pullback, for someone who leans left: lying on the left only.
    const p: SessionPlan = {
      ...base,
      lean: "left",
      items: base.items.map((item, i) => (i === 1 ? { ...item, perSide: false, onlySide: "left", sideMeans: "lying" } : item)),
    };
    const dayItems = p.items.map(toDayItem);
    const whole = doAll(p, beginSession(p, { id: id(), now: at(8), feelBefore: null }), 8);
    const pullback = whole.exercises.find((e) => e.name === "Side-lying pullback");
    expect(pullback?.sets.map((s) => s.side)).toEqual(["left", "left"]);
    expect(dayProgress(dayItems, [daySessionOf(whole)]).complete).toBe(true);
    // The same two sets on both sides would be one full set, and the day not done.
    expect(fullSets(true, ["left", "left"])).toBe(0);
  });
});

describe("adding a day up from the server and the phone", () => {
  const session = (over: Partial<DaySession>): DaySession => ({
    id: id(),
    localDay: DAY,
    startedAt: at(8).toISOString(),
    endedAt: at(8, 15).toISOString(),
    finished: true,
    items: [{ itemId: plan().items[2].itemId, sets: 2 }],
    phaseId: null,
    feelBefore: null,
    feelAfter: null,
    efforts: [],
    ...over,
  });

  it("takes the phone's copy of a session over the server's, and only today's, oldest first", () => {
    const sent = session({ startedAt: at(18).toISOString(), items: [{ itemId: plan().items[2].itemId, sets: 1 }] });
    const newer = { ...sent, items: [{ itemId: plan().items[2].itemId, sets: 2 }] };
    const earlier = session({ startedAt: at(7).toISOString() });
    const yesterday = session({ localDay: shiftDay(DAY, -1) });
    const day = sessionsOn(DAY, [sent, yesterday, earlier], [newer]);
    expect(day.map((s) => s.id)).toEqual([earlier.id, sent.id]);
    expect(day[1].items[0].sets).toBe(2);
  });

  it("leaves out the session going on now, and one of another program's items", () => {
    const p = plan();
    const open = beginSession(p, { id: id(), now: at(9), feelBefore: null });
    const other = session({ items: [{ itemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sets: 4 }] });
    const day = dayOf(items(), DAY, [other, daySessionOf(open)], [open], open.id);
    expect(day).toMatchObject({ done: 0, parts: [], complete: false });
  });

  it("says a session left open is not finished, and how long it has run", () => {
    const p = plan();
    let open = beginSession(p, { id: id(), now: at(8), feelBefore: null });
    open = recordSet(p, open, { itemIndex: 0, count: 12, setId: id(), exerciseId: id(), now: at(8, 7) });
    const day = dayProgress(items(), [daySessionOf(open)]);
    // Twelve of fifteen rolls is still one of the day's sets (the founder's call).
    expect(day.items[0]).toMatchObject({ done: 1, left: 0 });
    expect(day.parts[0]).toMatchObject({ sets: 1, minutes: 7, finished: false });
  });
});

describe("what the start screen says", () => {
  const p = plan();
  const fresh = dayProgress(items(), []);
  const words = (day: typeof fresh, choice: "all" | "half" | "again") => {
    const aims = aimFor(day, choice);
    return p.items.map((item, i) => aimWords(item, day.items[i], aims[i], choice));
  };

  it("says the prescription on a whole session, and the share on a split one", () => {
    expect(words(fresh, "all")).toEqual(["1 × 15 rolls", "2–3 × 5 breaths per side", "3 × 10 reps", "2 × 10 reps"]);
    expect(words(fresh, "half")).toEqual(["1 set", "1 of 2 sets", "2 of 3 sets", "1 of 2 sets"]);
  });

  it("says what is left once the day has started, and what is done", () => {
    const morning = doAll(p, beginSession(p, { id: id(), now: at(8), feelBefore: null, aim: aimFor(fresh, "half") }), 8);
    const day = dayProgress(items(), [daySessionOf(morning)]);
    expect(words(day, "all")).toEqual(["done today", "1 more set", "1 more set", "1 more set"]);
    expect(words(dayProgress(items(), []), "again")).toEqual(words(fresh, "all"));
  });
});

describe("the person's own day and hour", () => {
  it("reads a day and an hour on the space's clock, and names the part of the day", () => {
    const iso = "2026-09-28T02:30:00Z";
    expect(localDayIn("America/Chicago", new Date(iso))).toBe("2026-09-27");
    expect(localDayIn("Europe/London", new Date(iso))).toBe("2026-09-28");
    expect(hourIn("America/Chicago", iso)).toBe(21);
    expect(hourIn("UTC", iso)).toBe(2);
    expect(localDayIn("Not/AZone", new Date(iso))).toBe("2026-09-28");
    expect([4, 5, 11, 12, 16, 17, 20, 21].map(partOfDay)).toEqual([
      "Night",
      "Morning",
      "Morning",
      "Afternoon",
      "Afternoon",
      "Evening",
      "Evening",
      "Night",
    ]);
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});
