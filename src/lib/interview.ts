import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import type { AuditMessage, InterviewSession } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import { uniqueTenantSlug } from "@/lib/slug";
import {
  ASSESSMENT_INSTRUCTION,
  ASSESSMENT_MAX_TOKENS,
  INTERVIEW_DAILY_GLOBAL_CAP,
  INTERVIEW_DAILY_IP_CAP,
  INTERVIEW_EXCHANGE_CAP,
  INTERVIEW_OPENER,
  INTERVIEW_SYSTEM_PROMPT,
  INTERVIEW_TOOL,
  INTERVIEW_TURN_COOLDOWN_MS,
  INTERVIEW_TURN_MAX_TOKENS,
  buildInterviewMessages,
} from "@/lib/interview-prompt";
import {
  validateInterviewTurn,
  type InterviewTurn,
} from "@/lib/interview-validate";

/**
 * Public health-check interview engine. All DB access via withSystem —
 * sessions are superadmin-RLS and belong to no tenant; the visitor's only
 * credential is the unguessable session uuid. Network calls never run
 * inside a transaction.
 */

class InterviewError extends Error {
  constructor(
    public code: "SESSION_GONE" | "COOLDOWN" | "CAP_REACHED",
  ) {
    super(code);
  }
}

/** sha256(salt + ip) — raw IPs are never stored. Throws without the salt. */
export function hashInterviewIp(ip: string): string {
  const salt = process.env.INTERVIEW_IP_SALT;
  if (!salt) throw new Error("INTERVIEW_IP_SALT is not set");
  return createHash("sha256").update(`${salt}${ip}`).digest("hex");
}

function startOfUtcDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export type StartResult =
  | { ok: true; sessionId: string; messages: AuditMessage[] }
  | { ok: false; code: "ip_capped" | "at_capacity" };

/**
 * Gate order: global daily ceiling → per-IP daily cap → insert, all in one
 * tx. Soft ceilings — count-then-insert races at the boundary accepted.
 */
export async function startInterviewSession(
  ipHash: string,
  now: Date = new Date(),
): Promise<StartResult> {
  const dayStart = startOfUtcDay(now);
  return withSystem(async (tx) => {
    const [{ globalCount }] = await tx
      .select({ globalCount: sql<number>`count(*)::int` })
      .from(schema.interviewSessions)
      .where(gte(schema.interviewSessions.createdAt, dayStart));
    if (globalCount >= INTERVIEW_DAILY_GLOBAL_CAP) {
      return { ok: false as const, code: "at_capacity" as const };
    }

    const [{ ipCount }] = await tx
      .select({ ipCount: sql<number>`count(*)::int` })
      .from(schema.interviewSessions)
      .where(
        and(
          eq(schema.interviewSessions.ipHash, ipHash),
          gte(schema.interviewSessions.createdAt, dayStart),
        ),
      );
    if (ipCount >= INTERVIEW_DAILY_IP_CAP) {
      return { ok: false as const, code: "ip_capped" as const };
    }

    const opener: AuditMessage[] = [
      { role: "assistant", content: INTERVIEW_OPENER },
    ];
    const [row] = await tx
      .insert(schema.interviewSessions)
      .values({ ipHash, messages: opener })
      .returning({ id: schema.interviewSessions.id });
    return { ok: true as const, sessionId: row.id, messages: opener };
  });
}

export interface TurnGathered {
  sessionId: string;
  history: AuditMessage[];
  exchangeCount: number;
  userMessage: string;
}

/**
 * One tx: state gate, cooldown claim (concurrent turns serialize on the
 * lastTurnAt write — the ai_last_* pattern), belt-and-braces cap flip.
 */
