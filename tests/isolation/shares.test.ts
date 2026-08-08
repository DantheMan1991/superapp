import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

const STAMP_SHR = `iso-shr-${process.pid}`;

interface ShareFixture {
  folderId: string;
  documentId: string;
  shareId: string;
}

d("share-link isolation (RLS + composite FKs + write-only-by-system log)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, ShareFixture> = {};

  async function seedShares(tenantId: string, tag: string): Promise<ShareFixture> {
    return withTenant(
      tenantId,
      async (tx) => {
        const [folder] = await tx
          .insert(schema.documentFolders)
          .values({
            tenantId,
            name: `Shared ${tag}`,
            nameKey: `shared ${tag}`.toLowerCase(),
            path: `/${"0".repeat(31)}${tag === "A" ? "1" : "2"}/`,
          })
          .returning();
        await tx
          .update(schema.documentFolders)
          .set({ path: `/${folder.id.replace(/-/g, "")}/` })
          .where(eq(schema.documentFolders.id, folder.id));

        const [doc] = await tx
          .insert(schema.documents)
          .values({
            tenantId,
            origin: "dms",
            folderId: folder.id,
            filedAt: new Date(),
            fileName: `${tag}.pdf`,
            mimeType: "application/pdf",
            blobPathname: `docs/${tenantId}/files/${tag}-share.pdf`,
          })
          .returning();

        const [share] = await tx
          .insert(schema.documentShares)
          .values({
            tenantId,
            documentId: doc.id,
            tokenHash: `hash-${tag}-${STAMP_SHR}`,
            tokenCiphertext: "ciphertext",
            label: `Link ${tag}`,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdRootVisibility: "members",
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();

        return { folderId: folder.id, documentId: doc.id, shareId: share.id };
      },
      { role: "owner" },
    );
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_SHR}-a`, name: "Share Iso A", slug: `${STAMP_SHR}-a` },
          { clerkOrgId: `${STAMP_SHR}-b`, name: "Share Iso B", slug: `${STAMP_SHR}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedShares(tenantA, "A");
    fx.b = await seedShares(tenantB, "B");

    // Events are written by trusted server code only, never by a member.
    await withSystem(async (tx) => {
      await tx.insert(schema.documentShareEvents).values({
        tenantId: tenantA,
        shareId: fx.a.shareId,
        kind: "viewed",
        ipHash: "hash-a",
      });
      await tx.insert(schema.documentShareEvents).values({
        tenantId: tenantB,
        shareId: fx.b.shareId,
        kind: "viewed",
        ipHash: "hash-b",
      });
      await tx.insert(schema.publicAccessAttempts).values({
        kind: "share_probe",
        ipHash: `probe-${STAMP_SHR}`,
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.publicAccessAttempts)
        .where(eq(schema.publicAccessAttempts.ipHash, `probe-${STAMP_SHR}`));
    });
  });

  it("unscoped selects return only this tenant's shares and events", async () => {
    const [shares, events] = await withTenant(
      tenantA,
      async (tx) =>
        Promise.all([
          tx.select().from(schema.documentShares),
          tx.select().from(schema.documentShareEvents),
        ]),
      { role: "owner" },
    );
    expect(shares.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(shares.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(events.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("cannot INSERT a share attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantB,
          documentId: fx.b.documentId,
          tokenHash: `smuggled-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks sharing the other tenant's document or folder", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantA,
          documentId: fx.b.documentId,
          tokenHash: `smuggled-doc-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantA,
          folderId: fx.b.folderId,
          tokenHash: `smuggled-folder-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a share points at exactly one thing", async () => {
    const bad = async (values: Record<string, unknown>) =>
      expect(
        withTenant(tenantA, (tx) =>
          tx.insert(schema.documentShares).values({
            tenantId: tenantA,
            tokenHash: `check-${Math.random()}`,
            tokenCiphertext: "x",
            expiresAt: new Date(Date.now() + 60_000),
            createdRootVisibility: "members",
            createdByClerkUserId: "u",
            ...values,
          } as typeof schema.documentShares.$inferInsert),
        ),
      ).rejects.toThrow();

    await bad({}); // neither
    await bad({ documentId: fx.a.documentId, folderId: fx.a.folderId }); // both
  });

  it("token_hash is unique across the whole table, not per tenant", async () => {
    await expect(
      withTenant(tenantB, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantB,
          documentId: fx.b.documentId,
          // Deliberately the hash tenant A already holds.
          tokenHash: `hash-A-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "u",
        }),
      ),
    ).rejects.toThrow();
  });

  it("the access log is evidence: members read it, never write it", async () => {
    // Even for their OWN tenant.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShareEvents).values({
          tenantId: tenantA,
          shareId: fx.a.shareId,
          kind: "viewed",
          ipHash: "forged",
        }),
      ),
    ).rejects.toThrow();

    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.documentShareEvents)
        .set({ kind: "downloaded" })
        .where(eq(schema.documentShareEvents.tenantId, tenantA))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.documentShareEvents)
        .where(eq(schema.documentShareEvents.tenantId, tenantA))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("composite FK blocks logging against the other tenant's share", async () => {
    await expect(
      withSystem(async (tx) => {
        await tx.execute(sql`select set_config('app.role', 'member', true)`);
        await tx.execute(
          sql`select set_config('app.tenant_id', ${tenantA}, true)`,
        );
        return tx.insert(schema.documentShareEvents).values({
          tenantId: tenantA,
          shareId: fx.b.shareId,
          kind: "viewed",
        });
      }),
    ).rejects.toThrow();
  });

  it("anonymous probe counters are invisible to every tenant", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.publicAccessAttempts),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  it("cross-tenant UPDATE and DELETE on shares affect zero rows", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.documentShares)
          .set({ label: "hijacked" })
          .where(eq(schema.documentShares.id, fx.b.shareId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.documentShares)
          .where(eq(schema.documentShares.id, fx.b.shareId))
          .returning(),
      { role: "owner" },
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no share rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.documentShares),
        tx.select().from(schema.documentShareEvents),
        tx.select().from(schema.publicAccessAttempts),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});
