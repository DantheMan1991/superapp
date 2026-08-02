import "server-only";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { fromMarkdown } from "mdast-util-from-markdown";
import { injectValues, type MdNode } from "./merge";

/**
 * Markdown → PDF.
 *
 * `@react-pdf/renderer` rather than headless Chromium: Chromium is ~50MB+
 * against Vercel's 250MB limit on top of `sharp`, and this whole module is
 * 3MB. `pdf-lib` is the other half of the plan and MODIFIES existing PDFs
 * (stamping, merging); this file only ever creates new ones.
 *
 * The merge happens on the PARSED TREE before any of this runs — see merge.ts.
 * Nothing here ever concatenates a value into markup.
 */

/**
 * Noto Sans, read off disk and registered as a buffer.
 *
 * PDF's built-in Helvetica is WinAnsi (cp1252) only. That covers `ñ` but
 * silently mangles `Nguyễn`, `Łukasz`, `Öztürk` — ordinary names on an ordinary
 * crew list, and a lien waiver that misspells the payee is a defective
 * document. Registered from a Buffer rather than a URL so generation never
 * makes a network call, and `next.config.ts` traces the directory into the
 * serverless bundle.
 *
 * Module-level and idempotent: react-pdf keeps a global font registry, so
 * registering once per process is both necessary and sufficient.
 */
let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  // Absolute paths off process.cwd(), matching src/lib/build-docs.ts, which
  // already reads repo files at request time on this deployment.
  const dir = path.join(
    process.cwd(),
    "src",
    "modules",
    "documents",
    "doc-templates",
    "fonts",
  );
  // All FOUR faces. react-pdf does not synthesize: it throws "Could not
  // resolve font for NotoSans, fontStyle italic" at render time if a face is
  // missing, so an unregistered combination is a failed document rather than a
  // slightly wrong one. `***both***` is reachable from ordinary Markdown, so
  // bold-italic is registered too.
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(dir, "NotoSans-Regular.ttf") },
      { src: path.join(dir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
      { src: path.join(dir, "NotoSans-Italic.ttf"), fontStyle: "italic" },
      {
        src: path.join(dir, "NotoSans-BoldItalic.ttf"),
        fontWeight: "bold",
        fontStyle: "italic",
      },
    ],
  });
  // Without this, long unbroken strings (a URL, a 40-character part number)
  // overflow the page instead of wrapping.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 11,
    lineHeight: 1.5,
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 56,
    color: "#111827",
  },
  h1: { fontSize: 20, fontWeight: "bold", marginBottom: 10, marginTop: 4 },
  h2: { fontSize: 15, fontWeight: "bold", marginBottom: 8, marginTop: 12 },
  h3: { fontSize: 12.5, fontWeight: "bold", marginBottom: 6, marginTop: 10 },
  paragraph: { marginBottom: 9 },
  listItem: { flexDirection: "row", marginBottom: 4 },
  bullet: { width: 16 },
  listBody: { flex: 1 },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: "#d1d5db",
    paddingLeft: 10,
    marginBottom: 9,
    color: "#374151",
  },
  code: {
    fontSize: 9.5,
    backgroundColor: "#f3f4f6",
    padding: 8,
    marginBottom: 9,
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    marginVertical: 12,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#6b7280",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

/** Inline nodes → Text elements, carrying bold/italic down the tree. */
function renderInline(
  nodes: readonly MdNode[],
  keyPrefix: string,
  inherited: { bold?: boolean; italic?: boolean } = {},
): ReactElement[] {
  const out: ReactElement[] = [];
  nodes.forEach((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
      case "inlineCode":
        out.push(
          createElement(
            Text,
            {
              key,
              style: {
                fontWeight: inherited.bold ? "bold" : "normal",
                fontStyle: inherited.italic ? "italic" : "normal",
              },
            },
            node.value ?? "",
          ),
        );
        break;
      case "strong":
        out.push(
          ...renderInline(node.children ?? [], key, { ...inherited, bold: true }),
        );
        break;
      case "emphasis":
        out.push(
          ...renderInline(node.children ?? [], key, {
            ...inherited,
            italic: true,
          }),
        );
        break;
      case "break":
        out.push(createElement(Text, { key }, "\n"));
        break;
      case "link":
        // Rendered as its text, not as a clickable link. A printed waiver is
        // the artifact that matters, and a blue underline on paper is noise.
        out.push(...renderInline(node.children ?? [], key, inherited));
        break;
      default:
        if (node.children) {
          out.push(...renderInline(node.children, key, inherited));
        } else if (typeof node.value === "string") {
          out.push(createElement(Text, { key }, node.value));
        }
    }
  });
  return out;
}

