import "server-only";
import { createElement, type ComponentProps, type ReactElement } from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { ensureNotoSans } from "@/lib/pdf/fonts";
import { buildCertificateModel, type CertificateInput, type CertificateModel } from "./certificate-model";

/**
 * A pay application as a PDF — the certificate page and the continuation
 * sheet (slice 5e, ADR 0063). Layout only: every figure and every word
 * arrives from `certificate-model.ts`. `createElement` rather than JSX, as
 * Accounting's `invoice-pdf.tsx` does, and the same fonts.
 *
 * Page one is portrait — the nine lines, the change-order summary and the
 * signature blocks fit the way the form everybody knows fits them. Page two
 * is LANDSCAPE, because a continuation sheet has nine columns and a portrait
 * page has room for six.
 */

/** What react-pdf accepts as a style: one, or a list to merge. Derived from View, whose style is never the SVG union Text's can be. */
type PdfStyle = NonNullable<ComponentProps<typeof View>["style"]>;

const ink = "#111827";
const muted = "#6b7280";
const rule = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 9,
    paddingTop: 34,
    paddingBottom: 46,
    paddingHorizontal: 44,
    color: ink,
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  business: { fontSize: 13, fontWeight: "bold" },
  logo: { marginBottom: 6 },
  tagline: { marginTop: 1, color: muted, fontSize: 8 },
  title: { fontSize: 14, fontWeight: "bold", textAlign: "right" },
  subtitle: { marginTop: 3, textAlign: "right", color: muted },
  facts: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  fact: { width: "33%", paddingRight: 8, marginBottom: 4 },
  factLabel: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 1 },
  parties: { flexDirection: "row", marginBottom: 8 },
  party: { width: "50%", paddingRight: 12 },
  partyLabel: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 3 },
  partyLine: { marginBottom: 1 },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: 1,
    color: muted,
    marginTop: 6,
    marginBottom: 3,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: ink,
  },
  line: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 1, borderBottomColor: rule },
  lineN: { width: 18, color: muted },
  lineLabel: { flex: 1, paddingRight: 8 },
  lineAmount: { width: 96, textAlign: "right" },
  detail: { flexDirection: "row", paddingVertical: 1, paddingLeft: 18, color: muted, fontSize: 8 },
  bold: { fontWeight: "bold" },
  changeHead: { flexDirection: "row", paddingBottom: 3, fontSize: 7, letterSpacing: 1, color: muted },
  changeRow: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 1, borderBottomColor: rule },
  cLabel: { flex: 1 },
  cNum: { width: 96, textAlign: "right" },
  certification: { marginTop: 8, color: "#374151", fontSize: 7.5, lineHeight: 1.35 },
  signatures: { flexDirection: "row", marginTop: 8 },
  signature: { width: "50%", paddingRight: 16 },
  signatureHeading: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 6 },
  signatureLine: {
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: ink,
    fontSize: 7,
    color: muted,
    paddingBottom: 1,
  },
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
  totalRow: { flexDirection: "row", paddingVertical: 5, borderTopWidth: 1, borderTopColor: ink, fontWeight: "bold" },
  // The continuation sheet's columns, in points, on a landscape letter page.
  kItem: { width: 26 },
  kDesc: { flex: 1, paddingRight: 6 },
  kNum: { width: 74, textAlign: "right" },
  kPct: { width: 40, textAlign: "right" },
  // Cost and labour tables.
  lName: { flex: 1, paddingRight: 6 },
  lNum: { width: 78, textAlign: "right" },
  lHours: { width: 62, textAlign: "right" },
  caption: { color: muted, marginBottom: 8 },
  notes: { marginTop: 14, color: "#374151" },
  notesLabel: { fontSize: 7, letterSpacing: 1, color: muted, marginBottom: 2 },
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
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#9ca3af",
  },
});

function text(style: PdfStyle, content: string, key?: string): ReactElement {
  return createElement(Text, { style, key }, content);
}

