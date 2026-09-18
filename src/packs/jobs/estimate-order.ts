/**
 * WHERE A ROW SITS ON AN ESTIMATE, AND HOW TO SAY IT (ADR 0087).
 *
 * An estimate is an ORDERED document. The order is already load-bearing —
 * `buildPayload` emits each item's lines beneath it and the loose ones last,
 * and `saveLines` turns that emitted order into `sort_order` — but until now
 * the only way to change it was to delete a line and type it again lower
 * down, which loses its id, its cost code and its client wording.
 *
 * Two ways in, one function underneath:
 *
 * - **Drag** a row onto another row. `dragTo` is `arrayMove` over the order
 *   the screen draws, so a row takes the slot it was dropped on, and a line
 *   dragged into another item joins it.
 * - **Type its number.** Every row shows one: items `1`, `2`, `3`, a line
 *   `2.1`, `2.2` — its item's number and its place in it. Type `3` over a
 *   line's `2.1` and it moves to third in its own item; type `3.1` and it
 *   moves to the top of item 3. The founder's own words: *"if a group is #10
 *   and I want it right after #2 I change the 10 to 3."*
 *
 * **Nothing here knows about React, dnd-kit or the database.** The editor holds
 * the drafts, and these functions hand back a new list — which is what makes
 * the addressing arithmetic testable without rendering a row.
 *
 * **The list that comes back is always in VISUAL ORDER**, because that is the
 * order `buildPayload` writes and therefore the order the database keeps. A
 * function that returned "the same array with two elements swapped" would put
 * the screen and `sort_order` out of step the first time a line crossed into
 * another item.
 */

/** A row as the order reads it: what it is called, and which item it is in. */
export interface Placed {
  /** Stable for the row's whole life, id or not — a new line has no id yet. */
  key: string;
  /** The item's key; anything else, including "", is the loose pile. */
  groupKey: string;
}

/** The loose pile: the section every line that names no live item falls into. */
export const LOOSE = "";

/** The sections in the order the screen draws them: each item, then the loose pile. */
export function sectionsOf(groupKeys: readonly string[]): string[] {
  return [...groupKeys, LOOSE];
}

/**
 * The section a line is DRAWN in — its item, or the loose pile once that item
 * is gone. Removing an item leaves its lines loose (ADR 0079), and this is the
 * sentence that says so for the order.
 */
export function sectionOf(line: Placed, groupKeys: readonly string[]): string {
  return groupKeys.includes(line.groupKey) ? line.groupKey : LOOSE;
}

/**
 * The lines in the order the screen draws them: each item's beneath it, the
 * loose ones last. A stable partition, so two lines in one item keep the order
 * they were in.
 */
export function inVisualOrder<L extends Placed>(lines: readonly L[], groupKeys: readonly string[]): L[] {
  return sectionsOf(groupKeys).flatMap((key) => lines.filter((l) => sectionOf(l, groupKeys) === key));
}

/** The rows of one section, in order. */
export function linesIn<L extends Placed>(
  lines: readonly L[],
  groupKeys: readonly string[],
  section: string,
): L[] {
  return inVisualOrder(lines, groupKeys).filter((l) => sectionOf(l, groupKeys) === section);
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** `arrayMove`, kept here so a pure core imports nothing to reorder a list. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [taken] = out.splice(from, 1);
  out.splice(clamp(to, 0, out.length), 0, taken);
  return out;
}

/** Move the item at `from` to 1-based `position`, clamped to the list. */
export function moveItem<G>(groups: readonly G[], from: number, position: number): G[] {
  if (from < 0 || from >= groups.length) return [...groups];
  return moved(groups, from, clamp(position, 1, groups.length) - 1);
}

/**
 * Put `key` at 1-based `position` in `section`. A position past the end lands
 * last, a section that is not an item lands in the loose pile, and a key that
 * is not there changes nothing.
 */
export function placeLine<L extends Placed>(
  lines: readonly L[],
  groupKeys: readonly string[],
  key: string,
  section: string,
  position: number,
): L[] {
  const row = lines.find((l) => l.key === key);
  if (!row) return [...lines];
  const target = groupKeys.includes(section) ? section : LOOSE;
  const rest = inVisualOrder(
    lines.filter((l) => l.key !== key),
    groupKeys,
  );
  const peers = rest.filter((l) => sectionOf(l, groupKeys) === target);
  const at = clamp(position, 1, peers.length + 1) - 1;
  const placed = [...peers.slice(0, at), { ...row, groupKey: target }, ...peers.slice(at)];
  return sectionsOf(groupKeys).flatMap((s) =>
    s === target ? placed : rest.filter((l) => sectionOf(l, groupKeys) === s),
  );
}

/**
 * A DRAG: `key` takes the slot `overKey` is in, and joins its section. The
 * `arrayMove` idiom, so dragging the first row onto the third leaves it third
 * rather than second — which is what the hand expects and what every sortable
 * list does.
 */
export function dragTo<L extends Placed>(
  lines: readonly L[],
  groupKeys: readonly string[],
  key: string,
  overKey: string,
): L[] {
  if (key === overKey) return [...lines];
  const flat = inVisualOrder(lines, groupKeys);
  const from = flat.findIndex((l) => l.key === key);
  const to = flat.findIndex((l) => l.key === overKey);
  if (from < 0 || to < 0) return [...lines];
  const section = sectionOf(flat[to], groupKeys);
  const after = moved(flat, from, to);
  return inVisualOrder(
    after.map((l) => (l.key === key ? { ...l, groupKey: section } : l)),
    groupKeys,
  );
}

/** Dropped on a section's own row rather than on a line: it joins at the end. */
export function dropInSection<L extends Placed>(
  lines: readonly L[],
  groupKeys: readonly string[],
  key: string,
  section: string,
): L[] {
  return placeLine(lines, groupKeys, key, section, Number.MAX_SAFE_INTEGER);
}

/** A row's number as it is typed and read. `null` section means "where it already is". */
export interface Address {
  /** 1-based item number, or `null` for a bare position. */
  section: number | null;
  /** 1-based place within that section. */
  position: number;
}

/**
 * READ A TYPED NUMBER. `3` is a place in the row's own section; `3.2` is
 * section 3, place 2 — which is how a line leaves one item for another with
 * the keyboard alone. `2-1` is taken too, because a hyphen is what half of a
 * keyboard's muscle memory types.
 *
 * Anything else is refused rather than guessed: a box that quietly did
 * nothing, or moved a row somewhere nobody asked for, is worse than one that
 * puts the old number back.
 */
export function parseAddress(text: string): Address | null {
  const m = /^\s*(?:(\d{1,4})\s*[.\-/]\s*)?(\d{1,4})\s*$/.exec(text);
  if (!m) return null;
  const section = m[1] === undefined ? null : Number(m[1]);
  const position = Number(m[2]);
  if (position < 1 || (section !== null && section < 1)) return null;
  return { section, position };
}

/**
 * The number a line shows. With no items at all it is a bare place in the
 * list — `1`, `2`, `3` — because there is no section to name; once the
 * estimate has items every line is `<item>.<place>`, and the loose pile is the
 * section after the last item, so `4.1` is an address like any other and
 * typing it is how a line comes OUT of an item.
 */
export function lineNumber(sectionIndex: number, position: number, hasSections: boolean): string {
  return hasSections ? `${sectionIndex + 1}.${position}` : String(position);
}
