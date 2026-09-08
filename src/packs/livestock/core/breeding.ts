/**
 * The breeding calendar. PURE — no imports, no database.
 *
 * **A BULL MEANS WINDOWS, NOT DATES.** With a bull running with the cows there
 * is no service date to write down; what a person knows is the day he went in
 * and the day he came out, and the calving window is that span pushed forward
 * by the gestation: in May 1, out Aug 1, cattle carry 283 days, so calves from
 * about Feb 8 to May 11. Evidence then narrows the window and finally fixes
 * it, and everything here is a FOLD over that evidence — the exposures, the
 * checks and the births — for the same reason the head count is a fold over
 * movements: correct the out date and every due date moves with it, and no
 * stored date can disagree with the rows it came from.
 *
 * **THE EVIDENCE, AND WHAT EACH PIECE DOES TO THE WINDOW:**
 *
 *   1. **An exposure** opens a cycle: due from `from + g` to `(to ?? today) + g`.
 *      While he is still in, the window's far end grows with today.
 *   2. **A check that found her pregnant** confirms the cycle. With the vet's
 *      estimate of days — "she is about 90 days" — it NARROWS the window to
 *      that date give or take `PREG_CHECK_SLACK_DAYS`, kept inside the exposure
 *      window when the two agree and trusted over it when they do not: the arm
 *      is better evidence than a date somebody remembered.
 *   3. **A check that found her open, or that she lost it,** closes the cycle
 *      with no due date. Open is the cull signal the design names.
 *   4. **A birth** fixes it: due became `bornOn`, and conception was
 *      `bornOn − g`, which is also where in the window she calved — LATE means
 *      she bred late and will be later again, which is the other cull signal.
 *      A birth more than `EARLY_BIRTH_SLACK_DAYS` before the window opened
 *      cannot be this cycle's, and is left to whatever earlier exposure nobody
 *      recorded.
 *
 * **A CHECK WITH NO EXPOSURE ON FILE STILL MAKES A CYCLE.** A farm that only
 * writes down what the vet said has a calendar too: "90 days bred on the 1st"
 * is a due date whether or not anybody recorded when the bull went in.
 *
 * **ONE ROW ON THE PEN REACHES EVERY FEMALE IN IT** — but that walk needs the
 * membership table and lives in `ops.ts` (`breedingByLot`). This file is
 * handed each animal's evidence already gathered, and marks where an exposure
 * came from (`via`) so the page can say "the bull was in with Cows".
 *
 * Dates are `YYYY-MM-DD` and arithmetic goes through `Date.UTC`, which is
 * exact. Same helper as the other pure files, by the pack's rule that a pure
 * core file has no imports.
 */

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** What a check found. CLOSED — the fold branches on it. */
export const BREEDING_RESULTS = ["bred", "open", "lost"] as const;
export type BreedingResult = (typeof BREEDING_RESULTS)[number];

export const BREEDING_RESULT_LABELS: Record<BreedingResult, string> = {
  bred: "Pregnant",
  open: "Open",
  lost: "Lost the pregnancy",
};

/**
 * How far either side of the vet's date a narrowed window runs. A palpation
 * at 90 days is honest to about a week; an ultrasound is better, and a person
 * who trusts theirs can read the middle of the window.
 */
export const PREG_CHECK_SLACK_DAYS = 7;

/**
 * How early, before the window opens, a birth can still be this cycle's.
 * Gestation varies by a fortnight around the figure, and a bull that jumped
 * the fence a week before he was "turned in" is not unusual; a calf a month
 * early belongs to an exposure nobody wrote down, and saying otherwise would
 * put a negative six weeks in the cull column.
 */
export const EARLY_BIRTH_SLACK_DAYS = 30;

/** How an exposure reached this animal: recorded on her, or on the pen she lived in. */
export type ExposureVia = "own" | "pen";

export interface ExposureLike {
  id: string;
  /** The record the row was written against — the pen, for a pen exposure. */
  livestockLotId: string;
  sireLotId: string | null;
  exposedFrom: string;
  /** Null while the sire is still in. */
  exposedTo: string | null;
  gestationDays: number;
  via: ExposureVia;
}

export interface CheckLike {
  id: string;
  checkedOn: string;
  result: BreedingResult;
  daysBred: number | null;
}

export interface BirthLike {
  /** The offspring lot. */
  id: string;
  bornOn: string;
  head: number;
}

