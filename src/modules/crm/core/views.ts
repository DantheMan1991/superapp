/**
 * Saved views: which records a list shows, and in what order.
 *
 * PURE — no database, no `server-only`. Everything that decides what a filter
 * MEANS lives here; `view-ops.ts` does nothing but turn the result into
 * drizzle predicates. That split is the same one `core/timeline.ts` and
 * `core/merge.ts` have, and it matters more here than in either: a filter is
 * user input that becomes part of a WHERE clause, so the rules about which
 * columns exist and which operators may touch them are exactly the rules that
 * must be testable without a session.
 *
 * THE FIELD REGISTRY IS A WHITELIST, AND THAT IS ITS FIRST JOB. A stored view
 * is jsonb somebody's browser once sent; `parseFilter` refuses any field not
 * named below, so a column name can never arrive from outside this file. The
 * second job is smaller and still worth having: the registry knows each field's
 * TYPE, which is what stops "created_at starts with" being a question anybody
 * can ask.
 *
 * VALUES ARE NEVER INTERPOLATED. Nothing here builds SQL text. The compiler in
 * `view-ops.ts` receives a validated `(field, operator, value)` triple and
 * binds the value as a parameter, which is the only reason a `contains` filter
 * cannot be a way to read another tenant's rows.
 */

/* -- Fields --------------------------------------------------------------- */

export type FilterFieldType = "text" | "enum" | "boolean" | "date";

export interface FilterField {
  key: string;
  label: string;
  type: FilterFieldType;
  /**
   * Which table the column lives on. The records list is a LEFT JOIN of
   * `parties` and `crm_party_details`, and the difference is load-bearing —
   * see `DETAILS FILTERS EXCLUDE UNWORKED RECORDS` below.
   */
  table: "party" | "details";
  /** Closed vocabularies get a picker rather than a text box. */
  options?: { value: string; label: string }[];
}

/**
 * What a view may filter on. FIRST-CLASS COLUMNS ONLY, and custom fields are
 * deliberately absent: they live in a jsonb bag keyed by definition id, and the
 * dossier already records that arbitrary jsonb filtering gets expensive fast.
 * The right shape there is an intentional expression index per field somebody
 * actually filters on, decided with a real tenant's real filter, not guessed at
 * now.
 */
export const FILTER_FIELDS: readonly FilterField[] = [
  { key: "name", label: "Name", type: "text", table: "party" },
  {
    key: "kind",
    label: "Type",
    type: "enum",
    table: "party",
    options: [
      { value: "person", label: "Person" },
      { value: "organization", label: "Company" },
    ],
  },
  {
    key: "active",
    label: "Active",
    type: "boolean",
    table: "party",
  },
  { key: "created", label: "Added", type: "date", table: "party" },
  { key: "stage", label: "Stage", type: "text", table: "details" },
  { key: "lead_source", label: "Source", type: "text", table: "details" },
  { key: "assigned", label: "Assigned to", type: "text", table: "details" },
  {
    key: "visibility",
    label: "Visibility",
    type: "enum",
    table: "details",
    options: [
      { value: "members", label: "Everyone" },
      { value: "restricted", label: "Restricted" },
    ],
  },
] as const;

/**
 * A field by key, within a registry.
 *
 * THE SECOND ARGUMENT IS WHAT LETS REPORTS REUSE ALL OF THIS. The records list
 * has one registry — the default — while each report type declares its own,
 * because "deal stage" is a sensible thing to filter a pipeline report on and a
 * meaningless thing to filter the records list on. Every existing caller passes
 * one argument and keeps the behaviour it had.
 *
 * The whitelist property is unchanged and is the reason the parameter is a
 * FIELD SET rather than a flag: a caller can only widen the vocabulary to
 * another list this codebase wrote, never to an arbitrary column name.
 */
export function filterField(
  key: string,
  fields: readonly FilterField[] = FILTER_FIELDS,
): FilterField | null {
  return fields.find((f) => f.key === key) ?? null;
}

/* -- Operators ------------------------------------------------------------ */

/**
 * The whole vocabulary. NINE, CLOSED, and closed for the same reason
 * `crm_field_type` is: each one needs a compiler branch, a label, and a
 * decision about which types it applies to, so adding one is a change in three
 * places and should look like one.
 */
