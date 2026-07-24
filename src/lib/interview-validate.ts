import {
  INTERVIEW_EXCHANGE_CAP,
  INTERVIEW_REPLY_MAX,
  INTERVIEW_TOPICS,
  type InterviewTopic,
} from "@/lib/interview-prompt";

export interface InterviewTurn {
  reply: string;
  topicsCovered: InterviewTopic[];
  done: boolean;
}

/**
 * Everything from the model is untrusted. Returns null on a malformed or
 * empty reply — the caller persists nothing, doesn't count the exchange,
 * and the visitor simply retries.
 *
 * done is FORCED true once this turn reaches the server exchange cap,
 * regardless of what the model said — the cap is ours, not the model's.
 */
export function validateInterviewTurn(
  raw: unknown,
  exchangeCountAfterTurn: number,
): InterviewTurn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.reply !== "string") return null;
  const reply = obj.reply.trim().slice(0, INTERVIEW_REPLY_MAX);
  if (reply.length === 0) return null;

  const known = new Set<string>(INTERVIEW_TOPICS);
  const topicsCovered = Array.isArray(obj.topicsCovered)
    ? [
        ...new Set(
          obj.topicsCovered.filter(
            (t): t is InterviewTopic =>
              typeof t === "string" && known.has(t),
          ),
        ),
      ]
    : [];

  const done =
    obj.done === true || exchangeCountAfterTurn >= INTERVIEW_EXCHANGE_CAP;

  return { reply, topicsCovered, done };
}
