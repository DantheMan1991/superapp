import {
  FEEDBACK_CLOSED_STATUSES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  type FeedbackKind,
  type FeedbackStatus,
} from "./vocabulary";

/**
 * The arithmetic and the words. NO IMPORTS BEYOND THE VOCABULARY, no
 * `server-only`, no database — the sheet, the client page and the console all
 * render from this, and two of the three are in the browser.
 *
 * Everything a surface would otherwise decide for itself lives here, because
 * the two surfaces render the SAME report to two different audiences and the
 * only way that stays honest is if one file owns both vocabularies.
 */

// ---------------------------------------------------------------------------
// Where it was filed from
// ---------------------------------------------------------------------------

/**
 * The module or pack a screen belongs to, or "" for the shell's own pages.
 *
 * Deliberately ONE rule — `/dashboard/m/<slug>` — rather than a table mapping
 * every route in the product to a feature. The shell's screens (Overview,
 * Hours, Team, settings) are named by `screenLabel` instead, and a route that
 * matches neither is still perfectly reportable: the pathname itself is stored
 * and is what the console actually reads.
 *
 * The slug is NOT checked against the feature registry, on purpose. This value
 * comes from a URL the router already resolved, importing the registry would
 * drag `src/modules/**` into a browser bundle, and a slug that is not a feature
 * is displayed as text and grouped under itself — a wrong label on one report,
 * never a wrong answer to anything.
 */
export function featureFromRoute(pathname: string): string {
  const match = /^\/dashboard\/m\/([a-z0-9-]+)(?:\/|$)/.exec(pathname ?? "");
  return match ? match[1] : "";
}

/**
 * What to call the screen in a list, when it belongs to no module. Mirrors the
 * rail's own groups (`FIXED_SECTIONS` in guides-core), so the console names a
 * screen the way the client's sidebar does.
 */
export function screenLabel(pathname: string): string {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/dashboard";
  const named: Array<[string, string]> = [
    ["/dashboard/today", "What needs you"],
    ["/dashboard/guides", "Guides"],
    ["/dashboard/hours", "Hours"],
    ["/dashboard/team", "Team"],
    ["/dashboard/billing", "Billing"],
    ["/dashboard/email", "Email setup"],
    ["/dashboard/feedback", "Feedback"],
    ["/dashboard/settings", "Settings"],
  ];
  for (const [prefix, label] of named) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return label;
  }
  if (path === "/dashboard") return "Overview";
  return featureFromRoute(path) || path;
}

/**
 * IS THIS SAFE TO RENDER AS A LINK? The route on a report is a string a
 * browser handed us through a form, so the console treats it as untrusted
 * until this agrees it is a same-origin path: one leading slash, no second
 * one (`//evil.com` is protocol-relative and navigates off-site), no scheme,
 * no backslash.
 *
 * A route that fails this is still SHOWN — as text, which is what it is worth
 * — because refusing to display it would hide the one field that says where
 * the bug was.
 */
export function isSameOriginPath(route: string): boolean {
  if (!route.startsWith("/")) return false;
  if (route.startsWith("//") || route.startsWith("/\\")) return false;
  return !/[\\]|^\/?[a-z][a-z0-9+.-]*:/i.test(route);
}

/** The route and its query recombined, for a link or for display. */
export function fullRoute(route: string, query: string): string {
  if (!query) return route;
  return `${route}${query.startsWith("?") ? "" : "?"}${query}`;
}

// ---------------------------------------------------------------------------
// The words — two audiences, one file
// ---------------------------------------------------------------------------

/** What the person filing it picks. Their words, about their own experience. */
export const KIND_CHOICES: ReadonlyArray<{
  value: FeedbackKind;
  label: string;
  hint: string;
}> = [
  {
    value: "bug",
    label: "Something's broken",
    hint: "It did the wrong thing, or nothing at all.",
  },
  {
    value: "idea",
    label: "An idea",
    hint: "Something that would make this easier.",
  },
  {
    value: "question",
    label: "A question",
    hint: "You are not sure how this is meant to work.",
  },
];

/** What the console calls the same three. Short, because they sit in a table. */
const OPERATOR_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug",
  idea: "Idea",
  question: "Question",
};

