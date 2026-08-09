import { WORK_STATES, type WorkState } from "@/lib/work/vocabulary";

/**
 * A view IS a parameter set. Not a container, not a saved object, not a mode.
 *
 * THE NOTION LESSON, MADE CONCRETE. A table, a board and a calendar there are
 * one dataset read three ways — the view is a filter plus a grouping, and a
 * record belongs to none of them. Trello made the opposite choice, where the
 * list a card sits in IS its status, and the consequence is that "everything
 * assigned to me" cannot be asked at all: the question spans containers.
 *
 * So `display` decides how rows are DRAWN and every other field decides which
 * rows there ARE. Both drawings call the same `listWorkItems`. If a third view
 * ever needs its own query builder, this file was the wrong shape.
 *
 * Documents settled the storage half of this already: a saved view is the same
 * parameter set replayed as a URL, never a second query builder reading jsonb.
 * Slice 3 saves these; nothing about the shape changes when it does.
 *
 * Pure, no directive: the server parses the URL and a client component
 * serialises the next one, and both have to agree.
 */

export type WorkDisplay = "list" | "board";

/**
 * Whose work. `me` and `nobody` are resolved late — `me` needs the caller and
 * `nobody` is a genuine question rather than the absence of a filter, so both
 * survive as words in the URL rather than being baked into an id.
 */
export type AssigneeFilter = "anyone" | "me" | "nobody" | { userId: string };

export interface WorkView {
  display: WorkDisplay;
  /** null = every list the caller can see. */
  listId: string | null;
  assignee: AssigneeFilter;
  /** Empty = no state filter. The board ignores this; it draws every column. */
  states: WorkState[];
  /** Hide anything finished with. The board turns this off — see below. */
  openOnly: boolean;
  /** Free text over title and description. Empty = no text filter. */
  q: string;
}

/**
 * The module's front door: what is on you, still open, drawn as a list.
 *
 * It is also the URL with NO PARAMETERS AT ALL, which is deliberate — the most
 * common view should not need a query string to reach, and `/dashboard/m/work`
 * has to keep meaning "my work" however many views get added later.
 */
export const DEFAULT_VIEW: WorkView = {
  display: "list",
  listId: null,
  assignee: "me",
  states: [],
  openOnly: true,
  q: "",
};

type ParamBag = Record<string, string | string[] | undefined>;

function single(params: ParamBag, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseAssignee(raw: string | undefined): AssigneeFilter {
  if (!raw) return DEFAULT_VIEW.assignee;
  if (raw === "anyone" || raw === "me" || raw === "nobody") return raw;
  return { userId: raw };
}

/**
 * Read a view out of a URL.
 *
 * A malformed parameter falls back to the default rather than 404ing: these
 * arrive from hand-edited URLs and stale bookmarks, and neither deserves an
 * error page. Unknown state names are dropped individually, so one typo in a
 * list of four does not discard the other three.
 */
export function parseWorkView(params: ParamBag): WorkView {
  const display = single(params, "display") === "board" ? "board" : "list";
  const listId = single(params, "list") || null;
  const q = (single(params, "q") ?? "").trim().slice(0, 100);

  const rawStates = params["state"];
  const states = (Array.isArray(rawStates)
    ? rawStates
    : rawStates
      ? rawStates.split(",")
      : []
  ).filter((s): s is WorkState =>
    (WORK_STATES as readonly string[]).includes(s),
  );

  // A board with its finished columns hidden is a board with two empty columns
  // and no way to tell why, so the display overrides the filter rather than
  // the other way round. The cost is recorded in the dossier: those columns are
  // unbounded until the read path learns to paginate.
  const openOnly =
    display === "board" ? false : single(params, "open") !== "0";

  return {
    display,
    listId,
    assignee: parseAssignee(single(params, "who")),
    states,
    openOnly,
    q,
  };
}

/**
 * Write a view back into a query string.
 *
 * Defaults are OMITTED rather than spelled out, so the everyday view is a bare
 * URL and a link somebody pastes carries only what they actually changed.
 */
export function workViewToQuery(view: WorkView): string {
  const params = new URLSearchParams();
  if (view.display !== DEFAULT_VIEW.display) params.set("display", view.display);
  if (view.listId) params.set("list", view.listId);
  if (view.assignee !== "me") {
    params.set(
      "who",
      typeof view.assignee === "string" ? view.assignee : view.assignee.userId,
    );
  }
  if (view.states.length > 0) params.set("state", view.states.join(","));
  // Only meaningful on the list — the board sets it itself.
  if (view.display === "list" && !view.openOnly) params.set("open", "0");
  if (view.q) params.set("q", view.q);
  return params.toString();
}

/** The href for a view, ready for a router push. */
export function workViewHref(view: WorkView, base = "/dashboard/m/work"): string {
  const query = workViewToQuery(view);
  return query ? `${base}?${query}` : base;
}

/**
 * Turn the view's `assignee` into what the read path takes.
 *
 * `undefined` means no filter, `null` means the unassigned pile, and a string
 * means one person — the three-way distinction `listWorkItems` already draws.
 */
export function resolveAssignee(
  assignee: AssigneeFilter,
  currentUserId: string,
): string | null | undefined {
  if (assignee === "anyone") return undefined;
  if (assignee === "me") return currentUserId;
  if (assignee === "nobody") return null;
  return assignee.userId;
}

/** True when anything is narrowed, so the UI can offer "clear". */
export function isFiltered(view: WorkView): boolean {
  return (
    view.listId !== null ||
    view.assignee !== DEFAULT_VIEW.assignee ||
    view.states.length > 0 ||
    view.q.length > 0
  );
}
