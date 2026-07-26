import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";

/**
 * RLS for the inbox tables.
 *
 * Three different policy shapes here, and the tests exist to prove each is the
 * shape that was intended rather than the one that got copied:
 *
 *   mail_directory_accounts  member_read + a MAIL SERVER read policy
 *   mail_accounts            member_read (OAuth tokens)
 *   mail_thread_index        member_read (derived from the mail server)
 *   mail_links               MEMBER WRITABLE — the deliberate exception
 *   mail_annotations         MEMBER WRITABLE — same
 *
 * The member-writable pair is the interesting case. Most of this module is
 * read-only to members because a bad write asserts something untrue about the
 * outside world. Linking a thread to an invoice asserts nothing outside
 * Yosher, is visible, and is reversible — so it stays ordinary work.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `inbox-${process.pid}`;

d("inbox tables (RLS)", () => {
  let tenantA: string;
  let tenantB: string;
  let domainA: string;
  let mailboxA: string;
  let accountA: string;
  let mailboxB: string;

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Inbox A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Inbox B", slug: `${STAMP}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    await withSystem(async (tx) => {
      const [domA, domB] = await tx
        .insert(schema.mailboxDomains)
        .values([
          { tenantId: tenantA, domain: `a-${STAMP}.example.com`, status: "dns_ready" },
          { tenantId: tenantB, domain: `b-${STAMP}.example.com`, status: "dns_ready" },
        ])
        .returning();
      domainA = domA.id;

      const [mbA, mbB] = await tx
        .insert(schema.mailboxes)
        .values([
          {
            tenantId: tenantA,
            mailboxDomainId: domA.id,
            localPart: "dan",
            address: `dan@a-${STAMP}.example.com`,
          },
          {
            tenantId: tenantB,
            mailboxDomainId: domB.id,
            localPart: "sam",
            address: `sam@b-${STAMP}.example.com`,
          },
        ])
        .returning();
      mailboxA = mbA.id;
      mailboxB = mbB.id;

      await tx.insert(schema.mailDirectoryAccounts).values({
        tenantId: tenantA,
        mailboxId: mbA.id,
        login: `dan@a-${STAMP}.example.com`,
        passwordHash: "$argon2id$fake-hash-for-test",
      });

      const [acc] = await tx
        .insert(schema.mailAccounts)
        .values({
          tenantId: tenantA,
          mailboxId: mbA.id,
          clerkUserId: "user-a",
          jmapAccountId: "acc1",
          accessTokenEnc: "ciphertext-access",
          refreshTokenEnc: "ciphertext-refresh",
        })
        .returning();
      accountA = acc.id;

      await tx.insert(schema.mailThreadIndex).values({
        tenantId: tenantA,
        mailAccountId: acc.id,
        threadId: "T1",
        subject: "Revised drawings",
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("a member cannot forge a password hash on the directory", () => {
    // The sharpest write in this module: a member who could set password_hash
    // could set their own hash on a colleague's address and read their mail.
    return withTenant(
      tenantA,
      async (tx) => {
        const readable = await tx.select().from(schema.mailDirectoryAccounts);
        expect(readable).toHaveLength(1);

        const updated = await tx
          .update(schema.mailDirectoryAccounts)
          .set({ passwordHash: "$argon2id$attacker-chosen" })
          .where(eq(schema.mailDirectoryAccounts.tenantId, tenantA))
          .returning();
        expect(updated).toHaveLength(0);
      },
      { role: "owner" },
    );
  });

  it("cannot mint a directory entry for an address it does not own", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailDirectoryAccounts).values({
            tenantId: tenantA,
            mailboxId: mailboxA,
            login: `ceo@somebody-else.com`,
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  it("a login is unique platform-wide", async () => {
    // Two accounts resolving from one login is an authentication bug with a
    // cross-tenant blast radius.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailDirectoryAccounts).values({
          tenantId: tenantB,
          mailboxId: mailboxB,
          login: `dan@a-${STAMP}.example.com`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a member can see that a mail account exists but cannot write its tokens", async () => {
    await withTenant(
      tenantA,
      async (tx) => {
        const rows = await tx.select().from(schema.mailAccounts);
        expect(rows).toHaveLength(1);

        const updated = await tx
          .update(schema.mailAccounts)
          .set({ accessTokenEnc: "attacker-token" })
          .where(eq(schema.mailAccounts.tenantId, tenantA))
          .returning();
        expect(updated).toHaveLength(0);
      },
      { role: "owner" },
    );
  });

  it("cannot read another tenant's mail accounts or directory", async () => {
    await withTenant(tenantB, async (tx) => {
      expect(await tx.select().from(schema.mailAccounts)).toHaveLength(0);
      expect(await tx.select().from(schema.mailDirectoryAccounts)).toHaveLength(0);
      expect(await tx.select().from(schema.mailThreadIndex)).toHaveLength(0);
    });
  });

  it("the thread index is readable but not authorable by members", async () => {
    await withTenant(tenantA, async (tx) => {
      const rows = await tx.select().from(schema.mailThreadIndex);
      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe("Revised drawings");
    });

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailThreadIndex).values({
          tenantId: tenantA,
          mailAccountId: accountA,
          threadId: "T-forged",
          subject: "Invented",
        }),
      ),
    ).rejects.toThrow();
  });

  it("members CAN link a thread to a business object — the deliberate exception", async () => {
    // The core feature. Routing this through owner-only actions would make the
    // product's whole point feel like an administrative chore.
    const link = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.mailLinks)
        .values({
          tenantId: tenantA,
          threadId: "T1",
          extensionSlug: "documents",
          entityType: "document",
          entityId: domainA, // any uuid; the link table does not FK to entities
          createdByClerkUserId: "user-a",
        })
        .returning(),
    );
    expect(link).toHaveLength(1);

    const annotation = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.mailAnnotations)
        .values({
          tenantId: tenantA,
          threadId: "T1",
          extensionSlug: "documents",
          data: { filedCount: 2 },
        })
        .returning(),
    );
    expect(annotation).toHaveLength(1);
  });

  it("a member cannot file a link into another tenant", async () => {
    // WITH CHECK pins tenant_id, so a forged id is refused on insert.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailLinks).values({
          tenantId: tenantB,
          threadId: "T1",
          extensionSlug: "documents",
          entityType: "document",
          entityId: domainA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("entity_type carries no whitelist, so a future layer needs no migration", async () => {
    // The extensibility requirement, enforced by its absence: a constraint
    // listing today's types would have to be migrated for every new layer.
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.mailLinks)
        .values({
          tenantId: tenantA,
          threadId: "T1",
          extensionSlug: "construction",
          entityType: "rfi",
          entityId: domainA,
        })
        .returning(),
    );
    expect(rows[0].entityType).toBe("rfi");
  });

  it("still rejects an entity_type that is not a usable identifier", async () => {
    for (const bad of ["Invoice", "with space", "-leading", ""]) {
      await expect(
        withTenant(tenantA, (tx) =>
          tx.insert(schema.mailLinks).values({
            tenantId: tenantA,
            threadId: "T2",
            extensionSlug: "documents",
            entityType: bad,
            entityId: domainA,
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("composite FK: a thread index row cannot hang off another tenant's account", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailThreadIndex).values({
          tenantId: tenantB,
          mailAccountId: accountA,
          threadId: "T-smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a directory entry cannot point at another tenant's mailbox", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailDirectoryAccounts).values({
          tenantId: tenantB,
          mailboxId: mailboxA,
          login: `smuggled@b-${STAMP}.example.com`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("deleting the mailbox takes its directory entry and connections with it", async () => {
    const scratch = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-casc`,
          name: "Cascade",
          slug: `${STAMP}-casc`,
        })
        .returning();
      const [dom] = await tx
        .insert(schema.mailboxDomains)
        .values({ tenantId: t.id, domain: `casc-${STAMP}.example.com` })
        .returning();
      const [mb] = await tx
        .insert(schema.mailboxes)
        .values({
          tenantId: t.id,
          mailboxDomainId: dom.id,
          localPart: "info",
          address: `info@casc-${STAMP}.example.com`,
        })
        .returning();
      await tx.insert(schema.mailDirectoryAccounts).values({
        tenantId: t.id,
        mailboxId: mb.id,
        login: `info@casc-${STAMP}.example.com`,
      });
      await tx.delete(schema.mailboxes).where(eq(schema.mailboxes.id, mb.id));
      return t.id;
    });

    const left = await withSystem((tx) =>
      tx
        .select()
        .from(schema.mailDirectoryAccounts)
        .where(eq(schema.mailDirectoryAccounts.tenantId, scratch)),
    );
    expect(left).toHaveLength(0);

    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, scratch)),
    );
  });

  it("default-deny: no context sees no inbox rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.mailDirectoryAccounts),
        tx.select().from(schema.mailAccounts),
        tx.select().from(schema.mailThreadIndex),
        tx.select().from(schema.mailLinks),
        tx.select().from(schema.mailAnnotations),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});