const HEADING_STYLE = [styles.h1, styles.h2, styles.h3] as const;

/** Block nodes → View/Text elements. */
function renderBlocks(
  nodes: readonly MdNode[],
  keyPrefix: string,
): ReactElement[] {
  const out: ReactElement[] = [];
  nodes.forEach((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "heading": {
        const depth = Math.min(Number(node.depth ?? 1), 3) - 1;
        out.push(
          createElement(
            Text,
            { key, style: HEADING_STYLE[depth] ?? styles.h3 },
            renderInline(node.children ?? [], key),
          ),
        );
        break;
      }
      case "paragraph":
        out.push(
          createElement(
            Text,
            { key, style: styles.paragraph },
            renderInline(node.children ?? [], key),
          ),
        );
        break;
      case "list": {
        const ordered = node.ordered === true;
        const start = Number(node.start ?? 1);
        out.push(
          createElement(
            View,
            { key },
            (node.children ?? []).map((item, j) =>
              createElement(
                View,
                { key: `${key}-i${j}`, style: styles.listItem },
                createElement(
                  Text,
                  { style: styles.bullet },
                  ordered ? `${start + j}.` : "•",
                ),
                createElement(
                  View,
                  { style: styles.listBody },
                  renderBlocks(item.children ?? [], `${key}-i${j}`),
                ),
              ),
            ),
          ),
        );
        break;
      }
      case "blockquote":
        out.push(
          createElement(
            View,
            { key, style: styles.blockquote },
            renderBlocks(node.children ?? [], key),
          ),
        );
        break;
      case "code":
        out.push(
          createElement(Text, { key, style: styles.code }, node.value ?? ""),
        );
        break;
      case "thematicBreak":
        out.push(createElement(View, { key, style: styles.rule }));
        break;
      default:
        if (node.children) out.push(...renderBlocks(node.children, key));
    }
  });
  return out;
}

export interface RenderInput {
  /** The template body, placeholders intact. */
  body: string;
  /** Merge values. Injected into the tree, never into the source. */
  values: Readonly<Record<string, string>>;
  /** Shown in the footer, so a printed page can be traced back. */
  footerLeft?: string;
  footerRight?: string;
}

/**
 * Parse, merge, render.
 *
 * The order is the security property: the body is parsed FIRST, so the
 * template author's markup is the only thing that can create structure, and
 * merge values land as text nodes in the tree that results.
 */
export async function renderTemplatePdf(input: RenderInput): Promise<Uint8Array> {
  ensureFonts();

  const tree = fromMarkdown(input.body) as unknown as MdNode;
  injectValues(tree, input.values);

  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "LETTER", style: styles.page },
      ...renderBlocks(tree.children ?? [], "b"),
      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(Text, null, input.footerLeft ?? ""),
        createElement(Text, {
          render: ({ pageNumber, totalPages }: {
            pageNumber: number;
            totalPages: number;
          }) => `${input.footerRight ?? ""}  ${pageNumber}/${totalPages}`,
        }),
      ),
    ),
  );

  const buffer = await renderToBuffer(doc as never);
  return new Uint8Array(buffer);
}