async function gatherTurnInput(
  sessionId: string,
  userMessage: string,
): Promise<TurnGathered> {
  return withSystem(async (tx) => {
    const session = await tx.query.interviewSessions.findFirst({
      where: eq(schema.interviewSessions.id, sessionId),
    });
    if (!session || session.state !== "active") {
      throw new InterviewError("SESSION_GONE");
    }

    const now = Date.now();
    if (
      session.lastTurnAt &&
      now - session.lastTurnAt.getTime() < INTERVIEW_TURN_COOLDOWN_MS
    ) {
      throw new InterviewError("COOLDOWN");
    }

    if (session.exchangeCount >= INTERVIEW_EXCHANGE_CAP) {
      await tx
        .update(schema.interviewSessions)
        .set({ state: "awaiting_contact", updatedAt: new Date() })
        .where(eq(schema.interviewSessions.id, sessionId));
      throw new InterviewError("CAP_REACHED");
    }

    await tx
      .update(schema.interviewSessions)
      .set({ lastTurnAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.interviewSessions.id, sessionId));

    return {
      sessionId,
      history: session.messages as AuditMessage[],
      exchangeCount: session.exchangeCount,
      userMessage,
    };
  });
}

/**
 * The only network function for turns — injectable in tests. Forced tool
 * choice; no extended thinking (incompatible with forced tools).
 */
export async function callInterviewModel(g: TurnGathered): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: INTERVIEW_TURN_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: INTERVIEW_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [INTERVIEW_TOOL],
    tool_choice: { type: "tool", name: "interview_turn" },
    messages: buildInterviewMessages([
      ...g.history,
      { role: "user", content: g.userMessage },
    ]),
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in interview response");
  return toolUse.input;
}

async function persistTurn(
  sessionId: string,
  userMessage: string,
  turn: InterviewTurn,
): Promise<number> {
  return withSystem(async (tx) => {
    const session = await tx.query.interviewSessions.findFirst({
      where: eq(schema.interviewSessions.id, sessionId),
    });
    if (!session) throw new InterviewError("SESSION_GONE");
    const messages = [
      ...(session.messages as AuditMessage[]),
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: turn.reply },
    ];
    const exchangeCount = session.exchangeCount + 1;
    await tx
      .update(schema.interviewSessions)
      .set({
        messages,
        exchangeCount,
        state: turn.done ? "awaiting_contact" : "active",
        updatedAt: new Date(),
      })
      .where(eq(schema.interviewSessions.id, sessionId));
    return exchangeCount;
  });
}

export type TurnResult =
  | { ok: true; reply: string; done: boolean; exchangeCount: number }
  | { ok: false; code: "expired" | "cooldown" | "cap_reached" | "model_failed" };

/** Orchestrator: gather → call → validate → persist. Not one transaction —
 * the model call takes seconds. */
export async function runInterviewTurn(
  sessionId: string,
  userMessage: string,
  callModel: (g: TurnGathered) => Promise<unknown> = callInterviewModel,
): Promise<TurnResult> {
  let gathered: TurnGathered;
  try {
    gathered = await gatherTurnInput(sessionId, userMessage);
  } catch (err) {
    if (err instanceof InterviewError) {
      if (err.code === "SESSION_GONE") return { ok: false, code: "expired" };
      if (err.code === "COOLDOWN") return { ok: false, code: "cooldown" };
      return { ok: false, code: "cap_reached" };
    }
    throw err;
  }

  let turn: InterviewTurn | null;
  try {
    const raw = await callModel(gathered);
    turn = validateInterviewTurn(raw, gathered.exchangeCount + 1);
  } catch (err) {
    console.error("interview model call failed", err);
    turn = null;
  }
  if (!turn) return { ok: false, code: "model_failed" };

  const exchangeCount = await persistTurn(sessionId, userMessage, turn);
  return { ok: true, reply: turn.reply, done: turn.done, exchangeCount };
}

/** Plain-text assessment call — no forced tool, so adaptive thinking is
 * fine (the generateAuditReport config family). */
export async function callAssessmentModel(
  transcript: AuditMessage[],
): Promise<string> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: ASSESSMENT_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: INTERVIEW_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      ...buildInterviewMessages(transcript),
      { role: "user", content: ASSESSMENT_INSTRUCTION },
    ],
  });
  const msg = await stream.finalMessage();
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("empty assessment");
  return text;
}

