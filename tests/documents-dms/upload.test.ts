import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  canPreview,
  fileKindLabel,
  parseViewMode,
  resolveViewMode,
} from "@/modules/documents/lib/view-mode";
import { displayNameFromBlobPath } from "@/modules/documents/ingest";
import {
  dispositionFor,
  isAllowedUpload,
  sanitizeFileName,
  MAX_FILE_BYTES,
} from "@/modules/documents/allowlist";
import { dmsPathPrefix, isTenantBlobPath, receiptPathPrefix } from "@/lib/blob";

describe("upload allowlist", () => {
  it("accepts the file types a filing cabinet actually holds", () => {
    expect(isAllowedUpload("application/pdf", 1024)).toBe(true);
    expect(isAllowedUpload("image/jpeg", 1024)).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        1024,
      ),
    ).toBe(true);
    expect(isAllowedUpload("application/zip", 1024)).toBe(true);
  });

  // The stored-XSS types. Refused at upload, not merely served as attachments,
  // so they can never sit in the store waiting to be mis-served later.
  it("refuses types that can execute in our origin", () => {
    expect(isAllowedUpload("text/html", 1024)).toBe(false);
    expect(isAllowedUpload("image/svg+xml", 1024)).toBe(false);
    expect(isAllowedUpload("application/xhtml+xml", 1024)).toBe(false);
    expect(isAllowedUpload("application/x-msdownload", 1024)).toBe(false);
  });

  it("refuses empty and oversized files", () => {
    expect(isAllowedUpload("application/pdf", 0)).toBe(false);
    expect(isAllowedUpload("application/pdf", -1)).toBe(false);
    expect(isAllowedUpload("application/pdf", MAX_FILE_BYTES + 1)).toBe(false);
    expect(isAllowedUpload("application/pdf", Number.NaN)).toBe(false);
  });

  it("only renders inline what cannot execute", () => {
    expect(dispositionFor("application/pdf")).toBe("inline");
    expect(dispositionFor("image/png")).toBe("inline");
    expect(dispositionFor("text/plain")).toBe("inline");
    expect(dispositionFor("application/zip")).toBe("attachment");
    expect(dispositionFor("image/tiff")).toBe("attachment");
    expect(
      dispositionFor(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("attachment");
    // Never uploadable, but the header rule must hold regardless.
    expect(dispositionFor("image/svg+xml")).toBe("attachment");
    expect(dispositionFor("text/html")).toBe("attachment");
  });

  it("strips what must never reach a Content-Disposition header", () => {
    const cr = String.fromCharCode(13);
    const lf = String.fromCharCode(10);
    expect(sanitizeFileName(`plan${cr}${lf}X-Evil: 1.pdf`)).toBe(
      "planX-Evil: 1.pdf",
    );
    expect(sanitizeFileName('say"hello".pdf')).toBe("sayhello.pdf");
    expect(sanitizeFileName("a/b\\c.pdf")).toBe("abc.pdf");
    expect(sanitizeFileName("   ")).toBe("download");
    expect(sanitizeFileName("x".repeat(300)).length).toBeLessThanOrEqual(120);
    // Non-ASCII survives; the route emits an RFC 5987 filename* alongside.
    expect(sanitizeFileName("Núñez.pdf")).toBe("Núñez.pdf");
  });
});

describe("blob client upload flow", () => {
  it("never imports the classic `upload` from @vercel/blob/client", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const source = readFileSync(full, "utf8");
        if (!source.includes("@vercel/blob/client")) continue;
        // Matches `upload,` / `upload }` / `upload as x` in the import clause,
        // while leaving `uploadPresigned` and the multipart helpers alone.
        // No /s flag: `[^}]*` already spans newlines, and the flag needs an
        // es2018 target this tsconfig does not set.
        const importClause = source.match(
          /import\s*\{([^}]*)\}\s*from\s*["']@vercel\/blob\/client["']/,
        );
        if (!importClause) continue;
        const named = importClause[1]
          .split(",")
          .map((s) => s.trim().split(/\s+as\s+/)[0].trim());
        if (named.includes("upload")) offenders.push(full);
      }
    };
    walk("src");

    expect(offenders).toEqual([]);
  });
});

