"use server";

import { headers } from "next/headers";
import { z } from "zod";
import type { AuditMessage } from "@/db/schema";
import {
  hashInterviewIp,
  loadInterviewSession,
  promoteSession,
  runInterviewTurn,
  startInterviewSession,
} from "@/lib/interview";
import { INTERVIEW_MESSAGE_MAX } from "@/lib/interview-prompt";

/**
 * PUBLIC server actions — the platform's only unauthenticated mutation
 * surface besides signature-verified webhooks. No requireX by design; the
 * defenses are the abuse caps, the unguessable session uuid, zod at every
 * boundary, and NO validity oracles: every miss/expired/foreign-uuid path
 * answers with the same generic message.
 */

const GENERIC_EXPIRED = "This interview has expired — start a new one.";
const CAPACITY_MSG =
  "We're at capacity for free health checks today — please come back tomorrow.";

/** First hop of x-forwarded-for — trustworthy on Vercel. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

export async function startInterview(): Promise<
  { sessionId: string; messages: AuditMessage[] } | { error: string }
> {
  if (!process.env.INTERVIEW_IP_SALT) {
    // Fail closed: without the salt there is no abuse keying at all.
    console.error("INTERVIEW_IP_SALT is not set — health check disabled");
    return { error: CAPACITY_MSG };
  }
  const ipHash = hashInterviewIp(await clientIp());
  const res = await startInterviewSession(ipHash);
  if (!res.ok) {
    return {
      error:
        res.code === "ip_capped"
          ? "You've used today's free health checks from this connection — come back tomorrow."
          : CAPACITY_MSG,
    };
  }
  return { sessionId: res.sessionId, messages: res.messages };
}

const getSchema = z.object({ sessionId: z.string().uuid() });

export async function getInterview(input: { sessionId: string }): Promise<
  | { state: string; messages: AuditMessage[]; assessment: string | null }
  | { error: string }
> {
  const parsed = getSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_EXPIRED };
  const session = await loadInterviewSession(parsed.data.sessionId);
  if (!session) return { error: GENERIC_EXPIRED };
  return session;
}

const sendSchema = z.object({
  sessionId: z.string().uuid(),
  // Truncate-then-validate (webhook precedent): never reject for length.
  message: z
    .string()
    .transform((s) => s.slice(0, INTERVIEW_MESSAGE_MAX).trim())
    .pipe(z.string().min(1)),
});

export async function sendInterviewMessage(input: {
  sessionId: string;
  message: string;
}): Promise<
  | { reply: string; done: boolean; exchangeCount: number }
  | { error: string; retryable?: boolean }
> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { error: GENERIC_EXPIRED };

  const res = await runInterviewTurn(
    parsed.data.sessionId,
    parsed.data.message,
  );
  if (res.ok) {
    return { reply: res.reply, done: res.done, exchangeCount: res.exchangeCount };
  }
  switch (res.code) {
    case "cooldown":
      return {
        error: "One moment — give it a few seconds and try again.",
        retryable: true,
      };
    case "model_failed":
      return {
        error: "That didn't go through — try sending it again.",
        retryable: true,
      };
    case "cap_reached":
      // The session already flipped to awaiting_contact server-side.
      return { reply: "", done: true, exchangeCount: 0 };
    default:
      return { error: GENERIC_EXPIRED };
  }
}

const contactSchema = z.object({
  sessionId: z.string().uuid(),
  email: z.string().trim().email().max(254),
  contactName: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(2).max(120),
});

export async function submitContact(input: {
  sessionId: string;
  email: string;
  contactName: string;
  businessName: string;
}): Promise<{ assessment: string | null } | { error: string }> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message === "Invalid email"
          ? "That email doesn't look right — check it and try again."
          : "Check the fields and try again — name, email, and business name are all needed.",
    };
  }
  const { sessionId, ...contact } = parsed.data;
  const res = await promoteSession(sessionId, contact);
  if (!res.ok) return { error: GENERIC_EXPIRED };
  return { assessment: res.assessment };
}
