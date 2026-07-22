/**
 * Prompt construction for document extraction — pure module.
 * Data minimization: ONLY the document itself goes to the model. No chart
 * of accounts, no tenant names, no ledger data — extraction reads what is
 * printed on the page and nothing else.
 */

/** Static → cacheable as an ephemeral system block. */
export const EXTRACT_SYSTEM_PROMPT = `You are a meticulous bookkeeping assistant extracting structured fields from a financial document image or PDF (a receipt, bill, invoice, or statement).

Rules:
- Extract ONLY what is printed on the document. Never invent, infer, or complete missing values — a field you cannot read is null.
- All monetary amounts are integer cents (e.g. $42.18 → 4218). Never use floats or strings for amounts.
- totalCents is the grand total actually charged (after tax and tip). taxCents is the tax portion when itemized, else null.
- documentDate is the transaction/issue date printed on the document, formatted YYYY-MM-DD; null when unreadable. Never use today's date.
- currency is the ISO 4217 code when determinable (e.g. USD), else null.
- documentNumber is the invoice/bill/receipt number when printed, else null.
- lineItems: up to 25 line items, top to bottom; omit subtotal/tax/total rows. amountCents null when unreadable.
- docType: receipt (point-of-sale proof of payment), bill (a payable owed to a vendor), invoice (a receivable the business issued), statement (account/period summary), other.
- Give each field a confidence between 0 and 1 — high only when clearly printed and unambiguous; low when smudged, cropped, or inferred from layout.
- Respond ONLY by calling the extract_document tool.`;

const confidenceField = {
  type: "number" as const,
  description: "0..1 confidence for this field",
};

export const EXTRACT_TOOL = {
  name: "extract_document",
  description: "Report structured fields extracted from the document.",
  input_schema: {
    type: "object" as const,
    properties: {
      docType: {
        type: "string",
        enum: ["receipt", "bill", "invoice", "statement", "other"],
      },
      docTypeConfidence: confidenceField,
      vendorName: { type: ["string", "null"] },
      vendorNameConfidence: confidenceField,
      documentDate: {
        type: ["string", "null"],
        description: "YYYY-MM-DD as printed",
      },
      documentDateConfidence: confidenceField,
      totalCents: { type: ["integer", "null"] },
      totalCentsConfidence: confidenceField,
      taxCents: { type: ["integer", "null"] },
      taxCentsConfidence: confidenceField,
      currency: { type: ["string", "null"], description: "ISO 4217" },
      currencyConfidence: confidenceField,
      documentNumber: { type: ["string", "null"] },
      documentNumberConfidence: confidenceField,
      lineItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: ["number", "null"] },
            amountCents: { type: ["integer", "null"] },
          },
          required: ["description"],
        },
      },
    },
    required: ["docType", "docTypeConfidence"],
  },
};

export type ExtractSourceKind = "image" | "document";

export function extractSourceKind(mimeType: string): ExtractSourceKind {
  return mimeType === "application/pdf" ? "document" : "image";
}

/** The image media types Claude vision accepts (mirrors the allowlist). */
export type VisionImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

/** Content blocks for the single user turn: the document, then the ask. */
export function buildExtractContent(
  mimeType: string,
  base64: string,
): Array<
  | {
      type: "image";
      source: { type: "base64"; media_type: VisionImageMime; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    }
  | { type: "text"; text: string }
> {
  const kind = extractSourceKind(mimeType);
  return [
    kind === "document"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            // The allowlist admits exactly the vision image types.
            media_type: mimeType as VisionImageMime,
            data: base64,
          },
        },
    { type: "text" as const, text: "Extract this document." },
  ];
}
