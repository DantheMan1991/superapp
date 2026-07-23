/**
 * Validation of the bill-coding tool output — pure, the testable seam.
 * Everything the model returns is untrusted: unknown line ids and account
 * codes are dropped, confidence is clamped, first suggestion per line id
 * wins. A malformed payload degrades to an empty list, never a throw.
 */

export interface BillCodingSuggestion {
  billLineId: string;
  accountId: string;
  accountCode: string;
  confidence: number;
  reason?: string;
}

export interface BillCoding {
  suggestions: BillCodingSuggestion[];
  model: string;
  at: string;
}

export function validateBillCoding(
  raw: unknown,
  lineIds: ReadonlySet<string>,
  accountsByCode: ReadonlyMap<string, { id: string; isActive: boolean }>,
  model: string,
  nowIso: string,
): BillCoding {
  const out: BillCodingSuggestion[] = [];
  const seen = new Set<string>();
  if (typeof raw === "object" && raw !== null) {
    const suggestions = (raw as { suggestions?: unknown }).suggestions;
    if (Array.isArray(suggestions)) {
      for (const item of suggestions) {
        if (typeof item !== "object" || item === null) continue;
        const s = item as {
          billLineId?: unknown;
          accountCode?: unknown;
          confidence?: unknown;
          reason?: unknown;
        };
        if (typeof s.billLineId !== "string" || !lineIds.has(s.billLineId)) continue;
        if (seen.has(s.billLineId)) continue;
        if (typeof s.accountCode !== "string") continue;
        const account = accountsByCode.get(s.accountCode.trim());
        if (!account || !account.isActive) continue;
        const confidence =
          typeof s.confidence === "number" && Number.isFinite(s.confidence)
            ? Math.min(1, Math.max(0, s.confidence))
            : 0;
        seen.add(s.billLineId);
        out.push({
          billLineId: s.billLineId,
          accountId: account.id,
          accountCode: s.accountCode.trim(),
          confidence,
          ...(typeof s.reason === "string" && s.reason.trim() !== ""
            ? { reason: s.reason.trim().slice(0, 200) }
            : {}),
        });
      }
    }
  }
  return { suggestions: out, model, at: nowIso };
}

/** Read a stored ai_coding jsonb defensively. */
export function readBillCoding(raw: unknown): BillCoding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<BillCoding>;
  if (!Array.isArray(r.suggestions)) return null;
  return r as BillCoding;
}