export const FILTER_OPERATORS = [
  "equals",
  "not_equals",
  "less_than",
  "greater_than",
  "less_or_equal",
  "greater_or_equal",
  "contains",
  "not_contains",
  "starts_with",
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const OPERATORS_BY_TYPE: Record<FilterFieldType, readonly FilterOperator[]> = {
  text: ["equals", "not_equals", "contains", "not_contains", "starts_with"],
  // A closed vocabulary is picked from a list, so "contains" would be a way of
  // asking a question the picker cannot express.
  enum: ["equals", "not_equals"],
  boolean: ["equals"],
  // No `equals` on a date: it is a timestamp, and asking for one that matches an
  // instant exactly is a filter that always returns nothing. Ranges only.
  date: ["less_than", "greater_than", "less_or_equal", "greater_or_equal"],
};

export function operatorsFor(type: FilterFieldType): readonly FilterOperator[] {
  return OPERATORS_BY_TYPE[type];
}

export function operatorLabel(operator: FilterOperator): string {
  switch (operator) {
    case "equals":
      return "is";
    case "not_equals":
      return "is not";
    case "less_than":
      return "before";
    case "greater_than":
      return "after";
    case "less_or_equal":
      return "on or before";
    case "greater_or_equal":
      return "on or after";
    case "contains":
      return "contains";
    case "not_contains":
      return "does not contain";
    case "starts_with":
      return "starts with";
  }
}

/* -- Relative dates ------------------------------------------------------- */

/**
 * Date values that stay true as time passes.
 *
 * A VIEW CALLED "ADDED THIS WEEK" MUST NOT MEAN A FIXED WEEK. Storing an
 * absolute date would make every seeded view stale the day after it was
 * created, which is the failure that makes saved views feel broken rather than
 * merely limited. So a date value is either an ISO date or one of these tokens,
 * resolved against `now` at query time.
 *
 * INSTANTS, NOT CALENDAR DAYS, and that is a deliberate departure from the
 * follow-ups page. `crm_tasks.due_on` is a DATE and "is this overdue" is a
 * question about the user's timezone, which is why that page compares yyyy-mm-dd
 * strings. `created_at` is a timestamptz — an instant — and "added in the last
 * 7 days" means 7×24 hours. No timezone enters into it, so none is invented.
 */
export const RELATIVE_DATES = [
  "today",
  "last_7_days",
  "last_30_days",
  "last_90_days",
] as const;

export type RelativeDate = (typeof RELATIVE_DATES)[number];

const RELATIVE_DAYS: Record<RelativeDate, number> = {
  today: 1,
  last_7_days: 7,
  last_30_days: 30,
  last_90_days: 90,
};

export function relativeDateLabel(token: RelativeDate): string {
  switch (token) {
    case "today":
      return "the last day";
    case "last_7_days":
      return "the last 7 days";
    case "last_30_days":
      return "the last 30 days";
    case "last_90_days":
      return "the last 90 days";
  }
}

/**
 * A date value as an instant, or null if it is not usable.
 *
 * `now` is passed in rather than read, so the resolution is testable and so a
 * query and the sentence describing it cannot disagree about when "now" was.
 */
export function resolveDateValue(value: string, now: Date): Date | null {
  if ((RELATIVE_DATES as readonly string[]).includes(value)) {
    const days = RELATIVE_DAYS[value as RelativeDate];
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }
  // An ISO date, taken as midnight UTC. Anything else is refused rather than
  // handed to `new Date()`, which parses far too much and fails silently by
  // returning Invalid Date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* -- Conditions ----------------------------------------------------------- */

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string;
}

export const MAX_CONDITIONS = 10;
export const VALUE_MAX = 200;

/**
 * Validate one condition against the registry.
 *
 * Returns a reason rather than throwing, because `parseFilter` drops bad
 * conditions from a STORED view and the caller decides whether a bad one from a
 * FORM is worth an error message.
 */
export function conditionProblem(
  condition: FilterCondition,
  fields: readonly FilterField[] = FILTER_FIELDS,
): string | null {
  const field = filterField(condition.field, fields);
  if (!field) return "Unknown field";
  if (!operatorsFor(field.type).includes(condition.operator)) {
    return `${operatorLabel(condition.operator)} does not apply to ${field.label}`;
  }
  if (condition.value.length > VALUE_MAX) return "Value is too long";

  switch (field.type) {
    case "enum":
      return field.options?.some((o) => o.value === condition.value)
        ? null
        : "Not one of the choices";
    case "boolean":
      return condition.value === "true" || condition.value === "false"
        ? null
        : "Must be true or false";
    case "date":
      return resolveDateValue(condition.value, new Date(0)) === null
        ? "Not a date"
        : null;
    case "text":
      // An empty text value is refused rather than treated as "is blank": the
      // two read the same in a form and mean very different things, and a
      // filter that quietly became "everything" is the kind nobody notices.
      return condition.value.trim().length === 0 ? "Enter a value" : null;
  }
}

/**
 * A stored jsonb bag turned into conditions, dropping anything unusable.
 *
 * DROPPING RATHER THAN THROWING is the same choice `sanitizeCustomValues`
 * makes, and for the same reason: a view saved when a field existed must not
 * become a page that cannot load once the field is gone. A dropped condition
 * WIDENS the result — it never narrows it — which is worth saying out loud,
 * because the safe direction for a *visibility* rule would be the opposite. It
 * is safe here only because RLS, not this filter, is what decides which rows
 * the caller may see. A filter is a convenience over rows already permitted.
 */
export function parseFilter(stored: unknown): FilterCondition[] {
  if (!Array.isArray(stored)) return [];
  const out: FilterCondition[] = [];
  for (const raw of stored) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Record<string, unknown>;
    if (
      typeof candidate.field !== "string" ||
      typeof candidate.operator !== "string" ||
      typeof candidate.value !== "string"
    ) {
      continue;
    }
    const condition: FilterCondition = {
      field: candidate.field,
      operator: candidate.operator as FilterOperator,
      value: candidate.value,
    };
    if (conditionProblem(condition) === null) out.push(condition);
    if (out.length >= MAX_CONDITIONS) break;
  }
  return out;
}

