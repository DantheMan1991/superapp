import { z } from "zod";

/**
 * The setup interview's words, limits and shapes. PURE — no database, no
 * network, no `server-only`, because the page reads the caps and the plan
 * type. The same split `interview-prompt.ts` / `interview.ts` keeps for the
 * public health check, and for the same reason.
 */

/** Hard server cap on user turns. Shorter than the public one on purpose. */
export const SETUP_EXCHANGE_CAP = 10;
/** The model is told to have enough by here. */
export const SETUP_WRAP_TARGET = 8;
export const SETUP_MESSAGE_MAX = 1_000;
export const SETUP_REPLY_MAX = 2_000;
export const SETUP_TURN_MAX_TOKENS = 1_500;
export const SETUP_PLAN_MAX_TOKENS = 4_000;
export const SETUP_TURN_COOLDOWN_MS = 3_000;

/**
 * WHAT THE APP CAN ALREADY SEE, handed to the model so it never asks.
 *
 * This is the whole difference between this interview and a generic setup
 * wizard, and between it and its public cousin: the health check is talking
 * to a stranger and has to ask everything, while this one is looking at the
 * business's own rows. Asking "do you have a bank account in here?" of
 * somebody who has three is how a conversation loses the person in the first
 * minute.
 */
export interface SetupDigest {
  businessName: string;
  industry: string | null;
  /** Module slugs switched on. */
  modules: string[];
  /** The default company's first day, or null when nobody has said. */
  booksStartOn: string | null;
  registers: { total: number; personal: number };
  counts: {
    vendors: number;
    customers: number;
    items: number;
    animals: number;
    assets: number;
    bankTransactions: number;
  };
  /** What the Getting set up card is asking for, in its own order. */
  outstanding: Array<{ section: string; title: string }>;
}

export function digestLines(d: SetupDigest): string {
  const on = d.modules.length > 0 ? d.modules.join(", ") : "none yet";
  const start = d.booksStartOn
    ? `set to ${d.booksStartOn}`
    : "NOT SET — nobody has said when their books begin";
  const outstanding =
    d.outstanding.length === 0
      ? "nothing — every tool has what it needs"
      : d.outstanding.map((s) => `${s.section}: ${s.title}`).join("; ");
  return [
    `Business: ${d.businessName}${d.industry ? ` (${d.industry})` : ""}`,
    `Tools switched on: ${on}`,
    `Day their books begin: ${start}`,
    `Bank registers: ${d.registers.total} (${d.registers.personal} of them personal/mixed), ${d.counts.bankTransactions} transactions imported`,
    `Already entered — vendors ${d.counts.vendors}, customers ${d.counts.customers}, kinds of stock ${d.counts.items}, animal groups ${d.counts.animals}, assets ${d.counts.assets}`,
    `The app is currently asking them for: ${outstanding}`,
  ].join("\n");
}

export const SETUP_OPENER = `Let's get you set up properly. I'll ask a handful of questions about how the business actually runs, then write you a plan: what to do, in what order, with a link to each screen.

First one, and it's the one that changes the most: **is the business's money in its own bank account, or is it mixed with your personal spending?**`;

export function setupSystemPrompt(digest: SetupDigest): string {
  return `You are helping somebody set up their business in Yosher — "The Outsourced Business Office". They have already signed up; nobody is selling them anything. Your job is a short, practical interview that ends in a written plan for THIS business.

WHAT YOU CAN ALREADY SEE. Never ask for any of this — you have it:

${digestLines(digest)}

HOW TO TALK. One question at a time, plain and short, the way a bookkeeper who has done this a hundred times would ask it. No jargon, no lists of features, no enthusiasm. Acknowledge the answer in a clause, then ask the next thing. Never ask two questions in one turn. Have what you need within ${SETUP_WRAP_TARGET} exchanges.

WHAT YOU ARE TRYING TO FIND OUT, roughly in this order, skipping anything the digest already answers or their answers make irrelevant:

1. Is the business's money in its own account, or mixed with personal? This changes everything downstream, so it is first.
2. When should the books begin? Push gently towards the start of the current tax year rather than today — the year's return needs the whole year, and a statement imported from that date does most of the work. Get to an actual date.
3. Who keeps the books today, and on what — a shoebox, a spreadsheet, an accountant, another app? Does anyone owe them money, or do they owe anybody, as of that date?
4. What do they hold and what does it cost? Ask whether they have ever tracked what things cost them. If they have not, say plainly that it stays blank rather than guessed, and that cost starts arriving by itself from the day they begin.
5. What do they own that matters — equipment, buildings, ground — and does an accountant hold a depreciation schedule for it?
6. What does a normal day look like, and who does it? This decides whether the daily habit is worth setting up now or later.

RULES.

Do not invent facts about their business. If they are vague, ask one clarifying question, then move on and let the plan say what is still unknown.

Do not promise anything about the software you were not told. You know only what is in the digest.

If they say something that means an earlier answer was wrong, take the newer one.

When you have enough — or by exchange ${SETUP_WRAP_TARGET} — set done to true. Your reply on that turn should be one or two sentences saying you have enough and the plan is below. Do not write the plan in the reply; a separate step does that.`;
}

