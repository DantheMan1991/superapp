import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { logAuditInTx } from "../src/lib/audit";
import { postEntry, type LedgerCtx } from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  buildBooksCsvFiles,
  buildManifestCsv,
  buildReadme,
  documentZipEntryName,
  sanitizeZipFileName,
  type BooksData,
} from "../src/modules/accounting/export/export-csv";
import { trialBalanceToCsvRows } from "../src/modules/accounting/lib/csv";
import { createBooksZipStream } from "../src/modules/accounting/export/zip-stream";
import { gatherBooksExport } from "../src/modules/accounting/export/books-export";

/**
 * Session 7: full-books export. Pure CSV/zip tests always run; the gather
 * tests need DATABASE_URL.
 */

// ------------------------------------------------------------------ pure

function minimalBooksData(): BooksData {
  const settings = {
    id: "s1",
    tenantId: "t1",
    closedThrough: "2026-06-30",
    coaTemplate: "general",
    fiscalYearStartMonth: 1,
    entryEditPolicy: "standard",
    bookkeepingTimezone: "America/New_York",
    aiLastSuggestedAt: null,
    inboundEmailToken: "SECRET-TOKEN-MUST-NOT-LEAK",
    aiLastExtractedAt: null,
    aiLastBillCodedAt: null,
    aiLastNarrativeAt: null,
    booksExportLastAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as BooksData["settings"];
  return {
    accounts: [
      {
        id: "a1", tenantId: "t1", code: "1000", name: 'Checking, "Main"',
        accountType: "asset", subtype: "bank", parentId: null, description: "",
        isActive: true, isSystem: false, version: 1,
        createdAt: new Date(), updatedAt: new Date(),
      } as BooksData["accounts"][number],
    ],
    journalEntries: [],
    journalLines: [],
    dimensionMembers: [],
    lineDimensions: [],
    settings,
    periodCloses: [],
    closeNotes: [],
    auditLog: [],
    customers: [],
    invoices: [],
    invoiceLines: [],
    invoicePayments: [],
    recurringInvoices: [],
    vendors: [],
    bills: [],
    billLines: [],
    billPayments: [],
    bankAccounts: [],
    bankTransactions: [],
    reconciliations: [],
    reconciliationLines: [],
    documents: [],
    documentLinks: [],
  };
}

describe("books export CSV builders (pure)", () => {
  it("sanitizeZipFileName strips reserved characters and caps length", () => {
    expect(sanitizeZipFileName('inv: "Q1/Q2" <final>?.pdf')).toBe(
      "inv_ _Q1_Q2_ _final__.pdf",
    );
    expect(sanitizeZipFileName("")).toBe("file");
    expect(sanitizeZipFileName("x".repeat(300))).toHaveLength(120);
  });

  it("documentZipEntryName is stable and prefixed", () => {
    expect(
      documentZipEntryName("abcdef12-3456-7890-abcd-ef1234567890", "receipt.pdf"),
    ).toBe("documents/files/abcdef12_receipt.pdf");
  });

  it("settings.csv carries exactly the five policy fields — never the email token or cooldowns", () => {
    const files = buildBooksCsvFiles(minimalBooksData());
    const settingsFile = files.find((f) => f.zipPath === "ledger/settings.csv")!;
    expect(settingsFile.content).toContain("closed_through");
    expect(settingsFile.content).toContain("bookkeeping_timezone");
    expect(settingsFile.content).not.toContain("SECRET-TOKEN-MUST-NOT-LEAK");
    expect(settingsFile.content).not.toContain("token");
    expect(settingsFile.content).not.toContain("ai_last");
    expect(settingsFile.content).not.toContain("export_last");
  });

  it("no plaid file exists and no file mentions plaid columns", () => {
    const files = buildBooksCsvFiles(minimalBooksData());
    expect(files.some((f) => f.zipPath.includes("plaid"))).toBe(false);
    for (const f of files) {
      expect(f.content).not.toContain("access_token");
      expect(f.content).not.toContain("plaid_item");
    }
  });

  it("RFC-4180 escaping flows through the mappers", () => {
    const files = buildBooksCsvFiles(minimalBooksData());
    const accounts = files.find((f) => f.zipPath === "ledger/accounts.csv")!;
    // The quoted name with comma + quotes must round-trip per RFC 4180.
    expect(accounts.content).toContain('"Checking, ""Main"""');
  });

  it("manifest lists every csv and document; README reflects the file toggle", () => {
    const files = buildBooksCsvFiles(minimalBooksData());
    const manifest = buildManifestCsv(files, [
      { zipPath: "documents/files/x_y.pdf", sizeBytes: 123 },
    ]);
    expect(manifest).toContain("ledger/accounts.csv");
    expect(manifest).toContain("documents/files/x_y.pdf");
    expect(manifest).toContain("123 bytes");

    const withFiles = buildReadme({
      tenantName: "Acme",
      exportedAtIso: "2026-07-23T00:00:00Z",
      includesFiles: true,
      reportNote: "Fiscal year starts month 1.",
    });
    expect(withFiles).toContain("documents/files/");
    const withoutFiles = buildReadme({
      tenantName: "Acme",
      exportedAtIso: "2026-07-23T00:00:00Z",
      includesFiles: false,
      reportNote: "Fiscal year starts month 1.",
    });
    expect(withoutFiles).toContain("were not included");
  });

  it("trialBalanceToCsvRows renders codes, sides and totals", () => {
    const rows = trialBalanceToCsvRows(
      {
        rows: [
          {
            account: { code: "1000", name: "Checking", accountType: "asset" } as never,
            debitCents: 123456,
            creditCents: 0,
            netCents: 123456,
          },
        ],
        totalDebitCents: 123456,
        totalCreditCents: 123456,
        totalNetCents: 0,
      },
      "2026-07-23",
    );
    expect(rows[1]).toEqual(["1000", "Checking", "asset", "1234.56", ""]);
    expect(rows[2][3]).toBe("1234.56");
  });
});

// -------------------------------------------------------------- zip smoke

async function collectStream(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(s).arrayBuffer());
}

