import "server-only";
import { and, eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { schema, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL, CLAUDE_THINKING_OFF, getClaude } from "@/lib/claude";
import { getActiveModules } from "@/lib/modules";
import { collectSetup } from "@/lib/setup-sources/resolve";
import {
  PLAN_TOOL,
  SETUP_EXCHANGE_CAP,
  SETUP_MESSAGE_MAX,
  SETUP_OPENER,
  SETUP_PLAN_MAX_TOKENS,
  SETUP_TURN_COOLDOWN_MS,
  SETUP_TURN_MAX_TOKENS,
  SETUP_TURN_TOOL,
  planInstruction,
  setupSystemPrompt,
  validateSetupPlan,
  validateSetupTurn,
  type SetupDigest,
  type SetupPlan,
} from "./prompt";

/**
 * The setup interview: the conversation, the digest it runs on, and the plan
 * it ends with (ADR 0040).
 *
 * THE HOUSE PATTERN, and the public health check is its nearest relative:
 * gather and claim the cooldown in one transaction, call the model OUTSIDE
 * any transaction, then persist. Network work never happens with a
 * transaction open — holding one across model latency is how a pool dies.
 *
 * WHAT IS DIFFERENT FROM THE PUBLIC ONE. That interview talks to a stranger
 * and has to ask everything; this one is looking at the business's own rows,
 * so `buildDigest` hands the model what the app can already see and the
 * prompt forbids asking for any of it. And its output is a PLAN — steps
 * pointing at screens — rather than an assessment written to win somebody.
 */

export type SetupInterviewErrorCode =
  | "NOT_FOUND"
  | "FINISHED"
  | "COOLDOWN"
  | "CAP_REACHED"
  | "TOO_LONG"
  | "EMPTY"
  | "NO_RESULT";

export class SetupInterviewError extends Error {
  constructor(public readonly code: SetupInterviewErrorCode, message = code) {
    super(message);
    this.name = "SetupInterviewError";
  }
}

export function friendlySetupError(err: unknown): string {
  if (err instanceof SetupInterviewError) {
    switch (err.code) {
      case "NOT_FOUND":
        return "That conversation is no longer here. Start a new one.";
      case "FINISHED":
        return "This one is finished. Start a new one to go through it again.";
      case "COOLDOWN":
        return "Give it a moment, then send that again.";
      case "CAP_REACHED":
        return "That is as long as this goes. The plan is below.";
      case "TOO_LONG":
        return "That is a lot in one go — say it in a sentence or two.";
      case "EMPTY":
        return "Say something first.";
      case "NO_RESULT":
        return "It could not answer just then. Try sending that again.";
    }
  }
  console.error("setup interview failed", err);
  return "Something went wrong. Nothing was lost — try again.";
}

export interface SetupCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

export interface SetupMessage {
  role: "user" | "assistant";
  content: string;
}

/* -- What the app can already see ----------------------------------------- */


/**
 * The digest the model runs on. Every figure is a count or a flag — never a
 * balance, a name or an amount (S9): what it needs to know is whether a thing
 * EXISTS, so it does not ask.
 */
export async function buildDigest(
  tx: Tx,
  ctx: SetupCtx,
  tenant: { name: string; industry: string | null },
  moduleSlugs: string[],
): Promise<SetupDigest> {
  const [entity, registers, setup] = await Promise.all([
    tx.query.entities.findFirst({
      where: and(
        eq(schema.entities.tenantId, ctx.tenantId),
        eq(schema.entities.isDefault, true),
      ),
      columns: { booksStartOn: true },
    }),
    tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, ctx.tenantId),
      columns: { kind: true },
    }),
    collectSetup(tx, { tenantId: ctx.tenantId }),
  ]);

  /**
   * COUNTS ONLY, and each table named rather than passed as a value: the
   * digest says whether a thing EXISTS so the interview does not ask for it,
   * and never what it holds or what it is worth (S9).
   */
  const [vendors, customers, items, animals, assets, bankTransactions] =
    await Promise.all([
      tx.$count(schema.vendors, eq(schema.vendors.tenantId, ctx.tenantId)),
      tx.$count(schema.customers, eq(schema.customers.tenantId, ctx.tenantId)),
      tx.$count(schema.inventoryItems, eq(schema.inventoryItems.tenantId, ctx.tenantId)),
      tx.$count(schema.livestockLots, eq(schema.livestockLots.tenantId, ctx.tenantId)),
      tx.$count(schema.assets, eq(schema.assets.tenantId, ctx.tenantId)),
      tx.$count(schema.bankTransactions, eq(schema.bankTransactions.tenantId, ctx.tenantId)),
    ]);

  return {
    businessName: tenant.name,
    industry: tenant.industry,
    modules: moduleSlugs,
    booksStartOn: entity?.booksStartOn ?? null,
    registers: {
      total: registers.length,
      personal: registers.filter((r) => r.kind === "personal").length,
    },
    counts: { vendors, customers, items, animals, assets, bankTransactions },
    outstanding: setup.steps.map((s) => ({ section: s.section, title: s.title })),
  };
}