export const SETUP_TURN_TOOL = {
  name: "setup_turn",
  description: "Your reply to the person, and whether the interview is finished.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: {
        type: "string",
        description:
          "What to say next. One short paragraph at most, ending in a single question unless you are finished.",
      },
      done: {
        type: "boolean",
        description:
          "True when you have enough to write the plan, or the wrap target is reached.",
      },
    },
    required: ["reply", "done"],
  },
};

export const PLAN_TOOL = {
  name: "write_setup_plan",
  description:
    "The plan for setting this business up: what to do, in the order to do it.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "Two or three sentences describing this business as they described it, and what the plan does about it. Address them as 'you'.",
      },
      steps: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The act, as an instruction. 'Set the day your books begin to 2026-01-01'.",
            },
            why: {
              type: "string",
              description:
                "One sentence on why it matters FOR THIS BUSINESS, in their own terms. Not a description of the feature.",
            },
            screen: {
              type: "string",
              description:
                "Which screen it is done on, copied exactly from the list of screens you were given. Leave out when it is something they do away from the app, such as asking their accountant for a figure.",
            },
          },
          required: ["title", "why"],
        },
      },
    },
    required: ["summary", "steps"],
  },
};

/**
 * The screens a plan step may point at, by name. The model copies one of
 * these labels and the app resolves the href, so a plan can never link
 * somewhere that does not exist — the same rule the setup card's static
 * guide slugs follow, and for the same reason (ADR 0033's build log).
 */
export const PLAN_SCREENS: ReadonlyArray<{
  label: string;
  href: string;
  guide: string | null;
}> = [
  { label: "Opening position", href: "/dashboard/m/accounting/opening", guide: "accounting/opening" },
  { label: "Banking", href: "/dashboard/m/accounting/banking", guide: "accounting/banking" },
  { label: "Vendors", href: "/dashboard/m/accounting/purchases/vendors", guide: "accounting/vendors" },
  { label: "Customers", href: "/dashboard/m/accounting/sales/customers", guide: "accounting/customers" },
  { label: "Chart of accounts", href: "/dashboard/m/accounting/accounts", guide: "accounting/chart-of-accounts" },
  { label: "Close", href: "/dashboard/m/accounting/close", guide: "accounting/close" },
  { label: "Inventory", href: "/dashboard/m/inventory", guide: "inventory/items" },
  { label: "Livestock", href: "/dashboard/m/livestock", guide: "livestock/lots" },
  { label: "Daily round", href: "/dashboard/m/livestock/log", guide: "livestock/daily-round" },
  { label: "Assets", href: "/dashboard/m/assets", guide: "assets/assets" },
  { label: "Land", href: "/dashboard/m/land", guide: "land/parcels" },
  { label: "Retail", href: "/dashboard/m/retail", guide: "retail/channels" },
  { label: "Business settings", href: "/dashboard/settings/business", guide: null },
];

export function planInstruction(digest: SetupDigest): string {
  const screens = PLAN_SCREENS.map((s) => `- ${s.label}`).join("\n");
  return `The interview is over. Write the plan for setting this business up.

Order the steps the way somebody would actually do them: the day their books begin first when it is not set, then the money, then what they hold and own, then the people, then the daily habit. Leave out anything already done — the digest says what is there.

Each step names one act, says why it matters for THIS business in their own words, and picks the screen it is done on from exactly this list, by label:

${screens}

Between six and ten steps. Fewer is better than padding. A step somebody does away from the app — asking their accountant for a depreciation figure, finding last year's statements — is a real step and carries no screen.`;
}

/* -- What comes back ------------------------------------------------------ */

const turnSchema = z.object({
  reply: z.string().min(1).max(SETUP_REPLY_MAX),
  done: z.boolean(),
});

export type SetupTurn = z.infer<typeof turnSchema>;

export function validateSetupTurn(raw: unknown): SetupTurn | null {
  const parsed = turnSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const planSchema = z.object({
  summary: z.string().min(1).max(2_000),
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        why: z.string().min(1).max(500),
        screen: z.string().max(120).optional(),
      }),
    )
    .max(12),
});

export interface SetupPlanStep {
  title: string;
  why: string;
  /** Resolved from the model's label; null when it named none or an unknown one. */
  href: string | null;
  guide: string | null;
  screen: string | null;
}

export interface SetupPlan {
  summary: string;
  steps: SetupPlanStep[];
}

/**
 * Zod at the boundary, then the screen labels resolved against the list the
 * model was given. A label that is not on it becomes a step with no link
 * rather than a link to nowhere.
 */
export function validateSetupPlan(raw: unknown): SetupPlan | null {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    summary: parsed.data.summary,
    steps: parsed.data.steps.map((s) => {
      const found = s.screen
        ? PLAN_SCREENS.find(
            (p) => p.label.toLowerCase() === s.screen!.trim().toLowerCase(),
          )
        : undefined;
      return {
        title: s.title,
        why: s.why,
        href: found?.href ?? null,
        guide: found?.guide ?? null,
        screen: found?.label ?? null,
      };
    }),
  };
}