export type PromoteResult =
  | { ok: true; assessment: string | null }
  | { ok: false; code: "expired" };

/**
 * Promotion: session → prospect tenant + audit row in the founder's
 * Discovery pipeline, then (outside the tx) the assessment generation.
 * Idempotent on double-submit via the completed+auditId short-circuit,
 * with the partial unique index on audit_id as the DB backstop. An
 * assessment failure never loses the lead — the session still completes.
 */
export async function promoteSession(
  sessionId: string,
  contact: { email: string; contactName: string; businessName: string },
  callAssessment: (t: AuditMessage[]) => Promise<string> = callAssessmentModel,
): Promise<PromoteResult> {
  type Promoted = {
    already: boolean;
    session: InterviewSession;
    tenantId?: string;
    auditId?: string;
  };

  let promoted: Promoted;
  try {
    promoted = await withSystem(async (tx): Promise<Promoted> => {
      const session = await tx.query.interviewSessions.findFirst({
        where: eq(schema.interviewSessions.id, sessionId),
      });
      if (!session) throw new InterviewError("SESSION_GONE");
      if (session.state === "completed" && session.auditId) {
        return { already: true, session };
      }
      if (session.state !== "awaiting_contact") {
        throw new InterviewError("SESSION_GONE");
      }

      const slug = await uniqueTenantSlug(tx, contact.businessName);
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: null,
          name: contact.businessName,
          slug,
          industry: "general",
          status: "prospect",
          contactName: contact.contactName,
          contactEmail: contact.email,
        })
        .returning({ id: schema.tenants.id });
      await tx
        .insert(schema.subscriptions)
        .values({ tenantId: tenant.id })
        .onConflictDoNothing();

      const [audit] = await tx
        .insert(schema.audits)
        .values({
          tenantId: tenant.id,
          businessName: contact.businessName,
          industry: "general",
          contactName: contact.contactName,
          status: "open",
          source: "self_serve",
          context: "Self-serve landing-page health check interview.",
          messages: session.messages,
        })
        .returning({ id: schema.audits.id });

      await tx
        .update(schema.interviewSessions)
        .set({
          auditId: audit.id,
          email: contact.email,
          contactName: contact.contactName,
          businessName: contact.businessName,
          state: "completed",
          updatedAt: new Date(),
        })
        .where(eq(schema.interviewSessions.id, sessionId));

      return { already: false, session, tenantId: tenant.id, auditId: audit.id };
    });
  } catch (err) {
    if (err instanceof InterviewError) return { ok: false, code: "expired" };
    throw err;
  }

  if (promoted.already) {
    return { ok: true, assessment: promoted.session.assessment };
  }

  await logAudit({
    action: "prospect.created",
    tenantId: promoted.tenantId,
    actorLabel: "landing-interview",
  });
  await logAudit({
    action: "interview.completed",
    tenantId: promoted.tenantId,
    actorLabel: "landing-interview",
    targetType: "audit",
    targetId: promoted.auditId,
    meta: {
      sessionId,
      exchanges: promoted.session.exchangeCount,
    },
  });

  // The lead is safe; the assessment is best-effort.
  let assessment: string | null = null;
  try {
    assessment = await callAssessment(
      promoted.session.messages as AuditMessage[],
    );
    await withSystem((tx) =>
      tx
        .update(schema.interviewSessions)
        .set({ assessment, updatedAt: new Date() })
        .where(eq(schema.interviewSessions.id, sessionId)),
    );
  } catch (err) {
    console.error("assessment generation failed", err);
  }

  return { ok: true, assessment };
}

/** Read-only resume for the browser (sessionStorage hydration). */
export async function loadInterviewSession(sessionId: string): Promise<{
  state: string;
  messages: AuditMessage[];
  assessment: string | null;
} | null> {
  const session = await withSystem((tx) =>
    tx.query.interviewSessions.findFirst({
      where: eq(schema.interviewSessions.id, sessionId),
    }),
  );
  if (!session) return null;
  return {
    state: session.state,
    messages: session.messages as AuditMessage[],
    assessment: session.assessment,
  };
}