/* -- Starting, and reading ------------------------------------------------ */

export interface SetupInterviewView {
  id: string;
  state: "active" | "done";
  messages: SetupMessage[];
  exchangeCount: number;
  plan: SetupPlan | null;
}

function toView(row: typeof schema.setupInterviews.$inferSelect): SetupInterviewView {
  return {
    id: row.id,
    state: row.state === "done" ? "done" : "active",
    messages: (row.messages as SetupMessage[]) ?? [],
    exchangeCount: row.exchangeCount,
    plan: (row.plan as SetupPlan | null) ?? null,
  };
}

/** The active one, or the most recent finished one, or null. */
export async function currentInterview(
  tx: Tx,
  tenantId: string,
): Promise<SetupInterviewView | null> {
  const rows = await tx.query.setupInterviews.findMany({
    where: eq(schema.setupInterviews.tenantId, tenantId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 1,
  });
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Start one, or return the active one.
 *
 * The partial unique index makes "one active per tenant" the database's rule,
 * so two people pressing Start at once produce one conversation rather than
 * two halves of one.
 */
export async function startInterview(
  tx: Tx,
  ctx: SetupCtx,
): Promise<SetupInterviewView> {
  const active = await tx.query.setupInterviews.findFirst({
    where: and(
      eq(schema.setupInterviews.tenantId, ctx.tenantId),
      eq(schema.setupInterviews.state, "active"),
    ),
  });
  if (active) return toView(active);

  const [row] = await tx
    .insert(schema.setupInterviews)
    .values({
      tenantId: ctx.tenantId,
      startedByClerkUserId: ctx.userId,
      messages: [{ role: "assistant", content: SETUP_OPENER }],
    })
    .returning();
  return toView(row);
}

/* -- One turn ------------------------------------------------------------- */

interface Gathered {
  id: string;
  history: SetupMessage[];
  exchangeCount: number;
  digest: SetupDigest;
  userMessage: string;
}

/**
 * Gate, claim the cooldown, and build the digest — one transaction, so
 * concurrent turns serialize on the `lastTurnAt` write rather than both
 * calling out.
 */
async function gatherTurn(
  ctx: SetupCtx,
  tenant: { name: string; industry: string | null },
  userMessage: string,
): Promise<Gathered> {
  const said = userMessage.trim();
  if (said === "") throw new SetupInterviewError("EMPTY");
  if (said.length > SETUP_MESSAGE_MAX) throw new SetupInterviewError("TOO_LONG");
  const moduleSlugs = (await getActiveModules(ctx.tenantId)).map((m) => m.module.id);

  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const row = await tx.query.setupInterviews.findFirst({
        where: and(
          eq(schema.setupInterviews.tenantId, ctx.tenantId),
          eq(schema.setupInterviews.state, "active"),
        ),
      });
      if (!row) throw new SetupInterviewError("NOT_FOUND");
      if (
        row.lastTurnAt &&
        Date.now() - row.lastTurnAt.getTime() < SETUP_TURN_COOLDOWN_MS
      ) {
        throw new SetupInterviewError("COOLDOWN");
      }
      if (row.exchangeCount >= SETUP_EXCHANGE_CAP) {
        throw new SetupInterviewError("CAP_REACHED");
      }
      await tx
        .update(schema.setupInterviews)
        .set({ lastTurnAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.setupInterviews.id, row.id));

      return {
        id: row.id,
        history: (row.messages as SetupMessage[]) ?? [],
        exchangeCount: row.exchangeCount,
        digest: await buildDigest(tx, ctx, tenant, moduleSlugs),
        userMessage: said,
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

/** Alternating user/assistant, opener dropped — it is in the system prompt's job, not the transcript's. */
function toModelMessages(history: SetupMessage[], said: string): Anthropic.MessageParam[] {
  const turns = history.filter((m, i) => !(i === 0 && m.role === "assistant"));
  return [...turns, { role: "user" as const, content: said }].map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export type TurnModel = (args: {
  digest: SetupDigest;
  history: SetupMessage[];
  userMessage: string;
}) => Promise<unknown>;

/** The only network function for a turn — injectable, so tests never call out. */
export const callSetupTurnModel: TurnModel = async ({ digest, history, userMessage }) => {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: SETUP_TURN_MAX_TOKENS,
    // Pinned OFF for the budget, like the public interview's turn: this cap
    // covers thinking AND the reply, and a turn that thought its way through
    // it would truncate the forced tool call.
    thinking: CLAUDE_THINKING_OFF,
    system: [
      {
        type: "text",
        text: setupSystemPrompt(digest),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SETUP_TURN_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "setup_turn" },
    messages: toModelMessages(history, userMessage),
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new SetupInterviewError("NO_RESULT");
  return toolUse.input;
};

export type PlanModel = (args: {
  digest: SetupDigest;
  history: SetupMessage[];
}) => Promise<unknown>;

/** The only network function for the plan. Adaptive: this one is a judgement. */
export const callSetupPlanModel: PlanModel = async ({ digest, history }) => {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: SETUP_PLAN_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: setupSystemPrompt(digest),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [PLAN_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "write_setup_plan" },
    messages: [
      ...toModelMessages(history, planInstruction(digest)),
    ],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new SetupInterviewError("NO_RESULT");
  return toolUse.input;
};

/**
 * One exchange. When the model says it has enough — or the cap is reached —
 * the plan is written in the same call, so the person never presses a second
 * button to get the thing they came for.
 */
export async function runTurn(
  ctx: SetupCtx,
  tenant: { name: string; industry: string | null },
  userMessage: string,
  models: { turn?: TurnModel; plan?: PlanModel } = {},
): Promise<SetupInterviewView> {
  const gathered = await gatherTurn(ctx, tenant, userMessage);
  const raw = await (models.turn ?? callSetupTurnModel)({
    digest: gathered.digest,
    history: gathered.history,
    userMessage: gathered.userMessage,
  });
  const turn = validateSetupTurn(raw);
  if (!turn) throw new SetupInterviewError("NO_RESULT");

  const exchangeCount = gathered.exchangeCount + 1;
  const finishing = turn.done || exchangeCount >= SETUP_EXCHANGE_CAP;
  const messages: SetupMessage[] = [
    ...gathered.history,
    { role: "user", content: gathered.userMessage },
    { role: "assistant", content: turn.reply },
  ];

  let plan: SetupPlan | null = null;
  if (finishing) {
    const rawPlan = await (models.plan ?? callSetupPlanModel)({
      digest: gathered.digest,
      history: messages,
    });
    plan = validateSetupPlan(rawPlan);
    if (!plan) throw new SetupInterviewError("NO_RESULT");
  }

  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const [row] = await tx
        .update(schema.setupInterviews)
        .set({
          messages,
          exchangeCount,
          state: finishing ? "done" : "active",
          ...(plan ? { plan } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.setupInterviews.tenantId, ctx.tenantId),
            eq(schema.setupInterviews.id, gathered.id),
          ),
        )
        .returning();
      if (!row) throw new SetupInterviewError("NOT_FOUND");
      return toView(row);
    },
    { role: ctx.role, userId: ctx.userId },
  );
}
