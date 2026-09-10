import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import type { AuditMessage } from "@/db/schema";
import { logAudit, logAuditInTx } from "@/lib/audit";
import { getClaude, CLAUDE_MODEL, CLAUDE_THINKING_OFF } from "@/lib/claude";
import { sendEmail } from "@/lib/email/send";
import { landLead } from "@/lib/leads/resolve";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { createParty } from "@/lib/parties";
import { findPartiesByContact } from "@/lib/parties/contacts";
import { notifyPlan, tryAddContactPoint } from "@/lib/sites/enquiries";
import { splitPersonName } from "@/lib/sites/enquiry-schema";
import { appUrl } from "@/lib/stripe-customer";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { todayInTimezone } from "@/lib/timezone";
import { createUnlinkedWork, createWorkForEntity } from "@/lib/work/entity-work";
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
 * choice, with thinking pinned OFF for the token budget rather than for
 * compatibility — forced tools work with thinking on (verified against the
 * live API on claude-opus-5); the old claim here was stale.
 */
export async function callInterviewModel(g: TurnGathered): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: INTERVIEW_TURN_MAX_TOKENS,
    // Pinned, not inherited. On claude-opus-5 an omitted `thinking` runs
    // ADAPTIVE, and this budget is 1024 tokens covering thinking AND the
    // response — the tightest in the codebase. A turn that thought its way
    // through the budget would truncate the forced tool call and take the
    // public health-check funnel down. See lib/claude.ts.
    thinking: CLAUDE_THINKING_OFF,
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
  /** `unavailable`: nowhere to land — no operator tenant is named, or the
   *  landing failed and the session was handed back for another try. */
  | { ok: false; code: "expired" | "unavailable" };

/** What one landing wrote, for the log and the email. */
interface LandedLeadRows {
  auditId: string;
  businessPartyId: string;
  personPartyId: string;
  workItemId: string;
  crm: boolean;
}

export interface LeadContact {
  email: string;
  contactName: string;
  businessName: string;
}

/** A failed landing hands the session back so the visitor can try again. */
async function releaseClaim(sessionId: string): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.interviewSessions)
      .set({ state: "awaiting_contact", updatedAt: new Date() })
      .where(eq(schema.interviewSessions.id, sessionId)),
  );
}

/**
 * The operator hears about a lead the way a business hears about an enquiry
 * (ADR 0021): its own owners' addresses, never the visitor's, with Reply-To
 * set to the visitor. Best-effort — the lead is already safe.
 */
export async function notifyOperator(
  operatorId: string,
  landed: LandedLeadRows,
  contact: LeadContact,
  exchanges: number,
): Promise<void> {
  const plan = await notifyPlan(operatorId, "");
  const subject = `Health check lead: ${contact.businessName}`;
  const text = [
    `${contact.contactName} (${contact.email}) finished the health check for ${contact.businessName} — ${exchanges} exchanges.`,
    "",
    `Discovery: ${appUrl(`/dashboard/m/professional-services/discovery/${landed.auditId}`)}`,
    landed.crm
      ? "The business and the contact are in the CRM, with a deal on the pipeline and a follow-up due today."
      : "A follow-up is due today.",
    "",
    "Reply to this email to reach them.",
  ].join("\n");
  for (const to of plan.recipients) {
    const sent = await sendEmail({
      tenantId: operatorId,
      kind: "health_check",
      to: to.email,
      subject,
      text,
      idempotencyKey: `health-check:${landed.auditId}:${to.key}`,
      replyTo: contact.email,
    });
    if (!sent.ok) console.error(`health check: email not sent (${sent.reason})`);
  }
}

/**
 * Promotion: session → prospect tenant + audit row in the founder's
 * Discovery pipeline, then (outside the tx) the assessment generation.
 * Idempotent on double-submit via the completed+auditId short-circuit,
 * with the partial unique index on audit_id as the DB backstop. An
 * assessment failure never loses the lead — the session still completes.
 */
