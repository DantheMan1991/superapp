import { roomIsNamedIn } from "./room-math";
import type { AssemblyLineShape } from "@/db/schema";
import type { ProposedShape } from "./walk-lines-math";

/**
 * HOW MANY LINES, AND WHOSE WORDS (X11). Pure — no database, no model, no
 * money.
 *
 * ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────
 *
 * The founder, asked how the estimate sheet should read: *"with LVP flooring
 * I typically just have one item for lvp that lists all of the rooms that
 * includes. But for Showers I typically list each one seperatly. not always
 * though."*
 *
 * X8b made that a RULE IN A PROMPT — *roll up what is identical, split what
 * differs* — which works, and which a model re-decides from scratch on every
 * bid. This is the same answer recorded as a FACT instead: an assembly
 * carries `one_line` or `per_room`, the estimator sets it once, and the
 * shaping below is arithmetic rather than judgement.
 *
 * ── THE ROOMS COME OUT OF A FIELD, NOT OUT OF THE SENTENCE ──────────────────
 *
 * A shape now carries `rooms` beside its description, which is what makes
 * splitting possible at all: you cannot turn *"Tiled shower — master bath,
 * hall bath"* into two lines without knowing where the name ends and the
 * list begins. The description is composed HERE, from the building's own
 * spelling of the room, so the same room reads the same on every bid — which
 * was the original complaint.
 *
 * `baseDescription` is the belt to that braces: a model told to keep the
 * rooms out of the description will sometimes put them there anyway, and a
 * split that left every room name on all three lines would be worse than no
 * split at all.
 *
 * ── WHAT `per_room` PROMISES, EXACTLY ───────────────────────────────────────
 *
 * One line per room, sized by that room's floor area **when the item is
 * priced in the unit the rooms are measured in**, and one of it otherwise.
 * That is a contract an estimator opts into per assembly, not a guess the
 * software makes: tiled showers are priced `ea` and come out one per room;
 * carpet is priced `sf` and comes out at each room's own area, with the room
 * named in `derivedFrom` so the number is checkable at a glance.
 *
 * **Nothing here computes a quantity for `one_line`.** A rolled-up line needs
 * one number, the walk already hands the model every room's area and requires
 * the working (rule 2b), and adding a second, invisible way to arrive at the
 * same figure is how two answers to one question get shipped.
 */

/** Quantities are thousandths (ADR 0064). */
const ONE = 1_000;

/** A room as the shaping needs it: a name, and its floor area when known. */
export interface RoomArea {
  name: string;
  areaThousandths: number | null;
  areaUnit: string;
}

/**
 * The stored column, read as one of the two things it can be.
 *
 * A CHECK constraint keeps the column honest, so this only ever has work to
 * do on a value written before the constraint existed — and the answer it
 * gives then is the behaviour that came before it, which is the right one.
 */
export function asLineShape(stored: string): AssemblyLineShape {
  return stored === "per_room" ? "per_room" : "one_line";
}

/** An assembly as the shaping needs it. */
export interface ShapingAssembly {
  name: string;
  lineShape: AssemblyLineShape;
  drivingUnit: string;
}

/** How long a description may be, matching the line's own column. */
const DESCRIPTION_MAX = 300;

function reduce(text: string): string {
  return text.trim().toLowerCase();
}

/** Two spellings of one unit: `SF`, ` sf `, `sf` are the same unit. */
function sameUnit(a: string, b: string): boolean {
  const l = reduce(a).replace(/\s+/g, "");
  const r = reduce(b).replace(/\s+/g, "");
  return l !== "" && l === r;
}

/**
 * The item this shape names, out of the library. By name, ignoring case and
 * surrounding space, which is how `proposeLines` has always matched one.
 */
export function assemblyFor(
  shape: ProposedShape,
  assemblies: readonly ShapingAssembly[],
): ShapingAssembly | null {
  if (!shape.assembly) return null;
  const want = reduce(shape.assembly);
  return assemblies.find((a) => reduce(a.name) === want) ?? null;
}

