import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "@/db";
import {
  isDeniedKind,
  loadShareActivity,
  visitorLabel,
} from "@/modules/documents/shares/activity";
import { decryptSecret } from "@/lib/crypto";
import {
  hashIp,
  hashPasscode,
  hashToken,
  looksLikeToken,
  mintToken,
  signSession,
  verifyPasscode,
  verifySession,
} from "@/lib/public-token";
import {
  MAX_FAILED_UNLOCKS,
  resolveShareStatus,
} from "@/modules/documents/shares/status";
import {
  isWithinScope,
  visibleSubfolders,
} from "@/modules/documents/shares/scope";
import {
  createShare,
  loadShare,
  revokeShare,
} from "@/modules/documents/shares/shares";
import {
  countFailedUnlock,
  countShareView,
} from "@/modules/documents/shares/resolve";
import {
  loadSharedContents,
  resolveSharedFile,
} from "@/modules/documents/shares/contents";
import { STAMP_OPS, d } from "./_shared";

const STAMP_ACT = `dms-act-${process.pid}`;

describe("share tokens", () => {
  it("mints 256 bits of base64url and accepts its own shape", () => {
    const token = mintToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(looksLikeToken(token)).toBe(true);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintToken()));
    expect(seen.size).toBe(200);
  });

  it("rejects shapes that cannot be tokens before hitting the database", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("short")).toBe(false);
    expect(looksLikeToken("a".repeat(200))).toBe(false);
    expect(looksLikeToken("has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(looksLikeToken("../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("hashes deterministically and does not store the token", () => {
    const token = mintToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(hashToken(mintToken())).not.toBe(hash);
  });

  it("hashes IPs rather than storing them", () => {
    const hashed = hashIp("203.0.113.7");
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toContain("203.0.113");
    expect(hashed).toBe(hashIp("203.0.113.7"));
    expect(hashed).not.toBe(hashIp("203.0.113.8"));
  });
});

describe("share passcodes", () => {
  it("round-trips and rejects the wrong passcode", () => {
    const stored = hashPasscode("open-sesame");
    expect(verifyPasscode("open-sesame", stored)).toBe(true);
    expect(verifyPasscode("Open-Sesame", stored)).toBe(false);
    expect(verifyPasscode("", stored)).toBe(false);
  });

  it("salts, so the same passcode stores differently every time", () => {
    expect(hashPasscode("same")).not.toBe(hashPasscode("same"));
  });

  it("never throws on a malformed stored value", () => {
    expect(verifyPasscode("x", "")).toBe(false);
    expect(verifyPasscode("x", "garbage")).toBe(false);
    expect(verifyPasscode("x", "not.base64.at.all")).toBe(false);
  });
});

describe("unlock sessions", () => {
  it("accepts only its own signature, share and lifetime", () => {
    const value = signSession({ shareId: "share-1", exp: Date.now() + 60_000 });
    expect(verifySession(value, "share-1")).toBe(true);
    // Bound to one share, so a cookie cannot be replayed onto another link.
    expect(verifySession(value, "share-2")).toBe(false);
    expect(verifySession(value, "share-1", Date.now() + 120_000)).toBe(false);
    expect(verifySession(undefined, "share-1")).toBe(false);
    expect(verifySession("garbage", "share-1")).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const value = signSession({ shareId: "share-1", exp: Date.now() + 60_000 });
    const [payload, mac] = value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ shareId: "share-9", exp: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    expect(verifySession(`${forged}.${mac}`, "share-9")).toBe(false);
    expect(verifySession(`${payload}.deadbeef`, "share-1")).toBe(false);
  });
});

