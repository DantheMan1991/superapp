import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "@/db";
import {
  createFolder,
  setFolderVisibility,
} from "@/modules/documents/folder-ops";
import {
  buildInboundAddress,
  parseTokenForPrefix,
  routeInboundEmail,
} from "@/lib/inbound-address";
import {
  acceptsInboundMail,
  createInboundDocument,
  disableFolderInbound,
  enableFolderInbound,
  folderIngestCount,
  mintFolderToken,
  resolveFolderByToken,
} from "@/modules/documents/inbound";
import { STAMP_OPS, d } from "./_shared";

describe("inbound address routing", () => {
  const domain = "in.example.com";

  it("routes each prefix to its own feature", () => {
    expect(
      routeInboundEmail(["docs-abc123def4567890@in.example.com"], domain),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
    expect(
      routeInboundEmail(["receipts-abc123def456@in.example.com"], domain),
    ).toEqual({ kind: "receipts", token: "abc123def456" });
  });

  // A token is only ever a token for the prefix it was addressed with.
  it("never confuses one prefix for the other", () => {
    expect(
      parseTokenForPrefix(["docs-abc123def456@in.example.com"], domain, "receipts"),
    ).toBeNull();
    expect(
      parseTokenForPrefix(["receipts-abc123def456@in.example.com"], domain, "docs"),
    ).toBeNull();
  });

  /**
   * The production lesson this file exists to preserve: Outlook lowercases
   * forwarded addresses, so matching is case-insensitive and the token comes
   * back lowercase to match how it was stored.
   */
  it("matches case-insensitively and returns a lowercase token", () => {
    expect(
      routeInboundEmail(["DOCS-AbC123dEf4567890@IN.EXAMPLE.COM"], domain),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
  });

  it("reads the address out of a display-name form", () => {
    expect(
      routeInboundEmail(
        ['"Job 42" <docs-abc123def4567890@in.example.com>'],
        domain,
      ),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
  });

  // Envelope recipients are the only place a BCC or a forward shows up.
  it("finds the token among several recipients", () => {
    expect(
      routeInboundEmail(
        [
          "someone@elsewhere.com",
          "another@elsewhere.com",
          "docs-abc123def4567890@in.example.com",
        ],
        domain,
      ),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
  });

  it("ignores addresses on other domains", () => {
    expect(
      routeInboundEmail(["docs-abc123def4567890@evil.example.com"], domain),
    ).toBeNull();
    // A lookalike suffix must not match either.
    expect(
      routeInboundEmail(["docs-abc123def4567890@notin.example.com"], domain),
    ).toBeNull();
  });

  it("ignores malformed and too-short tokens", () => {
    expect(routeInboundEmail(["docs-short@in.example.com"], domain)).toBeNull();
    expect(routeInboundEmail(["docs-@in.example.com"], domain)).toBeNull();
    expect(routeInboundEmail(["docs@in.example.com"], domain)).toBeNull();
    expect(routeInboundEmail([], domain)).toBeNull();
    // No domain configured means nothing can ever match.
    expect(routeInboundEmail(["docs-abc123def4567890@in.example.com"], "")).toBeNull();
  });

  it("builds the address it will later parse", () => {
    const address = buildInboundAddress("docs", "ABC123DEF4567890", domain);
    expect(address).toBe("docs-abc123def4567890@in.example.com");
    expect(routeInboundEmail([address], domain)).toEqual({
      kind: "docs",
      token: "abc123def4567890",
    });
  });
});

describe("folder inbound tokens", () => {
  it("mints lowercase hex that satisfies the CHECK constraint", () => {
    for (let i = 0; i < 20; i += 1) {
      const token = mintFolderToken();
      expect(token).toMatch(/^[a-z0-9]{16,}$/);
    }
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintFolderToken()));
    expect(seen.size).toBe(200);
  });
});

d("folder inbound delivery (database)", () => {
  let tenantId: string;
  let openFolderId: string;
  let openToken: string;
  const ctx = { tenantId: "", userId: "user-inbound", role: "owner" as const };

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP_OPS}-inbound`,
          name: "Inbound Co",
          slug: `${STAMP_OPS}-inbound`,
        })
        .returning();
      return row.id;
    });
    ctx.tenantId = tenantId;

    const folder = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Job 42",
        visibility: "members",
      }),
    );
    openFolderId = folder.id;
    openToken = await asOwner((tx) =>
      enableFolderInbound(tx, tenantId, openFolderId),
    );
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("resolves a token back to its folder", async () => {
    const found = await withSystem((tx) => resolveFolderByToken(tx, openToken));
    expect(found?.id).toBe(openFolderId);
    // And an unknown token resolves to nothing rather than throwing.
    expect(
      await withSystem((tx) => resolveFolderByToken(tx, "deadbeefdeadbeef")),
    ).toBeNull();
  });

  it("is case-insensitive on lookup, because email addresses are", async () => {
    const found = await withSystem((tx) =>
      resolveFolderByToken(tx, openToken.toUpperCase()),
    );
    expect(found?.id).toBe(openFolderId);
  });

  it("files an emailed attachment straight into the folder", async () => {
    const folder = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    const created = await asOwner((tx) =>
      createInboundDocument(tx, tenantId, folder!, {
        blobPathname: `docs/${tenantId}/files/drawing.pdf`,
        fileName: "drawing.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        sha256: "abc",
        emailFrom: "sub@example.com",
        emailSubject: "Revised drawings",
        emailMessageId: `msg-${STAMP_OPS}-1`,
        emailReceivedAt: new Date(),
      }),
    );
    expect(created).not.toBeNull();

    const doc = await asOwner((tx) =>
      tx.query.documents.findFirst({
        where: eq(schema.documents.id, created!.documentId),
      }),
    );
    // Filed on arrival — the whole point. Not sitting in an inbox.
    expect(doc?.folderId).toBe(openFolderId);
    expect(doc?.filedAt).not.toBeNull();
    expect(doc?.source).toBe("email");
    expect(doc?.origin).toBe("dms");
    expect(doc?.uploadedByClerkUserId).toBeNull();
  });

  it("refuses a file type the allowlist rejects", async () => {
    const folder = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    const created = await asOwner((tx) =>
      createInboundDocument(tx, tenantId, folder!, {
        blobPathname: `docs/${tenantId}/files/evil.html`,
        fileName: "evil.html",
        mimeType: "text/html",
        sizeBytes: 100,
        sha256: "x",
        emailFrom: "attacker@example.com",
        emailSubject: "hi",
        emailMessageId: `msg-${STAMP_OPS}-evil`,
        emailReceivedAt: new Date(),
      }),
    );
    expect(created).toBeNull();
  });

  it("counts only this folder's emailed files toward its cap", async () => {
    const n = await asOwner((tx) =>
      folderIngestCount(tx, tenantId, openFolderId),
    );
    expect(n).toBeGreaterThanOrEqual(1);
  });

  /**
   * The address was handed to an outsider while the folder was open. If an
   * owner later closes it, delivery must stop — otherwise a third party keeps
   * writing into somewhere the business deliberately shut.
   */
  it("stops accepting mail once the folder becomes owners-only", async () => {
    const before = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    expect(acceptsInboundMail(before!)).toBe(true);

    await asOwner((tx) =>
      setFolderVisibility(tx, ctx, {
        folderId: openFolderId,
        visibility: "owners",
        expectedVersion: before!.version,
      }),
    );

    const after = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    expect(after!.effectiveVisibility).toBe("owners");
    // Token still present, but delivery is refused.
    expect(after!.inboundToken).not.toBeNull();
    expect(acceptsInboundMail(after!)).toBe(false);
  });

  it("refuses to create an address on an owners-only folder", async () => {
    const locked = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Payroll Inbound",
        visibility: "owners",
      }),
    );
    await expect(
      asOwner((tx) => enableFolderInbound(tx, tenantId, locked.id)),
    ).rejects.toMatchObject({ code: "SHARE_ROOT_RESTRICTED" });
  });

  it("turning the address off frees the token and stops delivery", async () => {
    const folder = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Temp Inbound",
        visibility: "members",
      }),
    );
    const token = await asOwner((tx) =>
      enableFolderInbound(tx, tenantId, folder.id),
    );
    expect(await withSystem((tx) => resolveFolderByToken(tx, token))).not.toBeNull();

    await asOwner((tx) => disableFolderInbound(tx, tenantId, folder.id));
    expect(await withSystem((tx) => resolveFolderByToken(tx, token))).toBeNull();
  });

  it("two folders cannot share an address", async () => {
    const a = await asOwner((tx) =>
      createFolder(tx, ctx, { parentId: null, name: "Dup A", visibility: "members" }),
    );
    const token = await asOwner((tx) => enableFolderInbound(tx, tenantId, a.id));
    const b = await asOwner((tx) =>
      createFolder(tx, ctx, { parentId: null, name: "Dup B", visibility: "members" }),
    );
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.documentFolders)
          .set({ inboundToken: token })
          .where(eq(schema.documentFolders.id, b.id)),
      ),
    ).rejects.toThrow();
  });
});
