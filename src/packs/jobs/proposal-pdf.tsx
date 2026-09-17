import "server-only";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ensureNotoSans } from "@/lib/pdf/fonts";
import { buildProposalModel, type ProposalInput, type ProposalModel } from "./proposal-model";

/**
 * A proposal as a PDF (slice 10b, ADR 0070). Layout only: every figure and
 * every word arrives from `proposal-model.ts`. `createElement` rather than
 * JSX, as the certificate and Accounting's invoice do, and the same fonts.
 *
 * One portrait page that flows onto a second when the scope, the lines or
 * the terms need it; the watermark and the footer repeat on every page.
 */

type PdfStyle = NonNullable<ComponentProps<typeof View>["style"]>;

const ink = "#111827";
const muted = "#6b7280";
const rule = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 9.5,
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 48,
    color: ink,
    lineHeight: 1.35,
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  business: { fontSize: 13, fontWeight: "bold" },
  logo: { marginBottom: 6 },
  tagline: { marginTop: 1, color: muted, fontSize: 8 },
  title: { fontSize: 16, fontWeight: "bold", textAlign: "right" },
  subtitle: { marginTop: 3, textAlign: "right", color: muted },
  facts: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  fact: { width: "33%", paddingRight: 8, marginBottom: 5 },
  factLabel: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 1 },
  parties: { flexDirection: "row", marginBottom: 10 },
  party: { width: "50%", paddingRight: 12 },
  partyLabel: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 3 },
  partyLine: { marginBottom: 1 },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: 1,
    color: muted,
    marginTop: 10,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: ink,
  },
  paragraph: { marginBottom: 5, color: "#1f2937" },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: ink,
    paddingBottom: 4,
    marginBottom: 2,
    fontSize: 7,
    letterSpacing: 1,
    color: muted,
  },
  row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: rule },
  totalRow: { flexDirection: "row", paddingVertical: 6, borderTopWidth: 1, borderTopColor: ink, fontWeight: "bold" },
  pDesc: { flex: 1, paddingRight: 8 },
  /** An item's paragraph, under its name: the client's sentence about what it covers (ADR 0079). */
  pNote: { color: muted, fontSize: 8, marginTop: 2, paddingRight: 8 },
  /** An item's name over the lines beneath it: no amount, and a rule of its own. */
  headingRow: { flexDirection: "row", paddingTop: 7, paddingBottom: 3 },
  headingText: { flex: 1, fontWeight: "bold" },
  pQty: { width: 72, textAlign: "right" },
  pUnit: { width: 78, textAlign: "right" },
  pAmount: { width: 90, textAlign: "right" },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: ink, fontWeight: "bold", fontSize: 12 },
  validity: { marginTop: 8, color: "#374151" },
  closing: { marginTop: 6 },
  acceptance: { color: "#374151", fontSize: 8, lineHeight: 1.4 },
  signatures: { flexDirection: "row", marginTop: 4 },
  signature: { width: "50%", paddingRight: 16 },
  signatureHeading: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 4 },
  signatureLine: {
    marginTop: 9,
    borderBottomWidth: 1,
    borderBottomColor: ink,
    fontSize: 7,
    color: muted,
    paddingBottom: 1,
  },
  watermark: {
    position: "absolute",
    top: 260,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 90,
    fontWeight: "bold",
    color: "#ef4444",
    opacity: 0.16,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#9ca3af",
  },
});

function text(style: PdfStyle, content: string, key?: string): ReactElement {
  return createElement(Text, { style, key }, content);
}