export interface DueWindow {
  from: string;
  to: string;
}

/**
 * Where a cycle stands, newest evidence winning:
 *   exposed — the sire was in, nothing else known
 *   bred    — a check found her pregnant
 *   open    — a check found her not pregnant; no due date
 *   lost    — she was pregnant and is not now; no due date
 *   born    — she gave birth
 */
export type CycleState = "exposed" | "bred" | "open" | "lost" | "born";

export interface Cycle {
  /** What opened it. Null for a cycle a check opened on its own. */
  exposure: ExposureLike | null;
  /** The check that decided the state, if a check did. */
  check: CheckLike | null;
  birth: BirthLike | null;
  state: CycleState;
  /**
   * When she could calve. Null once closed by `open` or `lost`, and null for
   * a pregnancy confirmed with nothing to date it. A single day once a
   * birth has fixed it.
   */
  due: DueWindow | null;
  /** From the birth (`bornOn − g`) or the vet's estimate (`checkedOn − days`). */
  conceivedOn: string | null;
  /**
   * For a birth under an exposure: days from the window's first day to the
   * calving. Negative means early. The cull signal — late this year is later
   * next year.
   */
  daysIntoWindow: number | null;
  /** The day the cycle opened — for ordering. */
  openedOn: string;
}

/**
 * The window one exposure sets, on a given day.
 *
 * An open-ended exposure — the bull is still in — has no last possible
 * conception date yet, so the far end is today pushed forward: the window is
 * as wide as the facts so far allow, and widens by a day each day he stays.
 */
export function dueWindow(
  exposure: { exposedFrom: string; exposedTo: string | null; gestationDays: number },
  today: string,
): DueWindow {
  const g = Math.max(1, Math.floor(exposure.gestationDays));
  const last = exposure.exposedTo ?? (today > exposure.exposedFrom ? today : exposure.exposedFrom);
  return { from: addDays(exposure.exposedFrom, g), to: addDays(last, g) };
}

/**
 * The window a vet's estimate narrows to, kept inside the exposure's own when
 * the two overlap and trusted over it when they do not.
 */
function narrowedWindow(
  checkedOn: string,
  daysBred: number,
  gestationDays: number,
  within: DueWindow | null,
): DueWindow {
  const point = addDays(checkedOn, gestationDays - daysBred);
  const loose = {
    from: addDays(point, -PREG_CHECK_SLACK_DAYS),
    to: addDays(point, PREG_CHECK_SLACK_DAYS),
  };
  if (!within) return loose;
  const from = loose.from > within.from ? loose.from : within.from;
  const to = loose.to < within.to ? loose.to : within.to;
  return from <= to ? { from, to } : loose;
}

export interface BreedingEvidence {
  exposures: ExposureLike[];
  checks: CheckLike[];
  births: BirthLike[];
  /**
   * The gestation to use for a cycle a check opened on its own, with no
   * exposure to take it from. Null means such a cycle has no due date.
   */
  gestationDays: number | null;
}

/**
 * Fold one animal's evidence into cycles, NEWEST FIRST.
 *
 * Each event attaches to the latest cycle opened on or before its day. A
 * check or a birth that finds that cycle already closed — or finds no cycle
 * at all — opens one of its own when it can (a check that found her pregnant;
 * a birth needs an exposure or a check to belong to and is otherwise the
 * offspring table's business), or is recorded as a closed cycle of its own
 * (a check that found her open, so the history shows it).
 */