/**
 * The rooms a shape covers, in the building's own spelling.
 *
 * A name the building does not know is KEPT rather than dropped — a walk of a
 * house where nobody listed the rooms still says *"the two baths"*, and
 * losing that off the line would lose the scope with it.
 */
export function coveredRooms(
  shape: ProposedShape,
  rooms: readonly RoomArea[],
): RoomArea[] {
  const out: RoomArea[] = [];
  const seen = new Set<string>();
  for (const raw of shape.rooms ?? []) {
    const name = raw.trim();
    if (name === "") continue;
    const key = reduce(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const exact = rooms.find((r) => reduce(r.name) === key);
    const named = exact ?? rooms.find((r) => roomIsNamedIn(r.name, name));
    out.push(named ?? { name, areaThousandths: null, areaUnit: "" });
  }
  return out;
}

/**
 * The description with a trailing room list taken off it.
 *
 * Cut only at a dash, only when the tail names a room and the head does not,
 * and never to nothing. `Tile — mud set, Schluter, mtl only` keeps every word
 * of itself, because none of those is a room.
 */
export function baseDescription(
  description: string,
  roomNames: readonly string[],
): string {
  const base = description.trim();
  if (roomNames.length === 0) return base;
  const at = base.search(/\s+[—–-]\s+/);
  if (at === -1) return base;
  const head = base.slice(0, at).trim();
  const tail = base.slice(at);
  if (head === "") return base;
  const tailHasRoom = roomNames.some((n) => roomIsNamedIn(n, tail));
  const headHasRoom = roomNames.some((n) => roomIsNamedIn(n, head));
  return tailHasRoom && !headHasRoom ? head : base;
}

/** `LVP flooring` and three rooms → `LVP flooring — Great room, Kitchen, Dining`. */
export function describeWithRooms(
  description: string,
  roomNames: readonly string[],
): string {
  const base = baseDescription(description, roomNames);
  const names = roomNames.map((n) => n.trim()).filter((n) => n !== "");
  if (names.length === 0) return base.slice(0, DESCRIPTION_MAX);
  /** A room the estimator already worked into the name is not repeated. */
  const missing = names.filter((n) => !roomIsNamedIn(n, base));
  if (missing.length === 0) return base.slice(0, DESCRIPTION_MAX);
  return `${base} — ${missing.join(", ")}`.slice(0, DESCRIPTION_MAX);
}

/** One room's share of a `per_room` line: its floor area, or one of it. */
function perRoomQuantity(
  shape: ProposedShape,
  assembly: ShapingAssembly,
  room: RoomArea,
): { quantityThousandths?: number; derivedFrom?: string } {
  const unit = (shape.unit ?? "").trim() || assembly.drivingUnit;
  if (
    room.areaThousandths !== null &&
    room.areaThousandths > 0 &&
    sameUnit(unit, room.areaUnit)
  ) {
    return {
      quantityThousandths: room.areaThousandths,
      derivedFrom: `${room.name} floor area`,
    };
  }
  /**
   * **NO QUANTITY, RATHER THAN A SHARE OF SOMEBODY ELSE'S.** Dividing the
   * line's total between the rooms would produce a number for each that
   * nobody stated and nothing supports. One of it is what a line per room
   * means when the item is not measured by the room.
   */
  return { quantityThousandths: ONE, derivedFrom: `one in ${room.name}` };
}

/**
 * The shapes, as many lines as the assemblies say they are.
 *
 * Order is preserved and a rolled-up line stays where its FIRST part was, so
 * the bid reads in the order the phase was talked through.
 */
export function shapeLines(
  shapes: readonly ProposedShape[],
  assemblies: readonly ShapingAssembly[],
  rooms: readonly RoomArea[],
): ProposedShape[] {
  const out: ProposedShape[] = [];
  /** Where a `one_line` assembly's line already is, by assembly and unit. */
  const rolledAt = new Map<string, number>();

  for (const shape of shapes) {
    const assembly = assemblyFor(shape, assemblies);
    const covered = coveredRooms(shape, rooms);

    /* A line each, with the room in the description and its own size. */
    if (assembly?.lineShape === "per_room" && covered.length > 1) {
      for (const room of covered) {
        out.push({
          ...shape,
          description: describeWithRooms(shape.description, [room.name]),
          rooms: [room.name],
          ...perRoomQuantity(shape, assembly, room),
        });
      }
      continue;
    }

    /* One line, every room named in it, however many times it was mentioned. */
    if (assembly?.lineShape === "one_line") {
      const key = `${reduce(assembly.name)}|${reduce(shape.unit ?? "")}`;
      const at = rolledAt.get(key);
      if (at !== undefined) {
        out[at] = rollInto(out[at], shape, covered);
        continue;
      }
      rolledAt.set(key, out.length);
    }

    out.push({
      ...shape,
      description: describeWithRooms(shape.description, covered.map((r) => r.name)),
      rooms: covered.length > 0 ? covered.map((r) => r.name) : undefined,
    });
  }

  return out;
}

/**
 * A second mention of the same item, folded into the line already there.
 *
 * **THE QUANTITIES ADD ONLY WHEN BOTH ARE KNOWN.** An unknown is not a zero,
 * and a roll-up that quietly dropped one half would come out looking like a
 * measured number for a floor it only covers part of — which is a line
 * nobody can catch by reading it.
 */
function rollInto(
  into: ProposedShape,
  shape: ProposedShape,
  covered: readonly RoomArea[],
): ProposedShape {
  const names = [
    ...(into.rooms ?? []),
    ...covered.map((r) => r.name),
  ];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const key = reduce(n);
    if (n.trim() === "" || seen.has(key)) continue;
    seen.add(key);
    unique.push(n.trim());
  }

  const both =
    into.quantityThousandths !== undefined && shape.quantityThousandths !== undefined;
  const workings = [into.derivedFrom, shape.derivedFrom]
    .map((w) => (w ?? "").trim())
    .filter((w) => w !== "");

  return {
    ...into,
    description: describeWithRooms(into.description, unique),
    rooms: unique.length > 0 ? unique : undefined,
    quantityThousandths: both
      ? (into.quantityThousandths ?? 0) + (shape.quantityThousandths ?? 0)
      : undefined,
    derivedFrom: both && workings.length > 0 ? workings.join(" + ") : into.derivedFrom,
  };
}