describe("resolveShareStatus", () => {
  const base = {
    revokedAt: null,
    expiresAt: new Date("2026-08-01T00:00:00Z"),
    maxUses: null,
    useCount: 0,
    failedUnlockCount: 0,
    createdRootVisibility: "members",
    currentRootVisibility: "members" as const,
  };
  const now = new Date("2026-07-25T00:00:00Z");

  it("is active in the ordinary case", () => {
    expect(resolveShareStatus(base, now)).toBe("active");
  });

  it("reports revoked ahead of everything else", () => {
    expect(
      resolveShareStatus(
        { ...base, revokedAt: new Date("2026-07-20T00:00:00Z"), expiresAt: new Date("2026-07-01T00:00:00Z") },
        now,
      ),
    ).toBe("revoked");
  });

  it("expires on the boundary, not after it", () => {
    expect(resolveShareStatus({ ...base, expiresAt: now }, now)).toBe("expired");
    expect(
      resolveShareStatus(
        { ...base, expiresAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe("active");
  });

  it("exhausts at the limit", () => {
    expect(resolveShareStatus({ ...base, maxUses: 3, useCount: 2 }, now)).toBe("active");
    expect(resolveShareStatus({ ...base, maxUses: 3, useCount: 3 }, now)).toBe("exhausted");
  });

  it("locks after too many wrong passcodes", () => {
    expect(
      resolveShareStatus({ ...base, failedUnlockCount: MAX_FAILED_UNLOCKS - 1 }, now),
    ).toBe("active");
    expect(
      resolveShareStatus({ ...base, failedUnlockCount: MAX_FAILED_UNLOCKS }, now),
    ).toBe("locked");
  });

  // The reason created_root_visibility is stored at all.
  it("suspends when the root became owners-only after the link went out", () => {
    expect(
      resolveShareStatus({ ...base, currentRootVisibility: "owners" }, now),
    ).toBe("suspended");
  });

  it("treats a deleted or hidden root as revoked", () => {
    expect(
      resolveShareStatus({ ...base, currentRootVisibility: null }, now),
    ).toBe("revoked");
  });
});

describe("share scope", () => {
  const rootPath = "/aaaa/";
  const membersRoot = {
    kind: "folder" as const,
    path: rootPath,
    visibility: "members" as const,
  };

  const doc = (folderPath: string | null, visibility: "members" | "owners") => ({
    documentId: "d1",
    folderId: "f1",
    visibility,
    folderPath,
  });

  it("includes documents beneath the root", () => {
    expect(isWithinScope(membersRoot, null, doc("/aaaa/", "members"))).toBe(true);
    expect(isWithinScope(membersRoot, null, doc("/aaaa/bbbb/", "members"))).toBe(true);
  });

  it("excludes documents outside it", () => {
    expect(isWithinScope(membersRoot, null, doc("/zzzz/", "members"))).toBe(false);
    expect(isWithinScope(membersRoot, null, doc(null, "members"))).toBe(false);
  });

  // The reason paths always end in a separator.
  it("does not confuse a sibling whose path is a string prefix", () => {
    const jobs12 = { kind: "folder" as const, path: "/jobs/12/", visibility: "members" as const };
    expect(isWithinScope(jobs12, null, doc("/jobs/123/", "members"))).toBe(false);
    expect(isWithinScope(jobs12, null, doc("/jobs/12/x/", "members"))).toBe(true);
  });

  it("prunes an owners-only subtree from an ordinary share", () => {
    expect(isWithinScope(membersRoot, null, doc("/aaaa/bbbb/", "owners"))).toBe(false);
  });

  it("matches a file share by id only", () => {
    const fileRoot = { kind: "document" as const, path: null, visibility: "members" as const };
    expect(isWithinScope(fileRoot, "d1", doc(null, "members"))).toBe(true);
    expect(isWithinScope(fileRoot, "other", doc(null, "members"))).toBe(false);
  });

  it("hides pruned subfolder NAMES, not just their files", () => {
    const folders = [
      { id: "root", path: "/aaaa/", name: "Root", visibility: "members" as const },
      { id: "open", path: "/aaaa/bbbb/", name: "Open", visibility: "members" as const },
      { id: "secret", path: "/aaaa/cccc/", name: "Payroll", visibility: "owners" as const },
      { id: "outside", path: "/zzzz/", name: "Elsewhere", visibility: "members" as const },
    ];
    const visible = visibleSubfolders(membersRoot, folders).map((f) => f.name);
    expect(visible).toEqual(["Open"]);
  });
});

d("share links (database)", () => {
  let tenantId: string;
  let folderId: string;
  let lockedFolderId: string;
  let docId: string;
  let lockedDocId: string;
  const ctx = { tenantId: "", userId: "user-share", role: "owner" as const };

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP_OPS}-share-links`,
          name: "DMS Shares",
          slug: `${STAMP_OPS}-share-links`,
        })
        .returning();
      return row.id;
    });
    ctx.tenantId = tenantId;
    await withSystem((tx) =>
      tx.insert(schema.documentSettings).values({ tenantId }),
    );

    await asOwner(async (tx) => {
      const [open] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId,
          name: "Shared Jobs",
          nameKey: "shared jobs",
          path: "/00000000000000000000000000000000/",
        })
        .returning();
      await tx
        .update(schema.documentFolders)
        .set({ path: `/${open.id.replace(/-/g, "")}/` })
        .where(eq(schema.documentFolders.id, open.id));
      folderId = open.id;

      const [locked] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId,
          name: "Shared Payroll",
          nameKey: "shared payroll",
          path: "/00000000000000000000000000000001/",
          visibility: "owners",
          effectiveVisibility: "owners",
        })
        .returning();
      await tx
        .update(schema.documentFolders)
        .set({ path: `/${locked.id.replace(/-/g, "")}/` })
        .where(eq(schema.documentFolders.id, locked.id));
      lockedFolderId = locked.id;

      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId: open.id,
          filedAt: new Date(),
          fileName: "plans.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/plans.pdf`,
        })
        .returning();
      docId = doc.id;

      const [secret] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId: locked.id,
          filedAt: new Date(),
          effectiveVisibility: "owners",
          fileName: "wages.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/wages.pdf`,
        })
        .returning();
      lockedDocId = secret.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("creates a link whose token is never stored in the clear", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "document",
        targetId: docId,
        label: "Plans for the sub",
        canDownload: true,
        expiresInDays: 7,
      }),
    );
    expect(created.token.length).toBeGreaterThanOrEqual(40);
    expect(created.share.tokenHash).toBe(hashToken(created.token));
    // The row holds a hash and a ciphertext — never the token itself.
    const row = JSON.stringify(created.share);
    expect(row).not.toContain(created.token);
    // But an owner can still get it back, which is what the ciphertext is for.
    expect(decryptSecret(created.share.tokenCiphertext)).toBe(created.token);
  });

  // The v1 restriction that lets the public route run at the least privileged
  // role: you cannot externally share something hidden from your own staff.
  it("refuses to share owners-only content", async () => {
    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "folder",
          targetId: lockedFolderId,
          label: "nope",
          canDownload: false,
          expiresInDays: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHARE_ROOT_RESTRICTED" });

    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "document",
          targetId: lockedDocId,
          label: "nope",
          canDownload: false,
          expiresInDays: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHARE_ROOT_RESTRICTED" });
  });

  it("refuses an expiry beyond the tenant's ceiling", async () => {
    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "document",
          targetId: docId,
          label: "too long",
          canDownload: false,
          expiresInDays: 365,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHARE_TTL_TOO_LONG" });
  });

  it("refuses to share a trashed file", async () => {
    const trashedId = await asOwner(async (tx) => {
      const [row] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId,
          filedAt: new Date(),
          status: "trashed",
          trashedAt: new Date(),
          fileName: "old.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/old.pdf`,
        })
        .returning();
      return row.id;
    });
    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "document",
          targetId: trashedId,
          label: "gone",
          canDownload: false,
          expiresInDays: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_TRASHED" });
  });

  it("revokes immediately, and revocation is idempotent under a stale version", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "folder",
        targetId: folderId,
        label: "Job folder",
        canDownload: false,
        expiresInDays: 7,
      }),
    );
    await asOwner((tx) =>
      revokeShare(tx, ctx, {
        shareId: created.share.id,
        expectedVersion: created.share.version,
      }),
    );
    const after = await asOwner((tx) =>
      loadShare(tx, tenantId, created.share.id),
    );
    expect(after.revokedAt).not.toBeNull();
    expect(
      resolveShareStatus({
        revokedAt: after.revokedAt,
        expiresAt: after.expiresAt,
        maxUses: after.maxUses,
        useCount: after.useCount,
        failedUnlockCount: after.failedUnlockCount,
        createdRootVisibility: after.createdRootVisibility,
        currentRootVisibility: "members",
      }),
    ).toBe("revoked");

    await expect(
      asOwner((tx) =>
        revokeShare(tx, ctx, {
          shareId: created.share.id,
          expectedVersion: created.share.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("counts views and stamps last access", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "document",
        targetId: docId,
        label: "counted",
        canDownload: false,
        expiresInDays: 7,
        maxUses: 2,
      }),
    );
    await countShareView(tenantId, created.share.id);
    await countShareView(tenantId, created.share.id);
    const after = await asOwner((tx) =>
      loadShare(tx, tenantId, created.share.id),
    );
    expect(after.useCount).toBe(2);
    expect(after.lastAccessedAt).not.toBeNull();
    expect(
      resolveShareStatus({
        revokedAt: after.revokedAt,
        expiresAt: after.expiresAt,
        maxUses: after.maxUses,
        useCount: after.useCount,
        failedUnlockCount: after.failedUnlockCount,
        createdRootVisibility: after.createdRootVisibility,
        currentRootVisibility: "members",
      }),
    ).toBe("exhausted");
  });

  it("locks after ten failed unlocks", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "document",
        targetId: docId,
        label: "locked",
        canDownload: false,
        expiresInDays: 7,
        passcode: "hunter2",
      }),
    );
    for (let i = 0; i < MAX_FAILED_UNLOCKS; i += 1) {
      await countFailedUnlock(tenantId, created.share.id);
    }
    const after = await asOwner((tx) =>
      loadShare(tx, tenantId, created.share.id),
    );
    expect(after.failedUnlockCount).toBe(MAX_FAILED_UNLOCKS);
    expect(verifyPasscode("hunter2", after.passcodeHash ?? "")).toBe(true);
  });

  it("only lists a folder share's non-restricted contents", async () => {
    // Nest the restricted folder under the shared one, then share the parent.
    await asOwner(async (tx) => {
      const parent = await tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, folderId),
      });
      await tx
        .update(schema.documentFolders)
        .set({
          parentId: folderId,
          depth: 2,
          path: `${parent!.path}${lockedFolderId.replace(/-/g, "")}/`,
        })
        .where(eq(schema.documentFolders.id, lockedFolderId));
    });

    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "folder",
        targetId: folderId,
        label: "Whole job",
        canDownload: true,
        expiresInDays: 7,
      }),
    );

    const contents = await loadSharedContents(created.share);
    expect(contents).not.toBeNull();
    const names = contents!.files.map((f) => f.name);
    expect(names).toContain("plans.pdf");
    // The restricted subfolder's file and its NAME are both absent.
    expect(names).not.toContain("wages.pdf");
    expect(contents!.folders.map((f) => f.name)).not.toContain("Shared Payroll");

    // And the gate agrees with the listing, per request.
    expect(await resolveSharedFile(created.share, docId)).not.toBeNull();
    expect(await resolveSharedFile(created.share, lockedDocId)).toBeNull();
  });
});