export function breedingCycles(evidence: BreedingEvidence, today: string): Cycle[] {
  type Event =
    | { on: string; kind: "exposure"; exposure: ExposureLike }
    | { on: string; kind: "check"; check: CheckLike }
    | { on: string; kind: "birth"; birth: BirthLike };
  const events: Event[] = [
    ...evidence.exposures.map((exposure) => ({
      on: exposure.exposedFrom,
      kind: "exposure" as const,
      exposure,
    })),
    ...evidence.checks.map((check) => ({ on: check.checkedOn, kind: "check" as const, check })),
    ...evidence.births.map((birth) => ({ on: birth.bornOn, kind: "birth" as const, birth })),
  ];
  // Same day: the exposure first (it opens what the others attach to), then
  // the check, then the birth.
  const rank = { exposure: 0, check: 1, birth: 2 };
  events.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : rank[a.kind] - rank[b.kind]));

  const cycles: Cycle[] = [];
  const closed = (c: Cycle) => c.state === "open" || c.state === "lost" || c.state === "born";
  const gestationOf = (c: Cycle | null) =>
    c?.exposure?.gestationDays ?? evidence.gestationDays;

  for (const event of events) {
    const current = cycles.length > 0 ? cycles[cycles.length - 1] : null;
    if (event.kind === "exposure") {
      cycles.push({
        exposure: event.exposure,
        check: null,
        birth: null,
        state: "exposed",
        due: dueWindow(event.exposure, today),
        conceivedOn: null,
        daysIntoWindow: null,
        openedOn: event.exposure.exposedFrom,
      });
      continue;
    }

    if (event.kind === "check") {
      const check = event.check;
      const target = current && !closed(current) ? current : null;
      if (check.result === "bred") {
        const g = gestationOf(target);
        const conceivedOn =
          check.daysBred !== null ? addDays(check.checkedOn, -check.daysBred) : null;
        const due =
          check.daysBred !== null && g !== null
            ? narrowedWindow(check.checkedOn, check.daysBred, g, target?.due ?? null)
            : (target?.due ?? null);
        if (target) {
          target.check = check;
          target.state = "bred";
          target.due = due;
          target.conceivedOn = conceivedOn;
        } else {
          cycles.push({
            exposure: null,
            check,
            birth: null,
            state: "bred",
            due,
            conceivedOn,
            daysIntoWindow: null,
            openedOn: check.checkedOn,
          });
        }
        continue;
      }
      // Open or lost: closes what is running, or stands alone as history.
      if (target) {
        target.check = check;
        target.state = check.result;
        target.due = null;
        target.conceivedOn = null;
      } else {
        cycles.push({
          exposure: null,
          check,
          birth: null,
          state: check.result,
          due: null,
          conceivedOn: null,
          daysIntoWindow: null,
          openedOn: check.checkedOn,
        });
      }
      continue;
    }

    // A birth.
    const birth = event.birth;
    const target = current && !closed(current) ? current : null;
    if (!target) continue;
    const g = gestationOf(target);
    if (
      target.exposure &&
      target.due &&
      daysBetween(birth.bornOn, target.due.from) > EARLY_BIRTH_SLACK_DAYS
    ) {
      // Too early to be this exposure's calf; the cycle stays as it was.
      continue;
    }
    target.birth = birth;
    target.state = "born";
    target.due = { from: birth.bornOn, to: birth.bornOn };
    target.conceivedOn = g !== null ? addDays(birth.bornOn, -g) : null;
    target.daysIntoWindow = target.exposure
      ? daysBetween(dueWindow(target.exposure, today).from, birth.bornOn)
      : null;
  }

  return cycles.reverse();
}

/** The cycle a screen leads with: the newest, or nothing. */
export function currentCycle(cycles: Cycle[]): Cycle | null {
  return cycles[0] ?? null;
}

/** True while a cycle could still end in a birth. */
export function isRunning(cycle: Cycle): boolean {
  return cycle.state === "exposed" || cycle.state === "bred";
}

/**
 * A cycle in one line, for a card, a table cell or a digest.
 *
 *   "Due 2027-02-08 to 2027-05-11 · in 152 days"
 *   "Due about 2027-03-12 · in 12 days"     (narrowed to a week either side)
 *   "Due now · 2027-02-08 to 2027-05-11"
 *   "Due today"
 *   "12 days past the window · was due by 2027-05-11"
 *   "Pregnant · due date not known"
 *   "Found open 2026-10-01"
 *   "Lost the pregnancy 2026-11-05"
 *   "Gave birth 2027-03-01 · 21 days into the window"
 */
export function describeCycle(cycle: Cycle, today: string): string {
  switch (cycle.state) {
    case "open":
      return `Found open ${cycle.check?.checkedOn ?? ""}`.trim();
    case "lost":
      return `Lost the pregnancy ${cycle.check?.checkedOn ?? ""}`.trim();
    case "born": {
      const head = cycle.birth && cycle.birth.head > 1 ? ` · ${cycle.birth.head} born` : "";
      const where =
        cycle.daysIntoWindow === null
          ? ""
          : cycle.daysIntoWindow < 0
            ? ` · ${-cycle.daysIntoWindow} days before the window`
            : cycle.daysIntoWindow === 0
              ? " · on the first day of the window"
              : ` · ${cycle.daysIntoWindow} days into the window`;
      return `Gave birth ${cycle.birth?.bornOn ?? ""}${head}${where}`;
    }
    default:
      return describeDue(cycle.due, today, cycle.state === "bred");
  }
}