describe("books zip stream (pure, injected blobs)", () => {
  it("produces a well-formed zip with all entries; missing blobs become markers", async () => {
    const blobBytes = Buffer.from("PDFDATA".repeat(100));
    const stream = createBooksZipStream(
      {
        readme: "README CONTENT",
        manifestCsv: "path,description\r\n",
        csvFiles: [{ zipPath: "ledger/accounts.csv", content: "a,b\r\n1,2\r\n" }],
        docs: [
          { zipPath: "documents/files/aa_ok.pdf", blobPathname: "ok" },
          { zipPath: "documents/files/bb_gone.pdf", blobPathname: "gone" },
        ],
      },
      async (pathname) =>
        pathname === "ok" ? new Blob([blobBytes]).stream() : null,
    );
    const zip = await collectStream(stream);

    // Local file header magic + end-of-central-directory present.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from("PK\x03\x04", "latin1"));
    expect(zip.includes(Buffer.from("PK\x05\x06", "latin1"))).toBe(true);
    // All entry names present in the central directory.
    const text = zip.toString("latin1");
    expect(text).toContain("README.txt");
    expect(text).toContain("manifest.csv");
    expect(text).toContain("ledger/accounts.csv");
    expect(text).toContain("documents/files/aa_ok.pdf");
    expect(text).toContain("documents/files/bb_gone.pdf.MISSING.txt");
  });
});

// ------------------------------------------------------------------ DB

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP = `export-test-${process.pid}`;
let tenantA: string;
let tenantB: string;

