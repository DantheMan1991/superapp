import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import {
  describeMxProvider,
  mxPointsAt,
  normalizeMxRecords,
} from "@/lib/email/mailbox/mx";
import {
  normalizeDiagnostics,
  normalizeMailbox,
  normalizeRecords,
} from "@/lib/email/mailbox/migadu-parse";
import {
  guardCutover,
  guardInviteAddress,
  guardMailboxDeletion,
} from "@/lib/email/mailbox/guard";

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

  it("matches a self-hosted MX, which carries no provider name at all", () => {
    // The bug this replaces: callers passed the PROVIDER, and "migadu" happens
    // to appear in every Migadu MX hostname. A self-hosted server's MX is the
    // operator's own hostname, so matching on "stalwart" could never be true
    // and the cutover refused itself with a message that named the correct
    // destination as if it were the wrong one.
    const selfHosted = [{ host: "jmap.yosherapp.com", priority: 10 }];
    expect(mxPointsAt(selfHosted, "stalwart")).toBe(false);
    expect(mxPointsAt(selfHosted, "jmap.yosherapp.com")).toBe(true);
  });

  it("treats an unconfigured host as no match rather than every match", () => {
    // "anything".includes("") is true. Both callers decide whether it is safe
    // to redirect a business's mail, so an unknown answer has to read as no.
    const anything = [{ host: "aspmx.l.google.com", priority: 1 }];
    expect(mxPointsAt(anything, "")).toBe(false);
    expect(mxPointsAt(anything, "   ")).toBe(false);
  });

  it("ignores case and padding in the needle", () => {
    const selfHosted = [{ host: "jmap.yosherapp.com", priority: 10 }];
    expect(mxPointsAt(selfHosted, " JMAP.YosherApp.com ")).toBe(true);
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

describe("environment guards", () => {
  const PRODUCTION = { vercelEnv: "production", nodeEnv: "production" };
  const PREVIEW = { vercelEnv: "preview", nodeEnv: "production" };
  const LOCAL = { nodeEnv: "development" };

  it("allows a cutover only from real production", () => {
    expect(guardCutover(PRODUCTION)).toBeNull();
    expect(guardCutover(PREVIEW)).toContain("live app");
    expect(guardCutover(LOCAL)).toContain("live app");
  });

  it("blocks a cutover on a Vercel preview despite NODE_ENV=production", () => {
    // The trap the whole guard turns on: Vercel builds previews with
    // NODE_ENV=production, so a NODE_ENV check would treat every branch
    // deployment as live — and a branch deployment is exactly where someone
    // tries the scary button to see what it does.
    expect(guardCutover(PREVIEW)).not.toBeNull();
  });

  it("allows mailbox deletion only from real production", () => {
    expect(guardMailboxDeletion(PRODUCTION)).toBeNull();
    expect(guardMailboxDeletion(PREVIEW)).toContain("destroy real mail");
    expect(guardMailboxDeletion(LOCAL)).not.toBeNull();
  });

  it("sends invitations wherever the owner said, in production", () => {
    const result = guardInviteAddress("dan@personal.com", {
      ...PRODUCTION,
      redirect: "dev@example.com",
    });
    expect(result).toEqual({
      inviteEmail: "dan@personal.com",
      redirected: false,
    });
  });

  it("diverts invitations to the developer outside production", () => {
    // The mailbox is still created — only the message to a human is diverted,
    // so the flow stays testable without mailing a real person.
    const result = guardInviteAddress("realclient@theirdomain.com", {
      ...PREVIEW,
      redirect: "dev@example.com",
    });
    expect(result).toEqual({ inviteEmail: "dev@example.com", redirected: true });
  });

  it("refuses to invite at all outside production with no redirect set", () => {
    const result = guardInviteAddress("realclient@theirdomain.com", PREVIEW);
    expect("blocked" in result).toBe(true);
    if ("blocked" in result) {
      expect(result.blocked).toContain("EMAIL_DEV_REDIRECT");
    }
  });
});

/**
 * Golden fixtures: verbatim copies of live Migadu responses captured with
 * `npm run mailbox:probe -- yosherapp.com` on 2026-07-26.
 *
 * These exist because the first version of the adapter was written from the
 * published docs and got two shapes wrong in ways that unit tests could not
 * have caught — a normalizer that returns [] for an unexpected shape looks
 * perfectly healthy against invented input. Only real payloads prove it.
 */
const LIVE_RECORDS = {
  spf: { name: "@", type: "txt", value: "v=spf1 include:spf.migadu.com -all" },
  dkim: [
    {
      name: "key1._domainkey",
      type: "cname",
      value: "key1.yosherapp.com._domainkey.migadu.com.",
    },
    {
      name: "key2._domainkey",
      type: "cname",
      value: "key2.yosherapp.com._domainkey.migadu.com.",
    },
    {
      name: "key3._domainkey",
      type: "cname",
      value: "key3.yosherapp.com._domainkey.migadu.com.",
    },
  ],
  domain_name: "yosherapp.com",
  dmarc: { name: "_dmarc", type: "txt", value: "v=DMARC1; p=quarantine;" },
  dns_verification: {
    name: "@",
    type: "txt",
    value: "hosted-email-verify=catkdcbw",
  },
  mx_records: [
    { name: "@", priority: 10, type: "mx", value: "aspmx1.migadu.com" },
    { name: "@", priority: 20, type: "mx", value: "aspmx2.migadu.com" },
  ],
};

const LIVE_DIAGNOSTICS_OK = {
  status: "ok",
  checks: {
    verify: "ok",
    nameservers: "ok",
    spf: "ok",
    mx: "ok",
    dkim: "ok",
  },
};

describe("parsing the mail host's DNS records", () => {
  it("reads Migadu's keyed object, not a list", () => {
    // The original bug: the payload is an object keyed by purpose, and an
    // array-shaped reader returns [] — an empty DNS wizard that looks like a
    // host with nothing to configure.
    const rows = normalizeRecords(LIVE_RECORDS);
    expect(rows.length).toBe(8);
  });

  it("emits records in the order someone should publish them", () => {
    const labels = normalizeRecords(LIVE_RECORDS).map((r) => r.record);
    expect(labels).toEqual([
      "Verification",
      "MX",
      "MX",
      "DKIM",
      "DKIM",
      "DKIM",
      "SPF",
      "DMARC (optional)",
    ]);
  });

  it("keeps MX priorities, which decide delivery order", () => {
    const mx = normalizeRecords(LIVE_RECORDS).filter((r) => r.type === "MX");
    expect(mx.map((r) => [r.priority, r.value])).toEqual([
      [10, "aspmx1.migadu.com"],
      [20, "aspmx2.migadu.com"],
    ]);
  });

  it("strips the trailing dot most DNS panels reject", () => {
    const dkim = normalizeRecords(LIVE_RECORDS).filter(
      (r) => r.record === "DKIM",
    );
    expect(dkim).toHaveLength(3);
    for (const row of dkim) {
      expect(row.value.endsWith(".")).toBe(false);
      expect(row.type).toBe("CNAME");
    }
  });

  it("marks DMARC optional rather than presenting it as required", () => {
    // Publishing a second DMARC record at a name that already has one makes
    // DMARC fail to evaluate entirely. The wizard must not imply "add this".
    const dmarc = normalizeRecords(LIVE_RECORDS).find((r) =>
      r.record.startsWith("DMARC"),
    );
    expect(dmarc?.record).toContain("optional");
  });

  it("returns nothing for a shape it does not recognize", () => {
    expect(normalizeRecords(undefined)).toEqual([]);
    expect(normalizeRecords([])).toEqual([]);
    expect(normalizeRecords({ unrelated: true })).toEqual([]);
  });
});

describe("parsing diagnostics (the cutover gate)", () => {
  it("reads checks.mx, not mx", () => {
    // The original bug: mxOk read root.mx, which does not exist, so the
    // cutover could never unlock no matter how correct the DNS was.
    const result = normalizeDiagnostics(LIVE_DIAGNOSTICS_OK);
    expect(result.ok).toBe(true);
    expect(result.mxOk).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("refuses the cutover when MX is not passing, and says which check failed", () => {
    const result = normalizeDiagnostics({
      status: "error",
      checks: { ...LIVE_DIAGNOSTICS_OK.checks, mx: "missing" },
    });
    expect(result.mxOk).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.findings.join(" ")).toContain("MX");
    expect(result.findings.join(" ")).toContain("missing");
  });

  it("is not ready when a non-MX check fails, even on a green top line", () => {
    // Promoting to dns_ready with broken DKIM would offer a cutover that
    // lands the tenant's mail in spam.
    const result = normalizeDiagnostics({
      status: "ok",
      checks: { ...LIVE_DIAGNOSTICS_OK.checks, dkim: "failed" },
    });
    expect(result.ok).toBe(false);
    expect(result.findings.join(" ")).toContain("DKIM");
  });

  it("defaults to NOT ready when the payload cannot be read", () => {
    // The asymmetry that justifies this: a false "not ready" costs a click, a
    // false "ready" redirects a business's mail on an unparsed response.
    for (const payload of [undefined, null, "surprise", 42, []]) {
      const result = normalizeDiagnostics(payload);
      expect(result.ok).toBe(false);
      expect(result.mxOk).toBe(false);
    }
  });

  it("treats a missing checks object as not ready", () => {
    const result = normalizeDiagnostics({ status: "ok" });
    expect(result.mxOk).toBe(false);
  });
});

describe("parsing mailboxes", () => {
  const LIVE_MAILBOX = {
    address: "admin@yosherapp.com",
    local_part: "admin",
    name: "Postmaster",
    may_send: true,
    may_receive: true,
    may_access_imap: true,
    is_active: true,
    password_recovery_email: null,
  };

  it("reads the live mailbox shape", () => {
    expect(normalizeMailbox(LIVE_MAILBOX, "yosherapp.com")).toEqual({
      localPart: "admin",
      address: "admin@yosherapp.com",
      displayName: "Postmaster",
      maySend: true,
      mayReceive: true,
      mayAccessImap: true,
    });
  });

  it("rejects a row with no local part rather than inventing an address", () => {
    expect(normalizeMailbox({ address: "x@y.com" }, "y.com")).toBeNull();
    expect(normalizeMailbox(null, "y.com")).toBeNull();
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
