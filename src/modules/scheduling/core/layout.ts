/**
 * Where overlapping events sit in a day column.
 *
 * Pure, and separated from the grid component on purpose: this is the only part
 * of the calendar that is real arithmetic rather than markup, and it is the part
 * that is wrong in most hand-rolled calendars. Testable in milliseconds; the
 * component around it is not.
 *
 * THE RULE, as every calendar implements it: events that overlap share the width
 * of the column. Two concurrent events get half each, three get a third.
 *
 * TWO THINGS THAT ARE EASY TO GET BACKWARDS.
 *
 * A cluster's width is its maximum CONCURRENCY, not how many events are in it.
 * A 9–10, B 9:30–10:30, C 10–11 is three events chained together but only two
 * columns wide, because no instant has three running. C reuses A's column.
 *
 * And "overlaps" has to be chased TRANSITIVELY anyway, even though it does not
 * set the width: A and C never touch, but if they were laid out independently
 * each would take the full column and collide with B. Clustering is what makes
 * all three agree on one width.
 *
 * So: chain everything that transitively overlaps into a CLUSTER, then pack
 * columns greedily inside it and let the packing discover the width.
 */

export interface Span {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

export interface Positioned<T extends Span> {
  item: T;
  /** 0-based column within the cluster. */
  column: number;
  /** How many columns the cluster is wide. Width is 1/columns. */
  columns: number;
}

/** Do two spans share any time at all? Touching end-to-start does NOT count. */
function overlaps(a: Span, b: Span): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() &&
    b.startsAt.getTime() < a.endsAt.getTime();
}

/**
 * Lay out a day's events.
 *
 * Sorted by start, then by longest-first, then by id. The id tiebreak is not
 * cosmetic: without it two events at the same minute swap columns between
 * renders, which reads as the calendar flickering. Longest-first is what puts
 * the hour-long meeting on the left and the fifteen-minute one beside it, which
 * is the arrangement people expect.
 */
export function layoutDay<T extends Span>(items: readonly T[]): Positioned<T>[] {
  const sorted = [...items].sort((a, b) => {
    const byStart = a.startsAt.getTime() - b.startsAt.getTime();
    if (byStart !== 0) return byStart;
    const byLength =
      b.endsAt.getTime() - b.startsAt.getTime() -
      (a.endsAt.getTime() - a.startsAt.getTime());
    if (byLength !== 0) return byLength;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const out: Positioned<T>[] = [];
  let cluster: T[] = [];
  // The furthest any event in the current cluster reaches. A new event that
  // starts before this belongs to the cluster even if it misses the event
  // immediately before it — that is the transitive case.
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedy packing: reuse the leftmost column whose last event has finished.
    const columnEnds: number[] = [];
    const placed = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startsAt.getTime());
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = item.endsAt.getTime();
      return { item, column };
    });
    for (const entry of placed) {
      out.push({ ...entry, columns: columnEnds.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startsAt.getTime() >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endsAt.getTime());
  }
  flush();

  return out;
}

/**
 * Split a range's items into the all-day row and the timed grid.
 *
 * All-day is not "starts at midnight" — a real overnight shift starting at
 * 00:00 is a timed event. It is the FLAG, which the author set deliberately.
 */
export function partitionAllDay<T extends Span & { allDay: boolean }>(
  items: readonly T[],
): { allDay: T[]; timed: T[] } {
  const allDay: T[] = [];
  const timed: T[] = [];
  for (const item of items) (item.allDay ? allDay : timed).push(item);
  return { allDay, timed };
}

/** Does a span touch a given local day? Used to place items into columns. */
export function spansDay(
  item: Span,
  dayStart: Date,
  dayEnd: Date,
): boolean {
  return overlaps(item, { id: "", startsAt: dayStart, endsAt: dayEnd });
}
