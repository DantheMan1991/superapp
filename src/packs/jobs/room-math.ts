import { formatQuantity } from "./billing-math";
import { measureSlug, readMeasureReply } from "./measure-math";

/**
 * THE ARITHMETIC OF THE ROOMS IN A BUILDING (X8).
 *
 * Pure, so `tests/jobs-rooms.test.ts` can hold the rules without a database.
 * `room-ops.ts` is the half that writes them.
 *
 * ── A ROOM IS A NAME, A FLOOR AND AN AREA ───────────────────────────────────
 *
 * The founder, asked what a room actually needs to carry: *"the only reason
 * i said we should measure each room is we need to know flooring sq
 * footage."* So that is what is here. The area is a `job_measurements` row
 * scoped to the room (ADR 0100), which is why nothing in this file parses a
 * number itself — `readMeasureReply` already reads `310`, `24 x 40` and
 * `38'-6"`, and a room's area has to mean what a building's area means.
 */

/**
 * The same reduction measurements use. Deliberately shared: a room and the
 * measurement scoped to it have to agree about what the same name is.
 */
export { measureSlug as roomSlug } from "./measure-math";

/**
 * **THE NAME A ROOM'S AREA IS FILED UNDER.**
 *
 * One constant, because the ops write it and the reads look it up, and a
 * room whose area was written as `Floor Area` and read as `Floor area`
 * would be a room that quietly has no area. The slug reduction makes the
 * two agree anyway; this makes sure there is only ever one to reduce.
 */
export const FLOOR_AREA = "Floor area";

/** A room as the pure half reads it. */
export interface RoomFacts {
  id: string;
  name: string;
  slug: string;
  level: string;
  /** Its floor area, when one has been taken. */
  areaThousandths: number | null;
  /** As the measurement was taken: "sf", "m2". Blank when there is no area. */
  areaUnit: string;
}

/** One line of a pasted list, read. */
export interface ParsedRoom {
  name: string;
  level: string;
  /** Null when the line was a name on its own. */
  areaThousandths: number | null;
}

export interface ParsedRoomList {
  rooms: ParsedRoom[];
  /** Lines that could not be read, in full, so the screen can show them. */
  skipped: string[];
}

/**
 * **A LIST SOMEBODY PASTES, ONE ROOM A LINE.**
 *
 * Typing fifteen rooms one at a time is the reason a feature like this goes
 * unused, so the whole list arrives at once — off a finish schedule, out of
 * a spreadsheet, or typed.
 *
 * A line is `name`, or `name` and an area separated by a tab, a comma or two
 * or more spaces. **A single space is not a separator**, because `Master
 * bedroom` would otherwise become a room called `Master` with an unreadable
 * area.
 *
 * A line ending in a colon is a FLOOR, and every room under it belongs to it
 * until the next one. That is the one bit of structure worth reading,
 * because it is how anybody writes a room list by hand.
 */
export function parseRoomList(text: string): ParsedRoomList {
  const rooms: ParsedRoom[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let level = "";

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;

    /** "Main floor:" — a heading, not a room. */
    if (line.endsWith(":")) {
      level = line.slice(0, -1).trim();
      continue;
    }

    const cut = line.match(/^(.*?)(?:\t+|\s*,\s*|\s{2,})(\S.*)$/);
    const name = (cut ? cut[1] : line).trim();
    const areaText = cut ? cut[2].trim() : "";
    if (name === "" || measureSlug(name) === "") {
      skipped.push(line);
      continue;
    }

    let areaThousandths: number | null = null;
    if (areaText !== "") {
      const read = readMeasureReply(areaText);
      /**
       * An area that cannot be read does not lose the room. The name is the
       * valuable half and the number can be filled in after — dropping the
       * line would make somebody hunt for what went missing.
       */
      if (read.kind === "value") areaThousandths = read.valueThousandths;
    }

    /** The same room twice in one paste is one room. */
    const key = `${measureSlug(level)}/${measureSlug(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rooms.push({ name, level, areaThousandths });
  }

  return { rooms, skipped };
}

/** "310 sf", or nothing yet. */
export function formatRoomArea(room: RoomFacts): string {
  if (room.areaThousandths === null) return "no area yet";
  return `${formatQuantity(room.areaThousandths)} ${room.areaUnit}`.trim();
}

/**
 * The rooms as the walk's prompt carries them, grouped by floor.
 *
 * This is the point of the slice: with these in front of it the walk can ask
 * *"what flooring in the master bedroom?"* instead of *"how much flooring?"*,
 * and can allocate one answer across the rooms it covers.
 */
export function roomLines(rooms: readonly RoomFacts[]): string[] {
  /**
   * Grouped HERE, not by the caller. Reading a floor heading off "is this
   * row's level different from the last one" needs the rows already sorted,
   * and the day they are not, `Main floor:` appears twice and the prompt
   * says something untrue about the building.
   */
  const levels: string[] = [];
  for (const r of rooms) if (!levels.includes(r.level)) levels.push(r.level);
  const out: string[] = [];
  for (const level of levels) {
    if (level.trim() !== "") out.push(`${level}:`);
    for (const r of rooms.filter((x) => x.level === level)) {
      out.push(`- ${r.name}: ${formatRoomArea(r)}`);
    }
  }
  return out;
}

/** What the floors add up to. Rooms with no area are simply not in it. */
export function totalFloorArea(rooms: readonly RoomFacts[]): number {
  return rooms.reduce((n, r) => n + (r.areaThousandths ?? 0), 0);
}

/** The ones still owing a number, so a screen can say how many are left. */
export function roomsWithoutArea(rooms: readonly RoomFacts[]): RoomFacts[] {
  return rooms.filter((r) => r.areaThousandths === null);
}