/**
 * The filter as a sentence, for the line under the list heading.
 *
 * Borrowed shamelessly in spirit from every list UI that states its own state
 * in words. A person who can read why they are seeing these rows does not have
 * to open the filter panel to find out.
 */
export function describeFilter(
  conditions: readonly FilterCondition[],
  fields: readonly FilterField[] = FILTER_FIELDS,
): string {
  if (conditions.length === 0) return "All records";
  return conditions.map((c) => describeCondition(c, fields)).join(" · ");
}

function describeCondition(
  condition: FilterCondition,
  fields: readonly FilterField[],
): string {
  const field = filterField(condition.field, fields);
  if (!field) return "";

  if (field.type === "date") {
    const relative = (RELATIVE_DATES as readonly string[]).includes(
      condition.value,
    );
    const value = relative
      ? relativeDateLabel(condition.value as RelativeDate)
      : condition.value;
    // "Added after the last 7 days" is nonsense; "Added in the last 7 days" is
    // what somebody means when they pick it.
    if (relative && condition.operator === "greater_or_equal") {
      return `${field.label} in ${value}`;
    }
    if (relative && condition.operator === "less_than") {
      return `${field.label} before ${value}`;
    }
    return `${field.label} ${operatorLabel(condition.operator)} ${value}`;
  }

  const value =
    field.options?.find((o) => o.value === condition.value)?.label ??
    condition.value;
  return `${field.label} ${operatorLabel(condition.operator)} ${value}`;
}

/* -- The URL -------------------------------------------------------------- */

/**
 * Conditions as query-string values, and back.
 *
 * THE FILTER LIVES IN THE URL BECAUSE THE LIST IS SERVER-RENDERED, and that
 * turns out to be the better answer anyway: a filtered list is a link somebody
 * can send a colleague, reload, or bookmark. Client-only filter state would
 * lose all three and would still need a round trip for the rows.
 *
 * `field:operator:value` with the VALUE encoded and the other two not, because
 * both come from closed sets that cannot contain a colon. Splitting on the
 * first two colons is therefore unambiguous no matter what somebody typed in
 * the value — including a colon.
 */
export function encodeCondition(condition: FilterCondition): string {
  return `${condition.field}:${condition.operator}:${encodeURIComponent(condition.value)}`;
}