describe("upload display names", () => {
  /**
   * The presigned upload asks the store for a random suffix so two people
   * uploading `invoice.pdf` cannot collide. That suffix belongs in the storage
   * KEY — reading the stored name straight off the pathname put it in front of
   * the user, which is what shipped.
   */
  it("strips the blob store's random suffix", () => {
    expect(
      displayNameFromBlobPath("Invoice 3000 (1)-A76EZtxEuYMtCeXMNHHjKpQr.pdf"),
    ).toBe("Invoice 3000 (1).pdf");
    expect(displayNameFromBlobPath("site-photo-Zk3mPq9WdLbN2xVtRy8s.jpg")).toBe(
      "site-photo.jpg",
    );
  });

  /**
   * The half that matters more: a real filename must survive untouched. These
   * are all names a construction business genuinely has.
   */
  it("leaves ordinary hyphenated names alone", () => {
    for (const name of [
      "as-built.pdf",
      "2026-01-15 site meeting.docx",
      "RFI-004-response.pdf",
      "plan-A.dwg",
      "invoice.pdf",
      "no-extension",
      "Change-Order-12.pdf",
    ]) {
      expect(displayNameFromBlobPath(name)).toBe(name);
    }
  });

  it("never returns an empty name", () => {
    // A pathological upload whose whole stem looks like a suffix keeps the
    // original rather than becoming ".pdf".
    expect(displayNameFromBlobPath("A76EZtxEuYMtCeXMNHHjKpQr.pdf")).toBe(
      "A76EZtxEuYMtCeXMNHHjKpQr.pdf",
    );
  });
});

describe("browse view modes", () => {
  it("falls back to the list layout for anything unrecognised", () => {
    expect(parseViewMode("thumbs")).toBe("thumbs");
    expect(parseViewMode("icons")).toBe("icons");
    expect(parseViewMode("list")).toBe("list");
    // A hand-typed or stale URL must render something, not throw.
    expect(parseViewMode("gallery")).toBe("list");
    expect(parseViewMode(undefined)).toBe("list");
    expect(parseViewMode("")).toBe("list");
  });

  /**
   * Only images preview, and that is a CSP consequence rather than a gap.
   * File responses carry `frame-ancestors 'none'` and a `sandbox` directive,
   * so a PDF cannot be framed on our own pages and the browser's PDF viewer is
   * disabled anyway. An `<img>` is unaffected by both. If someone later adds
   * a type here, they need to have checked it renders WITHOUT relaxing either.
   */
  it("previews images only — never PDFs or Office files", () => {
    expect(canPreview("image/jpeg")).toBe(true);
    expect(canPreview("image/png")).toBe(true);
    expect(canPreview("image/webp")).toBe(true);
    expect(canPreview("image/gif")).toBe(true);

    expect(canPreview("application/pdf")).toBe(false);
    expect(canPreview("text/html")).toBe(false);
    expect(canPreview("image/svg+xml")).toBe(false);
    expect(
      canPreview(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
  });

  /**
   * The URL beats the stored preference, deliberately: a link someone pastes
   * into chat should show what THEY were looking at, not be rewritten by the
   * recipient's habit. Absent an explicit view, the preference carries across
   * folders — which is the only reason it is stored at all.
   */
  it("prefers an explicit ?view= over the remembered choice", () => {
    expect(resolveViewMode("icons", "thumbs")).toBe("icons");
    expect(resolveViewMode("list", "thumbs")).toBe("list");
  });

  it("falls back to the remembered choice, then to list", () => {
    expect(resolveViewMode(undefined, "thumbs")).toBe("thumbs");
    expect(resolveViewMode("", "icons")).toBe("icons");
    expect(resolveViewMode(undefined, undefined)).toBe("list");
    // A junk cookie must not break the page.
    expect(resolveViewMode(undefined, "gallery")).toBe("list");
    expect(resolveViewMode("nonsense", "nonsense")).toBe("list");
  });

  it("labels the file types a construction business actually has", () => {
    expect(fileKindLabel("application/pdf", "a.pdf")).toBe("PDF");
    expect(
      fileKindLabel(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "takeoff.xlsx",
      ),
    ).toBe("Excel");
    expect(
      fileKindLabel(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "contract.docx",
      ),
    ).toBe("Word");
    expect(fileKindLabel("image/jpeg", "site.jpg")).toBe("Image");
    // Unknown type falls back to the extension rather than a useless "File".
    expect(fileKindLabel("application/octet-stream", "plan.dwg")).toBe("DWG");
    expect(fileKindLabel("application/octet-stream", "noextension")).toBe("File");
  });
});

describe("tenant blob namespaces", () => {
  const t = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";

  it("accepts this tenant's own prefixes, across modules", () => {
    expect(isTenantBlobPath(t, `${dmsPathPrefix(t, "files")}a.pdf`)).toBe(true);
    expect(isTenantBlobPath(t, `${dmsPathPrefix(t, "generated")}a.pdf`)).toBe(
      true,
    );
    expect(isTenantBlobPath(t, `${receiptPathPrefix(t)}a.pdf`)).toBe(true);
  });

  it("refuses another tenant's namespace and traversal", () => {
    expect(isTenantBlobPath(t, `${dmsPathPrefix(other, "files")}a.pdf`)).toBe(
      false,
    );
    expect(isTenantBlobPath(t, `docs/${t}/files/../../${other}/files/a.pdf`)).toBe(
      false,
    );
    expect(isTenantBlobPath(t, `/docs/${t}/files/a.pdf`)).toBe(false);
    expect(isTenantBlobPath(t, `docs\\${t}\\files\\a.pdf`)).toBe(false);
    expect(isTenantBlobPath(t, "")).toBe(false);
  });
});