function fixedParts(m: CertificateModel): ReactElement[] {
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

function certificatePage(m: CertificateModel): ReactElement {
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
      createElement(
        View,
        { key: `f${i}`, style: styles.fact },
        text(styles.factLabel, label.toUpperCase()),
        text({}, value),
      ),
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

  const summary = createElement(
    View,
    { key: "summary" },
    text(styles.sectionTitle, "APPLICATION FOR PAYMENT"),
    ...m.summary.flatMap((l) => [
      createElement(
        View,
        { key: `s${l.n}`, style: [styles.line, ...(l.bold ? [styles.bold] : [])] },
        text(styles.lineN, l.n),
        text(styles.lineLabel, l.label),
        text(styles.lineAmount, l.amount),
      ),
      ...(l.detail ?? []).map((d, i) =>
        createElement(
          View,
          { key: `s${l.n}d${i}`, style: styles.detail },
          text(styles.lineLabel, d.label),
          text(styles.lineAmount, d.amount),
        ),
      ),
    ]),
  );

  const changes = createElement(
    View,
    { key: "changes" },
    text(styles.sectionTitle, "CHANGE ORDER SUMMARY"),
    createElement(
      View,
      { style: styles.changeHead },
      text(styles.cLabel, ""),
      text(styles.cNum, "ADDITIONS"),
      text(styles.cNum, "DEDUCTIONS"),
    ),
    ...m.changes.rows.map((r, i) =>
      createElement(
        View,
        { key: `c${i}`, style: styles.changeRow },
        text(styles.cLabel, r.label),
        text(styles.cNum, r.additions),
        text(styles.cNum, r.deductions),
      ),
    ),
    createElement(
      View,
      { style: [styles.changeRow, styles.bold] },
      text(styles.cLabel, m.changes.netLabel),
      text(styles.cNum, ""),
      text(styles.cNum, m.changes.net),
    ),
  );

  const certification = text(styles.certification, m.certification, "cert");

  const signatures = createElement(
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
  );

  return createElement(
    Page,
    { size: "LETTER", style: styles.page },
    header,
    facts,
    parties,
    summary,
    changes,
    certification,
    signatures,
    ...fixedParts(m),
  );
}

function continuationPage(m: CertificateModel): ReactElement {
  const blocks: ReactElement[] = [
    text([styles.title, { color: m.titleColor, textAlign: "left" }], m.continuation.title, "ct"),
    text(styles.caption, m.continuation.caption, "cc"),
  ];

  if (m.continuation.rows.length > 0 && m.continuation.total) {
    const k = (r: CertificateModel["continuation"]["rows"][number], key: string, style: PdfStyle) =>
      createElement(
        View,
        { key, style, wrap: false },
        text(styles.kItem, r.item),
        text(styles.kDesc, r.description),
        text(styles.kNum, r.scheduled),
        text(styles.kNum, r.previous),
        text(styles.kNum, r.thisPeriod),
        text(styles.kNum, r.stored),
        text(styles.kNum, r.toDate),
        text(styles.kPct, r.percent),
        text(styles.kNum, r.balance),
      );
    blocks.push(
      createElement(
        View,
        { key: "kh", style: styles.tableHead },
        text(styles.kItem, "NO."),
        text(styles.kDesc, "DESCRIPTION OF WORK"),
        text(styles.kNum, "SCHEDULED"),
        text(styles.kNum, "PREVIOUS"),
        text(styles.kNum, "THIS PERIOD"),
        text(styles.kNum, "STORED"),
        text(styles.kNum, "TO DATE"),
        text(styles.kPct, "%"),
        text(styles.kNum, "BALANCE"),
      ),
      ...m.continuation.rows.map((r, i) => k(r, `k${i}`, styles.row)),
      k(m.continuation.total, "kt", styles.totalRow),
    );
  }

  if (m.costs.rows.length > 0 && m.costs.total) {
    const k = (r: CertificateModel["costs"]["rows"][number], key: string, style: PdfStyle) =>
      createElement(
        View,
        { key, style, wrap: false },
        text(styles.lName, r.label),
        text(styles.lNum, r.ledgerToDate),
        text(styles.lNum, r.previous),
        text(styles.lNum, r.thisPeriod),
        text(styles.lNum, r.toDate),
      );
    blocks.push(
      text(styles.sectionTitle, "COST BY CODE", "ch"),
      createElement(
        View,
        { key: "chh", style: styles.tableHead },
        text(styles.lName, "COST CODE"),
        text(styles.lNum, "BOOKS TO DATE"),
        text(styles.lNum, "PREVIOUS"),
        text(styles.lNum, "THIS PERIOD"),
        text(styles.lNum, "TO DATE"),
      ),
      ...m.costs.rows.map((r, i) => k(r, `c${i}`, styles.row)),
      k(m.costs.total, "ctot", styles.totalRow),
    );
  }

  if (m.labor.rows.length > 0 && m.labor.total) {
    const k = (r: CertificateModel["labor"]["rows"][number], key: string, style: PdfStyle) =>
      createElement(
        View,
        { key, style, wrap: false },
        text(styles.lName, r.name),
        text(styles.lHours, r.rate),
        text(styles.lHours, r.hoursToDate),
        text(styles.lHours, r.previousHours),
        text(styles.lHours, r.thisPeriodHours),
        text(styles.lNum, r.thisPeriod),
        text(styles.lNum, r.toDate),
      );
    blocks.push(
      text(styles.sectionTitle, "HOURS BY PERSON", "lh"),
      createElement(
        View,
        { key: "lhh", style: styles.tableHead },
        text(styles.lName, "PERSON"),
        text(styles.lHours, "RATE"),
        text(styles.lHours, "TO DATE"),
        text(styles.lHours, "PREVIOUS"),
        text(styles.lHours, "THIS PERIOD"),
        text(styles.lNum, "THIS PERIOD"),
        text(styles.lNum, "TO DATE"),
      ),
      ...m.labor.rows.map((r, i) => k(r, `l${i}`, styles.row)),
      k(m.labor.total, "ltot", styles.totalRow),
    );
  }

  if (blocks.length === 2) {
    blocks.push(text(styles.caption, "Nothing on this application yet.", "empty"));
  }
  if (m.notes) {
    blocks.push(
      createElement(
        View,
        { key: "notes", style: styles.notes },
        text(styles.notesLabel, "NOTES"),
        text({}, m.notes),
      ),
    );
  }

  return createElement(
    Page,
    { size: "LETTER", orientation: "landscape", style: styles.page },
    ...blocks,
    ...fixedParts(m),
  );
}

export async function renderCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  ensureNotoSans();
  const m = buildCertificateModel(input);
  return renderToBuffer(
    createElement(
      Document,
      { title: `Application ${input.applicationNumber} · ${input.projectNumber}` },
      certificatePage(m),
      continuationPage(m),
    ),
  );
}
