import { isValidIsoDate } from "../lib/money";

/**
 * Validation of the model's extraction output — pure, the testable seam.
 * Everything is untrusted: floats and out-of-range values become null,
 * confidences are clamped, unknown docTypes degrade to "other". Malformed
 * payloads degrade to an all-null extraction — never a throw, and the
 * result NEVER flows into ledger math (it only prefills forms a human
 * submits).
 *
 * The output shape is the session-6 contract: Payables consumes it
 * unchanged.
 */

export const EXTRACTION_LINE_ITEM_CAP = 25;
const DESCRIPTION_CAP = 200;
const TEXT_CAP = 200;
/** Sanity ceiling mirroring MAX_AMOUNT_CENTS ($100B) from lib/money. */
const MAX_EXTRACT_CENTS = 1e13;

export type ExtractedDocType =
  | "receipt"
  | "bill"
  | "invoice"
  | "statement"
  | "other";

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
}

export interface ExtractedLineItem {
  description: string;
  quantity?: number;
  amountCents: number | null;
}

export interface DocumentExtraction {
  docType: ExtractedDocType;
  docTypeConfidence: number;
  fields: {
    vendorName: ExtractedField<string>;
    documentDate: ExtractedField<string>;
    totalCents: ExtractedField<number>;
    taxCents: ExtractedField<number>;
    currency: ExtractedField<string>;
    documentNumber: ExtractedField<string>;
  };
  lineItems: ExtractedLineItem[];
  model: string;
  extractedAt: string;
}

const DOC_TYPES: ReadonlySet<string> = new Set([
  "receipt",
  "bill",
  "invoice",
  "statement",
  "other",
]);

function clamp01(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, TEXT_CAP);
  return trimmed === "" ? null : trimmed;
}

function cleanCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (Math.abs(v) > MAX_EXTRACT_CENTS) return null;
  return v;
}

function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return isValidIsoDate(v.trim()) ? v.trim() : null;
}

function cleanCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

function field<T>(value: T | null, confidence: unknown): ExtractedField<T> {
  return { value, confidence: value === null ? 0 : clamp01(confidence) };
}

export function emptyExtraction(
  model: string,
  nowIso: string,
): DocumentExtraction {
  return {
    docType: "other",
    docTypeConfidence: 0,
    fields: {
      vendorName: { value: null, confidence: 0 },
      documentDate: { value: null, confidence: 0 },
      totalCents: { value: null, confidence: 0 },
      taxCents: { value: null, confidence: 0 },
      currency: { value: null, confidence: 0 },
      documentNumber: { value: null, confidence: 0 },
    },
    lineItems: [],
    model,
    extractedAt: nowIso,
  };
}

export function validateExtraction(
  raw: unknown,
  model: string,
  nowIso: string,
): DocumentExtraction {
  if (typeof raw !== "object" || raw === null) {
    return emptyExtraction(model, nowIso);
  }
  const r = raw as Record<string, unknown>;

  const docTypeRaw = typeof r.docType === "string" ? r.docType : "";
  const docType: ExtractedDocType = DOC_TYPES.has(docTypeRaw)
    ? (docTypeRaw as ExtractedDocType)
    : "other";

  const lineItems: ExtractedLineItem[] = [];
  if (Array.isArray(r.lineItems)) {
    for (const item of r.lineItems.slice(0, EXTRACTION_LINE_ITEM_CAP)) {
      if (typeof item !== "object" || item === null) continue;
      const li = item as Record<string, unknown>;
      const description =
        typeof li.description === "string"
          ? li.description.trim().slice(0, DESCRIPTION_CAP)
          : "";
      if (description === "") continue;
      const quantity =
        typeof li.quantity === "number" &&
        Number.isFinite(li.quantity) &&
        li.quantity > 0
          ? li.quantity
          : undefined;
      lineItems.push({
        description,
        ...(quantity !== undefined ? { quantity } : {}),
        amountCents: cleanCents(li.amountCents),
      });
    }
  }

  return {
    docType,
    docTypeConfidence: clamp01(r.docTypeConfidence),
    fields: {
      vendorName: field(cleanText(r.vendorName), r.vendorNameConfidence),
      documentDate: field(cleanDate(r.documentDate), r.documentDateConfidence),
      totalCents: field(cleanCents(r.totalCents), r.totalCentsConfidence),
      taxCents: field(cleanCents(r.taxCents), r.taxCentsConfidence),
      currency: field(cleanCurrency(r.currency), r.currencyConfidence),
      documentNumber: field(
        cleanText(r.documentNumber),
        r.documentNumberConfidence,
      ),
    },
    lineItems,
    model,
    extractedAt: nowIso,
  };
}

/** Read a stored extraction jsonb defensively (schema-drift tolerant). */
export function readExtraction(raw: unknown): DocumentExtraction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<DocumentExtraction>;
  if (!r.fields || typeof r.fields !== "object") return null;
  return r as DocumentExtraction;
}