async function seedTenant(name: string, slug: string): Promise<string> {
  const id = await withSystem(async (tx) => {
    const rows = await tx
      .insert(schema.tenants)
      .values([{ clerkOrgId: slug, name, slug }])
      .returning();
    return rows[0].id;
  });
  await withTenant(id, async (tx) => {
    await provisionAccounting(tx, id);
    const cash = await tx.query.accounts.findFirst({
      where: and(eq(schema.accounts.tenantId, id), eq(schema.accounts.code, "1000")),
    });
    const sales = await tx.query.accounts.findFirst({
      where: and(eq(schema.accounts.tenantId, id), eq(schema.accounts.code, "4000")),
    });
    const owner: LedgerCtx = { tenantId: id, userId: `${slug}-owner`, role: "owner" };
    await postEntry(tx, owner, {
      entryDate: "2026-07-01",
      memo: `secret memo of ${name}`,
      status: "posted",
      lines: [
        { accountId: cash!.id, amountCents: 12345 },
        { accountId: sales!.id, amountCents: -12345 },
      ],
    });
    await logAuditInTx(tx, {
      action: "test.audit_marker",
      tenantId: id,
      actorClerkUserId: `${slug}-owner`,
      meta: { marker: slug },
    });
  });
  return id;
}

d("full-books export gather (DB)", () => {
  beforeAll(async () => {
    tenantA = await seedTenant("Export A", `${STAMP}-a`);
    tenantB = await seedTenant("Export B", `${STAMP}-b`);
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("returns only the tenant's own rows; audit_log is readable under withTenant", async () => {
    const owner: LedgerCtx = {
      tenantId: tenantA,
      userId: `${STAMP}-a-owner`,
      role: "owner",
    };
    const gathered = await withTenant(tenantA, (tx) =>
      gatherBooksExport(tx, owner, {
        includeFiles: true,
        todayIso: "2026-07-23",
        tenantName: "Export A",
      }),
    );
    const entries = gathered.csvFiles.find(
      (f) => f.zipPath === "ledger/journal_entries.csv",
    )!;
    expect(entries.content).toContain("secret memo of Export A");
    expect(entries.content).not.toContain("secret memo of Export B");

    // Pins the RLS fact the design depends on: members can read their
    // own tenant's audit trail.
    const audit = gathered.csvFiles.find(
      (f) => f.zipPath === "ledger/audit_log.csv",
    )!;
    expect(audit.rowCount).toBeGreaterThan(0);
    expect(audit.content).toContain("test.audit_marker");
    expect(audit.content).not.toContain(`${STAMP}-b`);

    // Reports are included.
    expect(
      gathered.csvFiles.some((f) => f.zipPath.startsWith("reports/trial-balance")),
    ).toBe(true);
    // books.exported audit row committed with the gather.
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.tenantId, tenantA),
            eq(schema.auditLog.action, "books.exported"),
          ),
        ),
    );
    expect(rows.length).toBe(1);
    expect(
      (rows[0].meta as { documents: number; tables: number }).tables,
    ).toBeGreaterThan(20);
  });

  it("cooldown blocks an immediate second export", async () => {
    const owner: LedgerCtx = {
      tenantId: tenantA,
      userId: `${STAMP}-a-owner`,
      role: "owner",
    };
    await expect(
      withTenant(tenantA, (tx) =>
        gatherBooksExport(tx, owner, {
          includeFiles: false,
          todayIso: "2026-07-23",
          tenantName: "Export A",
        }),
      ),
    ).rejects.toMatchObject({ code: "EXPORT_COOLDOWN" });
  });

  it("staff refused, expert allowed", async () => {
    const staff: LedgerCtx = {
      tenantId: tenantB,
      userId: `${STAMP}-b-staff`,
      role: "staff",
    };
    await expect(
      withTenant(tenantB, (tx) =>
        gatherBooksExport(tx, staff, {
          includeFiles: false,
          todayIso: "2026-07-23",
          tenantName: "Export B",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const expert: LedgerCtx = {
      tenantId: tenantB,
      userId: `${STAMP}-b-expert`,
      role: "expert",
    };
    const gathered = await withTenant(tenantB, (tx) =>
      gatherBooksExport(tx, expert, {
        includeFiles: false,
        todayIso: "2026-07-23",
        tenantName: "Export B",
      }),
    );
    expect(gathered.docs).toHaveLength(0);
    expect(gathered.csvFiles.length).toBeGreaterThan(20);
  });
});
