import { describe, expect, it } from "vitest";
import {
  applyPin,
  asLineShape,
  baseDescription,
  coveredRooms,
  describeWithRooms,
  shapeLines,
  type RoomArea,
  type ShapingAssembly,
} from "../src/packs/jobs/line-shaping";
import type { ProposedShape } from "../src/packs/jobs/walk-lines-math";

/**
 * HOW MANY LINES, AND WHOSE WORDS (X11).
 *
 * The founder: *"with LVP flooring I typically just have one item for lvp
 * that lists all of the rooms that includes. But for Showers I typically
 * list each one seperatly. not always though."*
 *
 * X8b made that a rule in a prompt. This is the same answer as a FACT on the
 * item — which is the difference between a model getting it right most of
 * the time and the software not deciding at all.
 */

const ROOMS: RoomArea[] = [
  { name: "Great room", areaThousandths: 420_000, areaUnit: "sf" },
  { name: "Kitchen", areaThousandths: 310_000, areaUnit: "sf" },
  { name: "Master bath", areaThousandths: 62_000, areaUnit: "sf" },
  { name: "Hall bath", areaThousandths: 48_000, areaUnit: "sf" },
  /** A room nobody measured, which is allowed and has to stay so. */
  { name: "Pantry", areaThousandths: null, areaUnit: "" },
];

const LVP: ShapingAssembly = {
  name: "LVP flooring",
  lineShape: "one_line",
  drivingUnit: "sf",
};
const SHOWER: ShapingAssembly = {
  name: "Tiled shower",
  lineShape: "per_room",
  drivingUnit: "ea",
};
const CARPET: ShapingAssembly = {
  name: "Carpet",
  lineShape: "per_room",
  drivingUnit: "sf",
};

function shape(over: Partial<ProposedShape> = {}): ProposedShape {
  return { description: "LVP flooring", assembly: "LVP flooring", ...over };
}

describe("asLineShape", () => {
  it("reads the two values the column can hold", () => {
    expect(asLineShape("per_room")).toBe("per_room");
    expect(asLineShape("one_line")).toBe("one_line");
  });

  /** Anything else is what the walk did before the column existed. */
  it("falls back to one line rather than throwing", () => {
    expect(asLineShape("")).toBe("one_line");
    expect(asLineShape("whatever")).toBe("one_line");
  });
});

describe("baseDescription", () => {
  it("takes a trailing room list off", () => {
    expect(
      baseDescription("Tiled shower — master bath, hall bath", ["Master bath", "Hall bath"]),
    ).toBe("Tiled shower");
  });

  it("reads a plain hyphen as well as a dash", () => {
    expect(baseDescription("LVP flooring - great room, kitchen", ["Kitchen"])).toBe(
      "LVP flooring",
    );
  });

  /**
   * **THE COMMONEST DESCRIPTION IN THIS TRADE HAS A DASH IN IT** and no room
   * after it. Cutting one of those would lose the scope the estimator wrote.
   */
  it("keeps a description whose tail is not a room", () => {
    expect(baseDescription("Tile — mud set, Schluter, mtl only", ["Master bath"])).toBe(
      "Tile — mud set, Schluter, mtl only",
    );
  });

  it("keeps it whole when the room is in the name rather than the tail", () => {
    expect(baseDescription("Master bath tile — mud set", ["Master bath"])).toBe(
      "Master bath tile — mud set",
    );
  });

  it("never cuts to nothing, and does nothing with no rooms", () => {
    expect(baseDescription("— kitchen", ["Kitchen"])).toBe("— kitchen");
    expect(baseDescription("Anything — at all", [])).toBe("Anything — at all");
  });
});

describe("describeWithRooms", () => {
  it("names the rooms the line covers", () => {
    expect(describeWithRooms("LVP flooring", ["Great room", "Kitchen"])).toBe(
      "LVP flooring — Great room, Kitchen",
    );
  });

  /** A room already worked into the name is not said twice. */
  it("does not repeat a room the description already names", () => {
    expect(describeWithRooms("Master bath tile", ["Master bath"])).toBe("Master bath tile");
  });

  /**
   * **A ROOM SPELLED A THIRD WAY IS ADDED, NOT SWAPPED.** The cut only fires
   * on a tail that is recognisably the rooms, and `great rm` is not `Great
   * room` to anything here. Adding reads a little oddly and loses nothing,
   * which is the right way round: the alternative is cutting words nobody
   * can prove were a room list.
   */
  it("adds the room rather than cutting words it cannot recognise", () => {
    expect(describeWithRooms("LVP flooring — great rm", ["Great room"])).toBe(
      "LVP flooring — great rm — Great room",
    );
  });

  it("is the description itself when no rooms are named", () => {
    expect(describeWithRooms("Footing concrete", [])).toBe("Footing concrete");
  });
});

