import "server-only";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ensureNotoSans } from "@/lib/pdf/fonts";
import type { PaperColumn, PaperModel } from "./paper-model";

/**
 * One layout for the documents the business hands to somebody to sign
 * (ADR 0075): the change order and the order. Layout only — every word
 * and figure arrives from `paper-model.ts` — in the proposal's own shape
 * (`proposal-pdf.tsx`): the header with the brand, the facts, the two
 * parties, the sections, a table when the document has lines, the money in
 * one block, and a closing the page never splits from its signature lines.
 * `createElement` rather than JSX, as every PDF in the product is.
 */

type PdfStyle = NonNullable<ComponentProps<typeof View>["style"]>;

const ink = "#111827";
const muted = "#6b7280";
const rule = "#e5e7eb";

const styles = StyleSheet.create({
  page: { fontFamily: "NotoSans", fontSize: 9.5, paddingTop: 36, paddingBottom: 40, paddingHorizontal: 48, color: ink, lineHeight: 1.35 },
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
  sectionTitle: { fontSize: 8, letterSpacing: 1, color: muted, marginTop: 10, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: ink },
  paragraph: { marginBottom: 5, color: "#1f2937" },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: ink, paddingBottom: 4, marginBottom: 2, fontSize: 7, letterSpacing: 1, color: muted },
  row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: rule },
  totalRow: { flexDirection: "row", paddingVertical: 6, borderTopWidth: 1, borderTopColor: ink, fontWeight: "bold" },
  flexCell: { flex: 1, paddingRight: 8 },
  sums: { marginTop: 10, borderTopWidth: 1, borderTopColor: ink },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: rule },
  sumStrong: { fontWeight: "bold", fontSize: 12, borderBottomWidth: 1, borderBottomColor: ink, paddingVertical: 8 },
  closing: { marginTop: 8 },
  closingText: { color: "#374151", fontSize: 8, lineHeight: 1.4 },
  signatures: { flexDirection: "row", marginTop: 4 },
  signature: { width: "50%", paddingRight: 16 },
  signatureHeading: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 4 },
  signatureLine: { marginTop: 9, borderBottomWidth: 1, borderBottomColor: ink, fontSize: 7, color: muted, paddingBottom: 1 },
  watermark: { position: "absolute", top: 260, left: 0, right: 0, textAlign: "center", fontSize: 90, fontWeight: "bold", color: "#ef4444", opacity: 0.16 },
  footer: { position: "absolute", bottom: 26, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#9ca3af" },
});

function text(style: PdfStyle, content: string, key?: string): ReactElement {
  return createElement(Text, { style, key }, content);
}

function cellStyle(c: PaperColumn): PdfStyle {
  return c.width === undefined ? styles.flexCell : { width: c.width, textAlign: c.align };
}

function table(m: PaperModel): ReactElement[] {
  const t = m.table;
  if (!t) return [];
  const head = createElement(
    View,
    { style: styles.tableHead },
    ...t.columns.map((c, i) => text(cellStyle(c), c.label, `h${i}`)),
  );
  const rows = t.rows.map((r, i) =>
    createElement(
      View,
      { key: `r${i}`, style: styles.row },
      ...r.map((cell, j) => text(cellStyle(t.columns[j]), cell, `c${i}-${j}`)),
    ),
  );
  const total = t.total
    ? [
        createElement(
          View,
          { key: "total", style: styles.totalRow },
          text(styles.flexCell, t.total.label),
          ...t.columns.slice(1, -1).map((c, i) => text(cellStyle(c), "", `tb${i}`)),
          text(cellStyle(t.columns[t.columns.length - 1]), t.total.amount),
        ),
      ]
    : [];
  return [createElement(View, { key: "table" }, text(styles.sectionTitle, t.heading), head, ...rows, ...total)];
}

function sums(m: PaperModel): ReactElement[] {
  if (m.sums.length === 0) return [];
  return [
    createElement(
      View,
      { key: "sums", style: styles.sums, wrap: false },
      ...m.sums.map((s, i) =>
        createElement(
          View,
          { key: `s${i}`, style: s.strong ? [styles.sumRow, styles.sumStrong] : styles.sumRow },
          text({}, s.label),
          text({}, s.amount),
        ),
      ),
    ),
  ];
}

function fixedParts(m: PaperModel): ReactElement[] {
  const parts: ReactElement[] = [];
  if (m.watermark) parts.push(createElement(Text, { key: "wm", style: styles.watermark, fixed: true }, m.watermark));
  parts.push(
    createElement(
      View,
      { key: "footer", style: styles.footer, fixed: true },
      createElement(Text, null, m.footer),
      createElement(Text, { render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` }),
    ),
  );
  return parts;
}

function paperPage(m: PaperModel): ReactElement {
  const header = createElement(
    View,
    { key: "head", style: styles.header },
    createElement(
      View,
      null,
      ...(m.logo ? [createElement(Image, { style: [styles.logo, { width: m.logo.width, height: m.logo.height }], src: { data: Buffer.from(m.logo.data), format: m.logo.format } })] : []),
      text([styles.business, { color: m.titleColor }], m.businessName),
      ...(m.tagline ? [text(styles.tagline, m.tagline)] : []),
    ),
    createElement(View, null, text([styles.title, { color: m.titleColor }], m.title), text(styles.subtitle, m.subtitle)),
  );
  const facts = createElement(
    View,
    { key: "facts", style: styles.facts },
    ...m.facts.map(([label, value], i) => createElement(View, { key: `f${i}`, style: styles.fact }, text(styles.factLabel, label.toUpperCase()), text({}, value))),
  );
  const parties = createElement(
    View,
    { key: "parties", style: styles.parties },
    createElement(View, { style: styles.party }, text(styles.partyLabel, m.toLabel), ...(m.toLines.length > 0 ? m.toLines : ["—"]).map((l, i) => text(styles.partyLine, l, `t${i}`))),
    createElement(View, { style: styles.party }, text(styles.partyLabel, "FROM"), ...m.fromLines.map((l, i) => text(styles.partyLine, l, `fr${i}`))),
  );
  const sections = m.sections.map((s, i) =>
    createElement(View, { key: `sec${i}` }, text(styles.sectionTitle, s.title), ...s.paragraphs.map((p, j) => text(styles.paragraph, p, `p${i}-${j}`))),
  );
  // The closing sentence and the signature lines stay together: a page break between them reads as two documents.
  const closing = createElement(
    View,
    { key: "closing", style: styles.closing, wrap: false },
    text(styles.closingText, m.closing),
    createElement(
      View,
      { style: styles.signatures },
      ...m.signatures.map((s, i) =>
        createElement(View, { key: `sg${i}`, style: styles.signature }, text(styles.signatureHeading, s.heading.toUpperCase()), ...s.lines.map((l, j) => text(styles.signatureLine, l, `sl${i}${j}`))),
      ),
    ),
  );
  // The order's changes and terms read after its lines; the change order's description reads before its money.
  const body = m.table ? [...table(m), ...sections, ...sums(m)] : [...sections, ...sums(m)];
  return createElement(Page, { size: "LETTER", style: styles.page }, header, facts, parties, ...body, closing, ...fixedParts(m));
}

export async function renderPaperPdf(m: PaperModel, documentTitle: string): Promise<Uint8Array> {
  ensureNotoSans();
  return renderToBuffer(createElement(Document, { title: documentTitle }, paperPage(m)));
}