/**
 * **THE PIN, APPLIED** (X11): the phase's own assembly, guaranteed.
 *
 * A step that names an assembly is a business saying *this phase is always
 * that item*. The prompt says so too — and a prompt is a request. This is the
 * part that does not ask: if nothing the walk proposed names the pinned
 * assembly, the first UNCLAIMED line gets it, because that line is the
 * phase's main one and the pin is about exactly that line.
 *
 * Nothing is lost by it. An assembly supplies its own descriptions and its
 * own prices when it is exploded, so what the shape contributes is what the
 * conversation is actually good for — how much of it there is, and where.
 *
 * **A LINE THAT ALREADY NAMES ANOTHER ASSEMBLY IS NEVER OVERWRITTEN.**
 * Driving this found the case: a step pinned to one item, and a walk that
 * came back naming a different saved item for its first line. Taking that
 * line would throw away a decision the estimator's own library supports in
 * order to honour a default. The pin goes to the first line that has not
 * claimed one, and when every line has, the pin steps aside entirely.
 *
 * **AND THE OTHER LINES STAY.** Eighty per cent of his work is standard and
 * twenty is not; a phase that is always drywall can still have a one-off in
 * it, and a pin that deleted it would make the feature something to switch
 * off.
 */
export function applyPin(
  shapes: readonly ProposedShape[],
  pinnedName: string | null,
): ProposedShape[] {
  const want = (pinnedName ?? "").trim();
  if (want === "" || shapes.length === 0) return [...shapes];
  if (shapes.some((s) => reduce(s.assembly ?? "") === reduce(want))) return [...shapes];
  const at = shapes.findIndex((s) => (s.assembly ?? "").trim() === "");
  if (at === -1) return [...shapes];
  return shapes.map((s, i) => (i === at ? { ...s, assembly: want } : s));
}