export function decodeConditions(raw: readonly string[]): FilterCondition[] {
  const out: FilterCondition[] = [];
  for (const entry of raw) {
    const first = entry.indexOf(":");
    const second = entry.indexOf(":", first + 1);
    if (first < 1 || second < 0) continue;
    let value: string;
    try {
      value = decodeURIComponent(entry.slice(second + 1));
    } catch {
      // A malformed escape is somebody's hand-edited URL, not an error worth
      // showing. The condition is dropped, which widens — the same rule
      // `parseFilter` follows and safe for the same reason.
      continue;
    }
    const condition: FilterCondition = {
      field: entry.slice(0, first),
      operator: entry.slice(first + 1, second) as FilterOperator,
      value,
    };
    if (conditionProblem(condition) === null) out.push(condition);
    if (out.length >= MAX_CONDITIONS) break;
  }
  return out;
}

/** Whether what is on screen still matches the view it came from. */
export function sameConditions(
  a: readonly FilterCondition[],
  b: readonly FilterCondition[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (condition, i) =>
      condition.field === b[i].field &&
      condition.operator === b[i].operator &&
      condition.value === b[i].value,
  );
}

/* -- Sorting -------------------------------------------------------------- */

export const SORT_FIELDS = ["name", "created", "stage"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export interface ViewSort {
  field: SortField;
  direction: "asc" | "desc";
}

export const DEFAULT_SORT: ViewSort = { field: "name", direction: "asc" };

export function parseSort(stored: unknown): ViewSort {
  if (typeof stored !== "object" || stored === null) return DEFAULT_SORT;
  const candidate = stored as Record<string, unknown>;
  const field = (SORT_FIELDS as readonly string[]).includes(
    candidate.field as string,
  )
    ? (candidate.field as SortField)
    : DEFAULT_SORT.field;
  const direction = candidate.direction === "desc" ? "desc" : "asc";
  return { field, direction };
}

/* -- Built-in views ------------------------------------------------------- */

/**
 * The views every tenant has without saving anything.
 *
 * BUILT IN AS CODE RATHER THAN SEEDED AS ROWS, and the choice is worth the
 * paragraph. Seeding rows per tenant means a migration every time a default is
 * added or its wording improved, a backfill for tenants that already exist, and
 * an awkward question the first time somebody edits one — is it still the
 * default, and what happens on the next seed? As code they are the same for
 * everybody, improve for everybody at once, and cannot be half-renamed.
 *
 * The cost is that a tenant cannot delete one. That is acceptable for four
 * views that are each one obvious question, and a saved view can always be
 * pinned over the top of them.
 *
 * WHY THESE FOUR. An empty saved-views feature is one nobody adopts — the
 * Salesforce org this was modelled on ships six on contacts, and the point of
 * them is to demonstrate what a view IS before anybody builds one.
 */
export interface BuiltInView {
  id: string;
  name: string;
  filter: FilterCondition[];
  sort: ViewSort;
  /** Replaced with the caller's own id when the view is run. */
  usesCurrentUser?: boolean;
}

export const BUILT_IN_VIEWS: readonly BuiltInView[] = [
  { id: "builtin:all", name: "All records", filter: [], sort: DEFAULT_SORT },
  {
    id: "builtin:mine",
    name: "Assigned to me",
    // `assigned` is an ATTRIBUTION and grants nothing — this view is a
    // convenience, not a permission, and a restricted record assigned to a
    // staff member still will not appear for them. See the dossier.
    filter: [{ field: "assigned", operator: "equals", value: "" }],
    sort: DEFAULT_SORT,
    usesCurrentUser: true,
  },
  {
    id: "builtin:recent",
    name: "Added recently",
    filter: [
      { field: "created", operator: "greater_or_equal", value: "last_30_days" },
    ],
    sort: { field: "created", direction: "desc" },
  },
  {
    id: "builtin:companies",
    name: "Companies",
    filter: [{ field: "kind", operator: "equals", value: "organization" }],
    sort: DEFAULT_SORT,
  },
];

export function builtInView(id: string): BuiltInView | null {
  return BUILT_IN_VIEWS.find((v) => v.id === id) ?? null;
}

/**
 * A built-in's filter with `usesCurrentUser` resolved.
 *
 * Kept separate from the definition so the constant stays a plain value — a
 * built-in that carried a function would be a built-in nobody could serialise
 * or compare.
 */
export function resolveBuiltIn(
  view: BuiltInView,
  clerkUserId: string,
): FilterCondition[] {
  if (!view.usesCurrentUser) return view.filter;
  return view.filter.map((condition) =>
    condition.field === "assigned" && condition.value === ""
      ? { ...condition, value: clerkUserId }
      : condition,
  );
}