describe("share activity labels", () => {
  it("derives a short, stable pseudonym from the IP hash", () => {
    const hash = "3f9a2c1b8e7d65a4";
    expect(visitorLabel(hash)).toBe("3f9a2c");
    // Same address, same code — that is the only claim the UI makes.
    expect(visitorLabel(hash)).toBe(visitorLabel(hash));
    expect(visitorLabel("aaaaaa111")).not.toBe(visitorLabel(hash));
  });

  it("returns null rather than a constant that would merge visitors", () => {
    // An event recorded without a hash must not be grouped with other such
    // events under one pseudonym — that would invent a visitor.
    expect(visitorLabel("")).toBeNull();
    expect(visitorLabel("   ")).toBeNull();
    expect(visitorLabel("abc")).toBeNull();
  });

  it("separates refusals from ordinary access", () => {
    expect(isDeniedKind("denied_passcode")).toBe(true);
    expect(isDeniedKind("denied_scope")).toBe(true);
    expect(isDeniedKind("budget_hit")).toBe(true);
    expect(isDeniedKind("viewed")).toBe(false);
    expect(isDeniedKind("downloaded")).toBe(false);
    expect(isDeniedKind("unlocked")).toBe(false);
  });
});

d("share activity feed", () => {
  let tenantId: string;
  let shareId: string;
  let docId: string;

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP_ACT, name: "DMS Act", slug: STAMP_ACT })
        .returning();
      return row.id;
    });

    docId = await asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          fileName: "elevation.pdf",
          title: "Kitchen elevation",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/elevation.pdf`,
          status: "inbox",
        })
        .returning();
      return doc.id;
    });

    shareId = await asOwner(async (tx) => {
      const [share] = await tx
        .insert(schema.documentShares)
        .values({
          tenantId,
          documentId: docId,
          label: "For the inspector",
          tokenHash: `hash-${STAMP_ACT}`,
          tokenCiphertext: "cipher",
          createdByClerkUserId: "user-act",
          expiresAt: new Date(Date.now() + 86_400_000),
          createdRootVisibility: "members",
        })
        .returning();
      return share.id;
    });

    // The log is member_read by policy, so only trusted server code writes it.
    await withSystem(async (tx) => {
      const base = Date.now();
      const events = [
        { kind: "viewed", ipHash: "aaaaaa0000", at: base - 5000 },
        { kind: "viewed", ipHash: "aaaaaa0000", at: base - 4000 },
        { kind: "downloaded", ipHash: "bbbbbb1111", at: base - 3000, bytes: 2048 },
        { kind: "denied_passcode", ipHash: "cccccc2222", at: base - 2000 },
        { kind: "viewed", ipHash: "", at: base - 1000 },
      ];
      for (const e of events) {
        await tx.insert(schema.documentShareEvents).values({
          tenantId,
          shareId,
          documentId: e.kind === "downloaded" ? docId : null,
          kind: e.kind,
          ipHash: e.ipHash,
          bytesSent: e.bytes ?? 0,
          createdAt: new Date(e.at),
        });
      }
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("returns the feed newest first with refusals flagged", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId),
    );
    expect(activity.entries).toHaveLength(5);
    // Newest first.
    expect(activity.entries[0].kind).toBe("viewed");
    expect(activity.entries[1].kind).toBe("denied_passcode");
    expect(activity.entries[1].denied).toBe(true);
    expect(activity.entries[0].denied).toBe(false);
  });

  it("counts distinct places without inventing one for missing hashes", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId),
    );
    // Three real hashes; the two opens from aaaaaa are ONE place, and the
    // event with no hash contributes nobody.
    expect(activity.distinctVisitors).toBe(3);
    expect(activity.entries.some((e) => e.visitor === null)).toBe(true);
  });

  it("names the file a download was for, preferring its title", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId),
    );
    const download = activity.entries.find((e) => e.kind === "downloaded")!;
    expect(download.documentName).toBe("Kitchen elevation");
    expect(download.bytesSent).toBe(2048);
    // Events not about one file carry no name rather than a placeholder.
    expect(
      activity.entries.find((e) => e.kind === "denied_passcode")!.documentName,
    ).toBeNull();
  });

  it("flags truncation instead of implying the feed is complete", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId, 2),
    );
    expect(activity.entries).toHaveLength(2);
    expect(activity.truncated).toBe(true);

    const full = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId, 100),
    );
    expect(full.truncated).toBe(false);
  });

  /**
   * The log is evidence, so members read it and only withSystem code appends.
   * A member who could write it could also fabricate an access record.
   */
  it("is read-only to members", async () => {
    await expect(
      asOwner((tx) =>
        tx.insert(schema.documentShareEvents).values({
          tenantId,
          shareId,
          kind: "viewed",
          ipHash: "forged",
        }),
      ),
    ).rejects.toThrow();
  });
});
