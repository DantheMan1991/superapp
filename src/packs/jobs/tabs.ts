/**
 * WHICH PARTS OF A JOB THIS BUSINESS ACTUALLY DOES.
 *
 * A job has eleven tabs and no construction business uses all eleven. A
 * commercial contractor never picks a tile — *Selections* is a custom-home
 * screen. A framing sub who hands the job over and leaves has no warranty
 * period to track. A remodeler who bids on the back of an envelope has no use
 * for *Estimates*. Every one of them was looking at a strip of tabs where most
 * of it was somebody else's trade.
 *
 * ── WHY THIS IS CONFIG AND NOT A PACK PER TAB ───────────────────────────────
 *
 * The obvious move — split `selections` and `warranty` into packs you can
 * switch off — is wrong, and the reason is the one that makes the tabs tabs in
 * the first place: **they are all facets of one record.** A selection belongs to
 * a project, a change order belongs to a project, a warranty claim belongs to a
 * project. Packaging them separately would be packaging for navigation, and the
 * pack boundary is meant to be a capability boundary.
 *
 * So it is `tenant_modules.config`, which the pack already reads for its
 * delivery methods and its cost-code sets — the profile suggests, the tenant
 * overrides, the pack parses its own key with its own tolerance for nonsense.
 *
 * ── THREE TABS ARE NOT NEGOTIABLE ───────────────────────────────────────────
 *
 * Overview, Contracts and Job cost. The pack's whole claim is that a job has a
 * number, a value and a cost measured against it; a tenant who switched those
 * off would have installed the wrong thing. Everything else is a way of
 * working, and ways of working differ.
 *
 * ── AND TURNING ONE OFF NEVER HIDES WORK THAT EXISTS ────────────────────────
 *
 * This is the rule that makes the feature safe rather than dangerous. A
 * warranty claim is an obligation and a change order is money; a tenant who
 * turns off a tab on Tuesday must not lose sight of what was on it on Monday.
 * `visibleTabs` takes the tabs that HAVE ROWS on the project being looked at and
 * shows them whatever the setting says. The setting decides what a job starts
 * with, not what it is allowed to remember.
 */

/** Every tab, in the order the strip draws them. */
export const JOB_TABS = [
  "overview",
  "contracts",
  "changes",
  "cost",
  "ordered",
  "schedule",
  "selections",
  "log",
  "drawings",
  "estimates",
  "warranty",
] as const;

export type JobTab = (typeof JOB_TABS)[number];

/**
 * The three that make a job a job. Not offered, not stored, never absent —
 * a `tabs` config naming them is ignored rather than obeyed.
 */
export const ALWAYS_ON: readonly JobTab[] = ["overview", "contracts", "cost"];

/** The eight a business may genuinely not do. */
export const OPTIONAL_TABS: readonly JobTab[] = JOB_TABS.filter(
  (tab) => !ALWAYS_ON.includes(tab),
);

/** What each optional tab is called and what turning it off means. */
export const TAB_COPY: Record<JobTab, { label: string; describes: string }> = {
  overview: { label: "Overview", describes: "The job's own page." },
  contracts: { label: "Contracts", describes: "The agreements and what they are worth." },
  cost: { label: "Job cost", describes: "Budget against ordered against spent." },
  changes: {
    label: "Changes",
    describes: "Change orders — extra work priced and agreed after the contract.",
  },
  ordered: {
    label: "Ordered",
    describes: "Purchase orders and subcontracts, and what has been billed against them.",
  },
  schedule: { label: "Schedule", describes: "Phases, their dates and who is on them." },
  selections: {
    label: "Selections",
    describes: "Allowances and the choices a client makes against them. A custom-home screen.",
  },
  log: { label: "Field", describes: "Daily logs, weather, who was on site and photos." },
  drawings: { label: "Drawings", describes: "Drawing sets and the sheets in them." },
  estimates: { label: "Estimates", describes: "Pricing the job, and the proposal the client reads." },
  warranty: {
    label: "Warranty",
    describes: "The period after handover, and the calls that come in during it.",
  },
};

const isJobTab = (v: unknown): v is JobTab =>
  typeof v === "string" && (JOB_TABS as readonly string[]).includes(v);

/**
 * The optional tabs this tenant has switched OFF.
 *
 * **Total by construction**, like `deliveryMethodsFrom`: the config is jsonb
 * with no shape constraint and most tenants have never touched it, so anything
 * unreadable means "nothing is off" — every tab, never a crash and never a
 * screen missing because a value was the wrong type.
 *
 * Stored as what is OFF rather than what is ON, deliberately: a tab added to
 * the pack next year is then ON for everyone who already configured this,
 * rather than silently missing for them because their stored list predates it.
 */
export function tabsOffFrom(config: unknown): JobTab[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).tabsOff;
    if (Array.isArray(value)) {
      return value.filter(isJobTab).filter((tab) => !ALWAYS_ON.includes(tab));
    }
  }
  return [];
}

/**
 * The tabs to draw for one project: what the tenant has on, plus anything this
 * project already has rows for.
 *
 * `withRows` is what stops a setting hiding work. Pass an empty list and you
 * get the tenant's preference alone, which is what a screen that has no project
 * in front of it should use.
 */
export function visibleTabs(config: unknown, withRows: readonly JobTab[] = []): JobTab[] {
  const off = new Set(tabsOffFrom(config));
  for (const tab of withRows) off.delete(tab);
  return JOB_TABS.filter((tab) => !off.has(tab));
}