export async function promoteSession(
  sessionId: string,
  contact: LeadContact,
  callAssessment: (t: AuditMessage[]) => Promise<string> = callAssessmentModel,
  notify: typeof notifyOperator = notifyOperator,
): Promise<PromoteResult> {
  // 1. Claim the session, atomically: only an `awaiting_contact` row takes
  //    the contact and flips to `completed`, so a double submit finds the
  //    first claim and gets the same answer back. A stale id gets the same
  //    message an expired one does — no validity oracles.
  const claim = await withSystem(async (tx) => {
    const session = await tx.query.interviewSessions.findFirst({
      where: eq(schema.interviewSessions.id, sessionId),
    });
    if (!session) return { kind: "gone" as const };
    if (session.state === "completed" && session.auditId) {
      return { kind: "already" as const, session };
    }
    if (session.state !== "awaiting_contact") return { kind: "gone" as const };
    const [claimed] = await tx
      .update(schema.interviewSessions)
      .set({
        email: contact.email,
        contactName: contact.contactName,
        businessName: contact.businessName,
        state: "completed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.interviewSessions.id, sessionId),
          eq(schema.interviewSessions.state, "awaiting_contact"),
        ),
      )
      .returning();
    if (!claimed) return { kind: "gone" as const };
    return { kind: "claimed" as const, session: claimed };
  });
  if (claim.kind === "gone") return { ok: false, code: "expired" };
  if (claim.kind === "already") {
    return { ok: true, assessment: claim.session.assessment };
  }
  const session = claim.session;

  // 2. Where a lead lands: the OPERATOR tenant (ADR 0041) — named by the
  //    flag, not by anything the visitor chose. With none there is nowhere
  //    to land, so the claim is handed back for a later try.
  const operator = await getOperatorTenant();
  if (!operator) {
    console.error("health check: no operator tenant is named; a lead could not land");
    await releaseClaim(sessionId);
    return { ok: false, code: "unavailable" };
  }

  // 3. Land, as `staff` with no user, inside the operator's own context and
  //    through the doors every member action uses — the enquiry's shape
  //    (ADR 0021) — plus the slot the CRM fills (ADR 0042). One transaction:
  //    the business, the person, the discovery record, the deal and the
  //    follow-up exist together or not at all.
  let landed: LandedLeadRows;
  try {
    landed = await withTenant(
      operator.id,
      async (tx): Promise<LandedLeadRows> => {
        const timezone = await getTenantTimezone(tx, operator.id);
        const receivedOn = todayInTimezone(timezone);

        const business = await createParty(tx, operator.id, {
          kind: "organization",
          displayName: contact.businessName,
        });
        // The person: matched by email when the operator already knows the
        // address, otherwise new — never a second party for the same inbox.
        const matches = await findPartiesByContact(tx, operator.id, "email", contact.email);
        const known = matches.map((m) => m.party).find((p) => p.kind === "person");
        const person =
          known ??
          (await createParty(tx, operator.id, {
            kind: "person",
            displayName: contact.contactName,
            ...splitPersonName(contact.contactName),
          }));
        await tryAddContactPoint(tx, operator.id, person.id, "email", contact.email);

        const [audit] = await tx
          .insert(schema.audits)
          .values({
            tenantId: operator.id,
            partyId: business.id,
            businessName: contact.businessName,
            industry: "general",
            contactName: contact.contactName,
            status: "open",
            source: "self_serve",
            context: "Self-serve health check interview.",
            messages: session.messages,
          })
          .returning({ id: schema.audits.id });

        const landedIn = await landLead(
          tx,
          { tenantId: operator.id, userId: "" },
          {
            partyId: business.id,
            contactPartyId: person.id,
            source: "health-check",
            proposition: {
              title: `${contact.businessName}: the outsourced back office`,
              note: {
                subject: "Health check",
                body: `${contact.contactName} completed the health check interview (${session.exchangeCount} exchanges). Transcript and assessment: Discovery, ${appUrl(`/dashboard/m/professional-services/discovery/${audit.id}`)}.`,
              },
            },
          },
        );
        const crm = landedIn.includes("crm");

        const workInput = {
          title: `Health check lead: ${contact.businessName}`,
          notes: `${contact.contactName} · ${contact.email}\nCompleted the health check (${session.exchangeCount} exchanges). Open Discovery to read it.`,
          dueOn: receivedOn,
        };
        const workCtx = { tenantId: operator.id, userId: "" };
        const workItemId = crm
          ? await createWorkForEntity(
              tx,
              workCtx,
              { extensionSlug: "crm", entityType: "contact", entityId: person.id },
              workInput,
            )
          : await createUnlinkedWork(tx, workCtx, workInput);

        await logAuditInTx(tx, {
          action: "lead.landed",
          tenantId: operator.id,
          actorLabel: "landing-interview",
          targetType: "audit",
          targetId: audit.id,
          meta: {
            sessionId,
            partyId: business.id,
            contactPartyId: person.id,
            matchedExisting: !!known,
            crm,
            workItemId,
            exchanges: session.exchangeCount,
          },
        });

        return {
          auditId: audit.id,
          businessPartyId: business.id,
          personPartyId: person.id,
          workItemId,
          crm,
        };
      },
      { role: "staff" },
    );
  } catch (err) {
    console.error("health check: landing failed", err instanceof Error ? err.message : err);
    await releaseClaim(sessionId);
    return { ok: false, code: "unavailable" };
  }

  // 4. The anchor: the session remembers its audit, which is what makes a
  //    double submit answer with the same lead instead of landing twice.
  await withSystem((tx) =>
    tx
      .update(schema.interviewSessions)
      .set({ auditId: landed.auditId, updatedAt: new Date() })
      .where(eq(schema.interviewSessions.id, sessionId)),
  );

  await logAudit({
    action: "interview.completed",
    tenantId: operator.id,
    actorLabel: "landing-interview",
    targetType: "audit",
    targetId: landed.auditId,
    meta: { sessionId, exchanges: session.exchangeCount, partyId: landed.businessPartyId },
  });

  // 5. The operator hears about it.
  try {
    await notify(operator.id, landed, contact, session.exchangeCount);
  } catch (err) {
    console.error("health check: notification failed", err);
  }

  // 6. The lead is safe; the assessment is best-effort. What the visitor is
  //    told is also what the founder's discovery starts from.
  let assessment: string | null = null;
  try {
    const text = await callAssessment(session.messages as AuditMessage[]);
    assessment = text;
    await withSystem((tx) =>
      tx
        .update(schema.interviewSessions)
        .set({ assessment: text, updatedAt: new Date() })
        .where(eq(schema.interviewSessions.id, sessionId)),
    );
    await withTenant(
      operator.id,
      (tx) =>
        tx
          .update(schema.audits)
          .set({
            context: `Self-serve health check interview.\n\nThe assessment the visitor received:\n\n${text}`,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.audits.tenantId, operator.id), eq(schema.audits.id, landed.auditId))),
      { role: "staff" },
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
