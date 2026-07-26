import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import {
  describeMxProvider,
  mxPointsAt,
  normalizeMxRecords,
} from "@/lib/email/mailbox/mx";

/**
 * Hosted mailboxes.
 *
 * The stakes here are different from the rest of the email module: a bug in
 * the sending spine means a notification does not go out, while a bug here
 * means a business stops receiving mail and does not find out until someone
 * asks why their order was never acknowledged.
 *
 * So the tests that matter most are the ones protecting `previous_mx` — the
 * single stored copy of where a domain's mail used to go — and the ones
 * proving a member cannot talk a domain into 'active' without the cutover
 * having actually happened.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `mbx-${process.pid}`;

describe("reading a domain's current mail provider", () => {
  it("names the big providers an owner will recognize", () => {
    expect(
      describeMxProvider([
        { host: "aspmx.l.google.com", priority: 1 },
        { host: "alt1.aspmx.l.google.com", priority: 5 },
      ]),
    ).toBe("Google Workspace");

    expect(
      describeMxProvider([
        { host: "acme-com.mail.protection.outlook.com", priority: 0 },
      ]),
    ).toBe("Microsoft 365");

    expect(
      describeMxProvider([{ host: "mx1.migadu.com", priority: 10 }]),
    ).toBe("Migadu (already us)");
  });

  it("falls back to the raw hostname rather than pretending to know", () => {
    expect(describeMxProvider([{ host: "mx.weird-host.net", priority: 10 }])).toBe(
      "mx.weird-host.net",
    );
  });

  it("says plainly when a domain has no mail today", () => {
    // This is the safe case — nothing to lose in a cutover — and the copy
    // shown to the owner depends on telling it apart from the risky one.
    expect(describeMxProvider([])).toContain("no mail");
  });

  it("knows whether MX already points at a given host", () => {
    const google = [{ host: "aspmx.l.google.com", priority: 1 }];
    expect(mxPointsAt(google, "migadu")).toBe(false);
    expect(mxPointsAt([{ host: "mx2.migadu.com", priority: 20 }], "migadu")).toBe(
      true,
    );
  });

  it("normalizes resolver output and drops the trailing dot", () => {
    expect(
      normalizeMxRecords([
        { exchange: "aspmx.l.google.com.", priority: 1 },
        { exchange: "", priority: 5 },
        "nonsense",
      ]),
    ).toEqual([{ host: "aspmx.l.google.com", priority: 1 }]);
  });

  it("returns nothing for a shape it does not understand", () => {
    expect(normalizeMxRecords(undefined)).toEqual([]);
    expect(normalizeMxRecords({ exchange: "x" })).toEqual([]);
  });
});

d("hosted mailbox domains (database)", () => {
  let tenantId: string;
  let otherId: string;
  let domainId: string;
  const domain = `${STAMP}.example.com`;

  beforeAll(async () => {
    [tenantId, otherId] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Mailbox Co", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Other Co", slug: `${STAMP}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    domainId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.mailboxDomains)
        .values({
          tenantId,
          domain,
          provider: "migadu",
          status: "pending",
          previousMx: [{ host: "aspmx.l.google.com", priority: 1 }],
        })
        .returning();
      return row.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, otherId));
    });
  });

  it("a member can read the hosted domain but never write it", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.mailboxDomains),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");

    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.mailboxDomains).values({
          tenantId,
          domain: `forged-${STAMP}.example.com`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("an owner cannot talk their own domain into being active", async () => {
    // Activation means "mail for this domain now arrives here". If a member
    // could assert it, the app would believe a cutover happened that never did.
    const updated = await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.mailboxDomains)
          .set({ status: "active", mxCutoverAt: new Date() })
          .where(eq(schema.mailboxDomains.tenantId, tenantId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);

    const still = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.mailboxDomains),
    );
    expect(still[0].status).toBe("pending");
  });

  it("an owner cannot erase the rollback record", async () => {
    // previous_mx is the only stored copy of where this domain's mail used to
    // go. Losing it turns a reversible mistake into an outage someone has to
    // solve from memory.
    const wiped = await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.mailboxDomains)
          .set({ previousMx: [] })
          .where(eq(schema.mailboxDomains.tenantId, tenantId))
          .returning(),
      { role: "owner" },
    );
    expect(wiped).toHaveLength(0);

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.mailboxDomains),
    );
    expect(rows[0].previousMx).toEqual([
      { host: "aspmx.l.google.com", priority: 1 },
    ]);
  });

  it("cannot see another tenant's hosted domain", async () => {
    await withSystem((tx) =>
      tx.insert(schema.mailboxDomains).values({
        tenantId: otherId,
        domain: `other-${STAMP}.example.com`,
        status: "pending",
      }),
    );
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.mailboxDomains),
    );
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
  });

  it("two tenants cannot host the same domain", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailboxDomains).values({
          tenantId: otherId,
          domain,
          status: "pending",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a domain cannot be active without a recorded cutover", async () => {
    // The CHECK backs up the application flow: any path that reaches 'active'
    // without stamping mx_cutover_at has skipped the rollback capture.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.mailboxDomains)
          .set({ status: "active", mxCutoverAt: null })
          .where(eq(schema.mailboxDomains.id, domainId)),
      ),
    ).rejects.toThrow();
  });

  it("rejects a status or provider the app does not understand", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.mailboxDomains)
          .set({ status: "probably-fine" })
          .where(eq(schema.mailboxDomains.id, domainId)),
      ),
    ).rejects.toThrow();

    await expect(
      withSystem((tx) =>
        tx
          .update(schema.mailboxDomains)
          .set({ provider: "some-guy-with-a-server" })
          .where(eq(schema.mailboxDomains.id, domainId)),
      ),
    ).rejects.toThrow();
  });

  it("default-deny: no context sees no mailbox rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.mailboxDomains),
        tx.select().from(schema.mailboxes),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});

d("mailboxes (database)", () => {
  let tenantId: string;
  let otherId: string;
  let domainId: string;
  let otherDomainId: string;

  beforeAll(async () => {
    [tenantId, otherId] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-mA`, name: "Boxes A", slug: `${STAMP}-mA` },
          { clerkOrgId: `${STAMP}-mB`, name: "Boxes B", slug: `${STAMP}-mB` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    [domainId, otherDomainId] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.mailboxDomains)
        .values([
          { tenantId, domain: `a-${STAMP}.example.com`, status: "dns_ready" },
          {
            tenantId: otherId,
            domain: `b-${STAMP}.example.com`,
            status: "dns_ready",
          },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    await withSystem((tx) =>
      tx.insert(schema.mailboxes).values({
        tenantId,
        mailboxDomainId: domainId,
        localPart: "dan",
        address: `dan@a-${STAMP}.example.com`,
        displayName: "Dan",
      }),
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, otherId));
    });
  });

  it("a member can read the mailbox list but never write it", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.mailboxes),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].localPart).toBe("dan");

    // Minting an address the host has never heard of would create a mailbox
    // the app lists and no mail ever reaches.
    await expect(
      withTenant(
        tenantId,
        (tx) =>
          tx.insert(schema.mailboxes).values({
            tenantId,
            mailboxDomainId: domainId,
            localPart: "ceo",
            address: `ceo@a-${STAMP}.example.com`,
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  it("a member cannot repoint an existing mailbox at themselves", async () => {
    const updated = await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.mailboxes)
          .set({ clerkUserId: "user-someone-else" })
          .where(eq(schema.mailboxes.tenantId, tenantId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);
  });

  it("composite FK: a mailbox cannot hang off another tenant's domain", async () => {
    // Even under withSystem, where RLS is not the guard, the composite FK makes
    // the cross-tenant link structurally impossible.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailboxes).values({
          tenantId,
          mailboxDomainId: otherDomainId,
          localPart: "smuggled",
          address: `smuggled@b-${STAMP}.example.com`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("the same address cannot exist twice on one domain", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailboxes).values({
          tenantId,
          mailboxDomainId: domainId,
          localPart: "dan",
          address: `dan@a-${STAMP}.example.com`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a local part the mail host would refuse", async () => {
    for (const localPart of ["Dan", "has space", "-leading", "with@at"]) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.mailboxes).values({
            tenantId,
            mailboxDomainId: domainId,
            localPart,
            address: `x@a-${STAMP}.example.com`,
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("deleting the domain takes its mailboxes with it", async () => {
    const scratchTenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-casc`,
          name: "Cascade Co",
          slug: `${STAMP}-casc`,
        })
        .returning();
      return row.id;
    });

    await withSystem(async (tx) => {
      const [dom] = await tx
        .insert(schema.mailboxDomains)
        .values({
          tenantId: scratchTenant,
          domain: `casc-${STAMP}.example.com`,
          status: "pending",
        })
        .returning();
      await tx.insert(schema.mailboxes).values({
        tenantId: scratchTenant,
        mailboxDomainId: dom.id,
        localPart: "info",
        address: `info@casc-${STAMP}.example.com`,
      });
      await tx
        .delete(schema.mailboxDomains)
        .where(eq(schema.mailboxDomains.id, dom.id));
    });

    const left = await withSystem((tx) =>
      tx
        .select()
        .from(schema.mailboxes)
        .where(eq(schema.mailboxes.tenantId, scratchTenant)),
    );
    expect(left).toHaveLength(0);

    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, scratchTenant)),
    );
  });
});
