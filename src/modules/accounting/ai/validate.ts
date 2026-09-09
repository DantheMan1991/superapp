import { PERSONAL_CODE } from "./prompt";

/**
 * Validation of the model's tool output — pure, the testable seam.
 * Everything the model returns is untrusted: unknown transaction ids and
 * account codes are dropped, confidence is clamped, first suggestion per
 * id wins. A malformed payload degrades to an empty map, never a throw.
 */

export interface AiSuggestion {
  /** Null when the model said the line is not the business's (`personal`). */
  accountId: string | null;
  accountCode: string;
  /**
   * True when the model answered `PERSONAL_CODE` on a personal register (ADR
   * 0034): the row should be set aside, not posted. Never set unless the
   * caller allowed it — on a business account the code is dropped like any
   * other code that is not in the chart.
   */
  personal?: boolean;
  confidence: number;
  reason?: string;
  model: string;
  at: string;
}

export function validateSuggestions(
  raw: unknown,
  batchIds: ReadonlySet<string>,
  accountsByCode: ReadonlyMap<string, { id: string; isActive: boolean }>,
  model: string,
  nowIso: string,
  options: { allowPersonal?: boolean } = {},
): Map<string, AiSuggestion> {
  const out = new Map<string, AiSuggestion>();
  if (typeof raw !== "object" || raw === null) return out;
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return out;
  for (const item of suggestions) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as {
      transactionId?: unknown;
      accountCode?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    if (typeof s.transactionId !== "string" || !batchIds.has(s.transactionId)) continue;
    if (out.has(s.transactionId)) continue;
    if (typeof s.accountCode !== "string") continue;
    const code = s.accountCode.trim();
    const personal = code === PERSONAL_CODE;
    if (personal && !options.allowPersonal) continue;
    const account = personal ? null : accountsByCode.get(code);
    if (!personal && (!account || !account.isActive)) continue;
    let confidence = typeof s.confidence === "number" ? s.confidence : 0;
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.min(1, Math.max(0, confidence));
    const reason =
      typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined;
    out.set(s.transactionId, {
      accountId: account?.id ?? null,
      accountCode: code,
      ...(personal ? { personal: true } : {}),
      confidence,
      ...(reason ? { reason } : {}),
      model,
      at: nowIso,
    });
  }
  return out;
}