function fixedParts(m: ProposalModel): ReactElement[] {
  const parts: ReactElement[] = [];
  if (m.watermark) {
    parts.push(createElement(Text, { key: "wm", style: styles.watermark, fixed: true }, m.watermark));
  }
  parts.push(
    createElement(
      View,
      { key: "footer", style: styles.footer, fixed: true },
      createElement(Text, null, m.footer),
      createElement(Text, {
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Page ${pageNumber} of ${totalPages}`,
      }),
    ),
  );
  return parts;
}

function section(key: string, title: string, paragraphs: string[]): ReactElement[] {
  if (paragraphs.length === 0) return [];
  return [
    createElement(
      View,
      { key },
      text(styles.sectionTitle, title),
      ...paragraphs.map((p, i) => text(styles.paragraph, p, `${key}${i}`)),
    ),
  ];
}

function priceTable(m: ProposalModel): ReactElement {
  const { price } = m;
  if (price.rows.length === 0 && price.rounding === null) {
    return createElement(
      View,
      { key: "price" },
      text(styles.sectionTitle, price.heading),
      createElement(View, { style: styles.sumRow }, text({}, price.total.label), text({}, price.total.amount)),
    );
  }
  const cells = (r: ProposalModel["price"]["rows"][number], key: string) => {
    // A heading is an item's name over its lines: bold, no columns, no amount.
    if (r.heading) {
      return createElement(
        View,
        { key, style: styles.headingRow },
        text(styles.headingText, r.description),
      );
    }
    const note = r.note?.trim() ?? "";
    return createElement(
      View,
      { key, style: styles.row },
      createElement(
        View,
        { style: styles.pDesc },
        text({}, r.description),
        ...(note === "" ? [] : [text(styles.pNote, note, `${key}n`)]),
      ),
      ...(price.columns.quantity ? [text(styles.pQty, r.quantity)] : []),
      ...(price.columns.unitPrice ? [text(styles.pUnit, r.unitPrice)] : []),
      text(styles.pAmount, r.amount),
    );
  };
  return createElement(
    View,
    { key: "price" },
    text(styles.sectionTitle, price.heading),
    createElement(
      View,
      { style: styles.tableHead },
      text(styles.pDesc, "ITEM"),
      ...(price.columns.quantity ? [text(styles.pQty, "QUANTITY")] : []),
      ...(price.columns.unitPrice ? [text(styles.pUnit, "PER UNIT")] : []),
      text(styles.pAmount, "AMOUNT"),
    ),
    ...price.rows.map((r, i) => cells(r, `r${i}`)),
    ...(price.rounding ? [cells(price.rounding, "rounding")] : []),
    createElement(
      View,
      { style: styles.totalRow },
      text(styles.pDesc, price.total.label),
      ...(price.columns.quantity ? [text(styles.pQty, "")] : []),
      ...(price.columns.unitPrice ? [text(styles.pUnit, "")] : []),
      text(styles.pAmount, price.total.amount),
    ),
  );
}

function proposalPage(m: ProposalModel): ReactElement {
  const header = createElement(
    View,
    { key: "head", style: styles.header },
    createElement(
      View,
      null,
      ...(m.logo
        ? [
            createElement(Image, {
              style: [styles.logo, { width: m.logo.width, height: m.logo.height }],
              src: { data: Buffer.from(m.logo.data), format: m.logo.format },
            }),
          ]
        : []),
      text([styles.business, { color: m.titleColor }], m.businessName),
      ...(m.tagline ? [text(styles.tagline, m.tagline)] : []),
    ),
    createElement(
      View,
      null,
      text([styles.title, { color: m.titleColor }], m.title),
      text(styles.subtitle, m.subtitle),
    ),
  );

  const facts = createElement(
    View,
    { key: "facts", style: styles.facts },
    ...m.facts.map(([label, value], i) =>
      createElement(View, { key: `f${i}`, style: styles.fact }, text(styles.factLabel, label.toUpperCase()), text({}, value)),
    ),
  );

  const parties = createElement(
    View,
    { key: "parties", style: styles.parties },
    createElement(
      View,
      { style: styles.party },
      text(styles.partyLabel, "TO"),
      ...(m.toLines.length > 0 ? m.toLines : ["—"]).map((l, i) => text(styles.partyLine, l, `t${i}`)),
    ),
    createElement(
      View,
      { style: styles.party },
      text(styles.partyLabel, "FROM"),
      ...m.fromLines.map((l, i) => text(styles.partyLine, l, `fr${i}`)),
    ),
  );

  const tail: ReactElement[] = [];
  if (m.validity) tail.push(text(styles.validity, m.validity, "validity"));
  // The acceptance sentence and the signature lines stay together: a page break between them reads as two documents.
  tail.push(
    createElement(
      View,
      { key: "closing", style: styles.closing, wrap: false },
      text(styles.acceptance, m.acceptance, "acceptance"),
      createElement(
        View,
        { key: "sig", style: styles.signatures },
        ...m.signatures.map((s, i) =>
          createElement(
            View,
            { key: `sg${i}`, style: styles.signature },
            text(styles.signatureHeading, s.heading.toUpperCase()),
            ...s.lines.map((l, j) => text(styles.signatureLine, l, `sl${i}${j}`)),
          ),
        ),
      ),
    ),
  );

  return createElement(
    Page,
    { size: "LETTER", style: styles.page },
    header,
    facts,
    parties,
    ...section("scope", "SCOPE OF WORK", m.scope),
    priceTable(m),
    ...section("exclusions", "NOT INCLUDED", m.exclusions),
    ...section("terms", "TERMS", m.terms),
    ...tail,
    ...fixedParts(m),
  );
}

export async function renderProposalPdf(input: ProposalInput): Promise<Uint8Array> {
  ensureNotoSans();
  const m = buildProposalModel(input);
  return renderToBuffer(
    createElement(Document, { title: `Proposal ${input.number} · ${input.projectNumber}` }, proposalPage(m)),
  );
}