export function kindLabel(kind: string, side: "client" | "operator"): string {
  if (!isFeedbackKind(kind)) return kind;
  return side === "operator"
    ? OPERATOR_KIND_LABELS[kind]
    : (KIND_CHOICES.find((c) => c.value === kind)?.label ?? kind);
}

/**
 * THE STATUS, SAID TO THE PERSON WAITING. Every one of these is a sentence
 * about THEIR report rather than about our backlog: "Waiting on client" is a
 * true thing to write on a console and a rude thing to show the client, who is
 * not the one who has gone quiet.
 */
const CLIENT_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "Sent",
  needs_info: "Needs your answer",
  planned: "On the list",
  in_progress: "Being worked on",
  done: "Done",
  declined: "Not planned",
};

const OPERATOR_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  needs_info: "Waiting on client",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  declined: "Declined",
};

export function statusLabel(
  status: string,
  side: "client" | "operator",
): string {
  if (!isFeedbackStatus(status)) return status;
  return side === "operator"
    ? OPERATOR_STATUS_LABELS[status]
    : CLIENT_STATUS_LABELS[status];
}

/**
 * The chip's colour, as a token name the design system already registers.
 * Returned as a NAME rather than a class string so a caller composes it — the
 * trap ui-design-system.md wrote up is a fill used where a foreground belongs.
 */
export function statusTone(
  status: string,
): "neutral" | "attention" | "progress" | "positive" | "muted" {
  switch (status) {
    case "new":
      return "neutral";
    case "needs_info":
      return "attention";
    case "planned":
    case "in_progress":
      return "progress";
    case "done":
      return "positive";
    case "declined":
      return "muted";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export function isClosedStatus(status: string): boolean {
  return (FEEDBACK_CLOSED_STATUSES as readonly string[]).includes(status);
}

/**
 * WHOSE MOVE IS IT? Derived from three facts the row already carries, so
 * nothing has to be kept in step: a report nobody has opened, or one where the
 * client has written since the console last looked, is the operator's.
 *
 * A CLOSED REPORT IS NOBODY'S — until the client writes again, which reopens
 * the question without reopening the status. Somebody saying "thanks, that
 * fixed it" on a `done` report must not put it back in the queue; somebody
 * saying "it is still happening" must. The difference is not knowable from
 * here, so the console shows it as waiting and a human decides, which is the
 * honest version.
 */
export function needsOperator(report: {
  status: string;
  operatorReadAt: Date | null;
  lastClientMessageAt: Date | null;
}): boolean {
  if (report.status === "new") return true;
  const said = report.lastClientMessageAt;
  if (!said) return false;
  return !report.operatorReadAt || said > report.operatorReadAt;
}

/**
 * Does the CLIENT have something unread? The mirror of the above, and what the
 * dot on the button counts. Internal notes are excluded before this is called
 * — by SQL, not here (see `feedback_messages.internal`).
 */
export function hasUnreadReply(report: {
  clientReadAt: Date | null;
  lastOperatorMessageAt: Date | null;
}): boolean {
  const said = report.lastOperatorMessageAt;
  if (!said) return false;
  return !report.clientReadAt || said > report.clientReadAt;
}

/**
 * The console's queue order: what is waiting on us, oldest first — because a
 * report that has been waiting three days is more urgent than one that arrived
 * this morning, and a newest-first inbox buries it. Everything not waiting on
 * us follows, newest first.
 */
export function queueRank(report: {
  status: string;
  operatorReadAt: Date | null;
  lastClientMessageAt: Date | null;
}): 0 | 1 {
  return needsOperator(report) ? 0 : 1;
}

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

/**
 * "12 Sep, 3:14 pm", in the BUSINESS's clock rather than the reader's.
 *
 * `tenants.timezone` is the single answer to "what day is it here"
 * (docs/modules/timezone.md), and a thread is read by two people in two
 * places — the person who filed it and whoever answers it from the console.
 * Stamping both with the business's own clock is the only way a sentence like
 * "you replied before I did" stays true on both screens.
 *
 * `Intl` rather than a formatting library: it is in every runtime this renders
 * in, and this file must stay importable from the browser.
 */
export function formatWhen(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(at);
  } catch {
    // An unknown zone name is a data problem somewhere else, and a thread that
    // will not render is a worse symptom than a timestamp in UTC.
    return at.toISOString().slice(0, 16).replace("T", " ");
  }
}
