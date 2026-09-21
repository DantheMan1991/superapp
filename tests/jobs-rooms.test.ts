import { describe, expect, it } from "vitest";
import {
  formatRoomArea,
  parseRoomList,
  roomLines,
  roomSlug,
  roomsWithoutArea,
  totalFloorArea,
  type RoomFacts,
} from "../src/packs/jobs/room-math";

/**
 * THE ROOMS IN A BUILDING (X8).
 *
 * The founder: *"you should identify the rooms on every floor... then the
 * estimate questions can start asking questions like what type of flooring
 * in Master bedroom."* And, on what a room has to carry: *"the only reason
 * i said we should measure each room is we need to know flooring sq
 * footage."*
 *
 * A name, a floor, an area. The rules below are about getting a list of
 * fifteen of them in without typing fifteen forms.
 */

function room(over: Partial<RoomFacts> = {}): RoomFacts {
  return {
    id: "r1",
    name: "Master bedroom",
    slug: "master-bedroom",
    level: "Upstairs",
    areaThousandths: 224_000,
    areaUnit: "sf",
    ...over,
  };
}

describe("roomSlug", () => {
  it("is the same reduction a measurement uses", () => {
    expect(roomSlug("Master Bedroom")).toBe("master-bedroom");
    expect(roomSlug("  Master   bedroom ")).toBe("master-bedroom");
    expect(roomSlug("W.I.C.")).toBe("w-i-c");
  });
});

describe("parseRoomList", () => {
  it("takes a plain list, one room a line", () => {
    const { rooms, skipped } = parseRoomList("Kitchen\nGreat room\nMaster bath");
    expect(rooms.map((r) => r.name)).toEqual(["Kitchen", "Great room", "Master bath"]);
    expect(rooms.every((r) => r.areaThousandths === null)).toBe(true);
    expect(skipped).toEqual([]);
  });

  /**
   * **A SINGLE SPACE IS NOT A SEPARATOR.** `Master bedroom` would otherwise
   * become a room called `Master` with an unreadable area — and the name is
   * the half that matters.
   */
  it("does not split a two-word name", () => {
    const { rooms } = parseRoomList("Master bedroom");
    expect(rooms).toEqual([{ name: "Master bedroom", level: "", areaThousandths: null }]);
  });

  it("takes an area after a tab, a comma or a wide gap", () => {
    const { rooms } = parseRoomList("Kitchen\t310\nGreat room, 420\nMaster bath   62");
    expect(rooms.map((r) => r.areaThousandths)).toEqual([310_000, 420_000, 62_000]);
  });

  /** The area goes through the measurement parser, so it reads what that reads. */
  it("reads an area the way the walk reads one", () => {
    const { rooms } = parseRoomList("Kitchen\t24 x 40\nHall\t2,400 sf");
    expect(rooms.map((r) => r.areaThousandths)).toEqual([960_000, 2_400_000]);
  });

  /** A line ending in a colon is a floor, and it sticks until the next one. */
  it("reads a floor heading and hangs the rooms under it", () => {
    const { rooms } = parseRoomList(
      "Main floor:\nKitchen\t310\nGreat room\t420\nUpstairs:\nMaster bedroom\t224",
    );
    expect(rooms.map((r) => [r.level, r.name])).toEqual([
      ["Main floor", "Kitchen"],
      ["Main floor", "Great room"],
      ["Upstairs", "Master bedroom"],
    ]);
  });

  /**
   * **AN UNREADABLE AREA DOES NOT LOSE THE ROOM.** Dropping the line would
   * make somebody hunt for what went missing; keeping the name and leaving
   * the number blank is visible and fixable.
   */
  it("keeps a room whose area could not be read", () => {
    const { rooms } = parseRoomList("Kitchen\tbig-ish");
    expect(rooms).toEqual([{ name: "Kitchen", level: "", areaThousandths: null }]);
  });

  it("is one room when the same one is pasted twice", () => {
    const { rooms } = parseRoomList("Kitchen\nkitchen\nKITCHEN\t310");
    expect(rooms).toHaveLength(1);
  });

  /** The same name on two floors is two rooms, which is what a house is. */
  it("keeps the same name on different floors apart", () => {
    const { rooms } = parseRoomList("Main floor:\nBathroom\nUpstairs:\nBathroom");
    expect(rooms.map((r) => r.level)).toEqual(["Main floor", "Upstairs"]);
  });

  it("skips a line with no name in it, and says which", () => {
    const { rooms, skipped } = parseRoomList("Kitchen\n---\n   \n***\t40");
    expect(rooms.map((r) => r.name)).toEqual(["Kitchen"]);
    expect(skipped).toEqual(["---", "***\t40"]);
  });
});

describe("roomLines", () => {
  /** These go into the walk's prompt; a floor named twice is a lie about the house. */
  it("groups by floor even when the rows arrive jumbled", () => {
    expect(
      roomLines([
        room({ name: "Kitchen", level: "Main floor", areaThousandths: 310_000 }),
        room({ name: "Master bedroom", level: "Upstairs" }),
        room({ name: "Great room", level: "Main floor", areaThousandths: 420_000 }),
      ]),
    ).toEqual([
      "Main floor:",
      "- Kitchen: 310 sf",
      "- Great room: 420 sf",
      "Upstairs:",
      "- Master bedroom: 224 sf",
    ]);
  });

  it("says plainly when a room has no area yet", () => {
    expect(roomLines([room({ level: "", areaThousandths: null, areaUnit: "" })])).toEqual([
      "- Master bedroom: no area yet",
    ]);
  });

  it("writes no heading for a room on no named floor", () => {
    expect(roomLines([room({ level: "" })])).toEqual(["- Master bedroom: 224 sf"]);
  });
});

describe("formatRoomArea, totalFloorArea and roomsWithoutArea", () => {
  it("reads the unit off the measurement rather than assuming feet", () => {
    expect(formatRoomArea(room())).toBe("224 sf");
    expect(formatRoomArea(room({ areaThousandths: 20_800, areaUnit: "m2" }))).toBe("20.8 m2");
  });

  it("adds up the floors, counting a room with no area as nothing", () => {
    expect(
      totalFloorArea([
        room({ areaThousandths: 310_000 }),
        room({ areaThousandths: 420_000 }),
        room({ areaThousandths: null }),
      ]),
    ).toBe(730_000);
  });

  it("names the rooms still owing a number", () => {
    const rooms = [room({ name: "Kitchen" }), room({ name: "Pantry", areaThousandths: null })];
    expect(roomsWithoutArea(rooms).map((r) => r.name)).toEqual(["Pantry"]);
  });
});