describe("coveredRooms", () => {
  it("answers in the building's own spelling", () => {
    expect(coveredRooms(shape({ rooms: ["great room", "KITCHEN"] }), ROOMS)).toEqual([
      ROOMS[0],
      ROOMS[1],
    ]);
  });

  /**
   * **A NAME THE BUILDING DOES NOT KNOW IS KEPT.** A walk of a house where
   * nobody listed the rooms still says *"the two baths"*, and dropping it
   * would lose the scope off the line.
   */
  it("keeps a room that is not on the list", () => {
    expect(coveredRooms(shape({ rooms: ["Safe room"] }), ROOMS)).toEqual([
      { name: "Safe room", areaThousandths: null, areaUnit: "" },
    ]);
  });

  it("says each room once", () => {
    expect(coveredRooms(shape({ rooms: ["Kitchen", "kitchen", " Kitchen "] }), ROOMS)).toHaveLength(
      1,
    );
  });
});

describe("shapeLines — one line, naming the rooms", () => {
  it("rolls two mentions of the same item into one line", () => {
    const out = shapeLines(
      [
        shape({ rooms: ["Great room"], unit: "sf", quantityThousandths: 420_000, derivedFrom: "great room 420" }),
        shape({ rooms: ["Kitchen"], unit: "sf", quantityThousandths: 310_000, derivedFrom: "kitchen 310" }),
      ],
      [LVP],
      ROOMS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("LVP flooring — Great room, Kitchen");
    expect(out[0].quantityThousandths).toBe(730_000);
    expect(out[0].derivedFrom).toBe("great room 420 + kitchen 310");
  });

  /**
   * **AN UNKNOWN IS NOT A ZERO.** A roll-up that quietly dropped one half
   * would come out looking like a measured number for a floor it covers only
   * part of — the plausible wrong number this whole layer refuses.
   */
  it("gives up the quantity rather than adding to an unknown", () => {
    const out = shapeLines(
      [
        shape({ rooms: ["Great room"], unit: "sf", quantityThousandths: 420_000 }),
        shape({ rooms: ["Pantry"], unit: "sf" }),
      ],
      [LVP],
      ROOMS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantityThousandths).toBeUndefined();
    expect(out[0].description).toBe("LVP flooring — Great room, Pantry");
  });

  /** Two units are two things, whatever they are called. */
  it("does not roll up across units", () => {
    const out = shapeLines(
      [
        shape({ rooms: ["Great room"], unit: "sf", quantityThousandths: 420_000 }),
        shape({ rooms: ["Kitchen"], unit: "lf", quantityThousandths: 60_000 }),
      ],
      [LVP],
      ROOMS,
    );
    expect(out).toHaveLength(2);
  });

  it("names the rooms on a single mention too", () => {
    const out = shapeLines(
      [shape({ rooms: ["Great room", "Kitchen", "Pantry"], unit: "sf" })],
      [LVP],
      ROOMS,
    );
    expect(out[0].description).toBe("LVP flooring — Great room, Kitchen, Pantry");
  });
});

describe("shapeLines — a line for each room", () => {
  it("splits one shape into a line per room", () => {
    const out = shapeLines(
      [
        {
          description: "Tiled shower — master bath, hall bath",
          assembly: "Tiled shower",
          unit: "ea",
          rooms: ["Master bath", "Hall bath"],
        },
      ],
      [SHOWER],
      ROOMS,
    );
    expect(out.map((l) => l.description)).toEqual([
      "Tiled shower — Master bath",
      "Tiled shower — Hall bath",
    ]);
    /** One of it each, because a shower is not measured by the room. */
    expect(out.map((l) => l.quantityThousandths)).toEqual([1_000, 1_000]);
    expect(out[0].derivedFrom).toBe("one in Master bath");
  });

  /**
   * **PRICED IN THE UNIT THE ROOMS ARE MEASURED IN** is what makes a room's
   * own floor area the right quantity — and that is a contract the estimator
   * opts into per assembly, not a guess the software makes.
   */
  it("sizes each line by that room's floor area when the units agree", () => {
    const out = shapeLines(
      [
        {
          description: "Carpet",
          assembly: "Carpet",
          unit: "sf",
          rooms: ["Great room", "Kitchen"],
        },
      ],
      [CARPET],
      ROOMS,
    );
    expect(out.map((l) => l.quantityThousandths)).toEqual([420_000, 310_000]);
    expect(out.map((l) => l.derivedFrom)).toEqual([
      "Great room floor area",
      "Kitchen floor area",
    ]);
  });

  it("falls back to one of it in a room nobody measured", () => {
    const out = shapeLines(
      [{ description: "Carpet", assembly: "Carpet", unit: "sf", rooms: ["Kitchen", "Pantry"] }],
      [CARPET],
      ROOMS,
    );
    expect(out[1].quantityThousandths).toBe(1_000);
    expect(out[1].derivedFrom).toBe("one in Pantry");
  });

  /** One room is already a line per room; nothing to do and nothing changed. */
  it("leaves a single-room line alone", () => {
    const out = shapeLines(
      [{ description: "Tiled shower", assembly: "Tiled shower", rooms: ["Master bath"] }],
      [SHOWER],
      ROOMS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Tiled shower — Master bath");
  });
});

describe("shapeLines — everything else", () => {
  /** The 20% that is custom must pass through untouched. */
  it("leaves a line that is no assembly of theirs alone", () => {
    const one = { description: "Fully custom wood door", unit: "ea", quantityThousandths: 1_000 };
    expect(shapeLines([one], [LVP, SHOWER], ROOMS)).toEqual([one]);
  });

  it("still names the rooms on a line with no assembly", () => {
    const out = shapeLines(
      [{ description: "Base and case", rooms: ["Great room"] }],
      [LVP],
      ROOMS,
    );
    expect(out[0].description).toBe("Base and case — Great room");
  });

  it("is nothing when there is nothing", () => {
    expect(shapeLines([], [LVP], ROOMS)).toEqual([]);
  });
});

describe("applyPin", () => {
  it("puts the phase's own item on the first line", () => {
    const out = applyPin(
      [{ description: "Drywall" }, { description: "Corner bead, bullnose" }],
      "Drywall, hung and finished",
    );
    expect(out[0].assembly).toBe("Drywall, hung and finished");
    /** **AND THE OTHER LINES STAY** — 20% of his work is one-offs. */
    expect(out[1].assembly).toBeUndefined();
  });

  /**
   * **A DECISION THE LIBRARY SUPPORTS BEATS A DEFAULT.** Found by driving:
   * overwriting a line that already names another saved item would throw the
   * estimator's own choice away to honour a step's default.
   */
  it("skips past a line that already names another assembly of theirs", () => {
    const out = applyPin(
      [
        { description: "Arched opening", assembly: "Archway, drywall" },
        { description: "Drywall" },
      ],
      "Drywall, hung and finished",
    );
    expect(out[0].assembly).toBe("Archway, drywall");
    expect(out[1].assembly).toBe("Drywall, hung and finished");
  });

  it("stands aside when every line has already claimed one", () => {
    const shapes = [
      { description: "Arched opening", assembly: "Archway, drywall" },
      { description: "Coffered ceiling", assembly: "Coffer, drywall" },
    ];
    expect(applyPin(shapes, "Drywall, hung and finished")).toEqual(shapes);
  });

  it("changes nothing when the walk already named it", () => {
    const shapes = [{ description: "Drywall", assembly: "drywall, hung and finished" }];
    expect(applyPin(shapes, "Drywall, hung and finished")).toEqual(shapes);
  });

  /** A phase that is by others proposed no lines, and stays that way. */
  it("does not invent a line to pin it to", () => {
    expect(applyPin([], "Drywall, hung and finished")).toEqual([]);
  });

  it("does nothing for a step with no pin", () => {
    const shapes = [{ description: "Drywall" }];
    expect(applyPin(shapes, null)).toEqual(shapes);
    expect(applyPin(shapes, "   ")).toEqual(shapes);
  });
});