function describeDue(due: DueWindow | null, today: string, confirmed: boolean): string {
  if (!due) return confirmed ? "Pregnant · due date not known" : "Due date not known";
  const narrow = daysBetween(due.from, due.to) <= PREG_CHECK_SLACK_DAYS * 2;
  const middle = addDays(due.from, Math.floor(daysBetween(due.from, due.to) / 2));
  const span = due.from === due.to ? due.from : narrow ? `about ${middle}` : `${due.from} to ${due.to}`;
  if (today > due.to) {
    const past = daysBetween(due.to, today);
    return `${past} ${past === 1 ? "day" : "days"} past the window · was due by ${due.to}`;
  }
  if (today >= due.from) {
    return due.from === due.to ? "Due today" : `Due now · ${due.from} to ${due.to}`;
  }
  const inDays = daysBetween(today, due.from);
  return `Due ${span} · in ${inDays} ${inDays === 1 ? "day" : "days"}`;
}

/** Where a running cycle stands against today. */
export type DueStanding = "past" | "now" | "soon" | "later" | "undated";

/** `soon` is within this many days of the window opening. */
export const DUE_SOON_DAYS = 30;

export function dueStanding(cycle: Cycle, today: string): DueStanding {
  if (!cycle.due) return "undated";
  if (today > cycle.due.to) return "past";
  if (today >= cycle.due.from) return "now";
  return daysBetween(today, cycle.due.from) <= DUE_SOON_DAYS ? "soon" : "later";
}

// ── What the calendar owes a person ────────────────────────────────────────

export interface DueLotLike {
  id: string;
  /** The name a person calls her — or the pen, for its loose head. */
  code: string;
  cycle: Cycle;
}

/** Structurally an `AttentionItem` — the source spreads it into one. */
export interface DueItem {
  key: string;
  title: string;
  detail?: string;
  urgency: "overdue" | "today" | "soon";
  dueOn: string | null;
  href: string;
}

const BASE = "/dashboard/m/livestock";

/** How many days before the window opens the line is raised. */
export const DUE_ATTENTION_DAYS = 7;

/**
 * The lines worth a person's attention: a window opening within a week, one
 * opening today, and one that has closed with nothing recorded. **Nothing
 * during the window itself** — a herd's window is three months long, and a
 * line every day of it is the digest somebody mutes; the breeding page
 * carries who is due now. A closed cycle is finished with and is not raised.
 *
 * "Past the window" persists, like a withdrawal nobody looked up, because it
 * is asking for a record: the birth, or the check that found her open.
 */
export function breedingAttention(lots: DueLotLike[], today: string): DueItem[] {
  const out: DueItem[] = [];
  for (const lot of lots) {
    const { cycle } = lot;
    if (!isRunning(cycle) || !cycle.due) continue;
    const href = `${BASE}/${lot.id}`;
    const window =
      cycle.due.from === cycle.due.to
        ? `on ${cycle.due.from}`
        : `${cycle.due.from} to ${cycle.due.to}`;
    if (today > cycle.due.to) {
      const past = daysBetween(cycle.due.to, today);
      out.push({
        key: `livestock_due_past:${lot.id}`,
        title: `${lot.code} is ${past} ${past === 1 ? "day" : "days"} past the due window`,
        detail: `Was due ${window}. Record the birth, or a check that found her open`,
        urgency: "overdue",
        dueOn: cycle.due.to,
        href,
      });
      continue;
    }
    const inDays = daysBetween(today, cycle.due.from);
    if (inDays === 0) {
      out.push({
        key: `livestock_due:${lot.id}`,
        title: `${lot.code} is due from today`,
        detail: `Due window ${window}. Record the birth on her page when it comes`,
        urgency: "today",
        dueOn: cycle.due.from,
        href,
      });
    } else if (inDays > 0 && inDays <= DUE_ATTENTION_DAYS) {
      out.push({
        key: `livestock_due:${lot.id}`,
        title: `${lot.code} is due in ${inDays} ${inDays === 1 ? "day" : "days"}`,
        detail: `Due window ${window}`,
        urgency: "soon",
        dueOn: cycle.due.from,
        href,
      });
    }
  }
  return out;
}
