import "server-only";
import { createElement, type ReactElement } from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { ensureNotoSans } from "@/lib/pdf/fonts";
import { buildInvoicePdfModel, type InvoicePdfInput } from "./invoice-pdf-model";

/**
 * The invoice as a PDF. Layout only — every number and every decision about
 * what appears arrives already made from `invoice-pdf-model.ts`.
 *
 * `@react-pdf/renderer` for the same reason Documents uses it: headless
 * Chromium is ~50MB+ against Vercel's 250MB limit on top of `sharp`.
 * `createElement` rather than JSX so this file needs no JSX transform
 * considerations in a module otherwise full of plain .ts.
 */

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 10,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    color: "#111827",
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  business: { fontSize: 15, fontWeight: "bold" },
  title: { fontSize: 22, fontWeight: "bold", textAlign: "right" },
  meta: { marginTop: 4, textAlign: "right", color: "#4b5563" },
  parties: { flexDirection: "row", marginBottom: 24 },
  billToLabel: {
    fontSize: 8,
    letterSpacing: 1,
    color: "#6b7280",
    marginBottom: 4,
  },
  billToLine: { marginBottom: 1 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingBottom: 5,
    marginBottom: 2,
    fontSize: 8,
    letterSpacing: 1,
    color: "#6b7280",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 56, textAlign: "right" },
  cRate: { width: 80, textAlign: "right" },
  cAmount: { width: 90, textAlign: "right" },
  totals: { marginTop: 14, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 7,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    fontSize: 12,
    fontWeight: "bold",
  },
  memoLabel: { fontSize: 8, letterSpacing: 1, color: "#6b7280", marginBottom: 3 },
  memo: { marginTop: 26, color: "#374151" },
  watermark: {
    position: "absolute",
    top: 300,
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
    bottom: 28,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#9ca3af",
  },
});

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  ensureNotoSans();
  const m = buildInvoicePdfModel(input);

  const head = createElement(
    View,
    { style: styles.tableHead },
    createElement(Text, { style: styles.cDesc }, "DESCRIPTION"),
    createElement(Text, { style: styles.cQty }, "QTY"),
    createElement(Text, { style: styles.cRate }, "RATE"),
    createElement(Text, { style: styles.cAmount }, "AMOUNT"),
  );

  const rows = m.rows.map((r, i) =>
    createElement(
      View,
      { key: `r${i}`, style: styles.row, wrap: false },
      createElement(Text, { style: styles.cDesc }, r.description),
      createElement(Text, { style: styles.cQty }, r.quantity),
      createElement(Text, { style: styles.cRate }, r.unitPrice),
      createElement(Text, { style: styles.cAmount }, r.amount),
    ),
  );

  const totalRows = [
    createElement(
      View,
      { key: "t", style: styles.totalRow },
      createElement(Text, null, "Total"),
      createElement(Text, null, m.total),
    ),
  ];
  if (m.showPayments) {
    totalRows.push(
      createElement(
        View,
        { key: "p", style: styles.totalRow },
        createElement(Text, null, "Paid"),
        createElement(Text, null, `-${m.paid}`),
      ),
    );
  }
  totalRows.push(
    createElement(
      View,
      { key: "b", style: styles.balanceRow },
      createElement(Text, null, "Balance due"),
      createElement(Text, null, m.balance),
    ),
  );

  // Explicitly typed: inferred from its first element the array would be
  // View-only, and the watermark and footer below are Text.
  const body: ReactElement[] = [
    createElement(
      View,
      { key: "head", style: styles.header },
      createElement(View, null, createElement(Text, { style: styles.business }, m.businessName)),
      createElement(
        View,
        null,
        createElement(Text, { style: styles.title }, m.title),
        createElement(Text, { style: styles.meta }, `No. ${m.invoiceNumber}`),
        createElement(Text, { style: styles.meta }, `Issued ${m.issueDate}`),
        ...(m.dueDate
          ? [createElement(Text, { style: styles.meta }, `Due ${m.dueDate}`)]
          : []),
      ),
    ),
    createElement(
      View,
      { key: "parties", style: styles.parties },
      createElement(
        View,
        null,
        createElement(Text, { style: styles.billToLabel }, "BILL TO"),
        ...m.billTo.map((l, i) =>
          createElement(Text, { key: `b${i}`, style: styles.billToLine }, l),
        ),
      ),
    ),
    head,
    ...rows,
    createElement(
      View,
      { key: "totals", style: styles.totals },
      createElement(View, { style: styles.totalsBox }, ...totalRows),
    ),
  ];

  if (m.memo) {
    body.push(
      createElement(
        View,
        { key: "memo", style: styles.memo },
        createElement(Text, { style: styles.memoLabel }, "NOTES"),
        createElement(Text, null, m.memo),
      ),
    );
  }
  if (m.watermark) {
    body.push(
      createElement(Text, { key: "wm", style: styles.watermark, fixed: true }, m.watermark),
    );
  }
  body.push(
    createElement(
      View,
      { key: "footer", style: styles.footer, fixed: true },
      createElement(Text, null, `${m.businessName} · ${m.invoiceNumber}`),
      createElement(Text, {
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `Page ${pageNumber} of ${totalPages}`,
      }),
    ),
  );

  return renderToBuffer(
    createElement(
      Document,
      { title: `Invoice ${m.invoiceNumber}` },
      createElement(Page, { size: "LETTER", style: styles.page }, ...body),
    ),
  );
}
