import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import {
  emailDomainOf,
  isSubdomain,
  looksLikeEmail,
  normalizeLocalPart,
  normalizeSendingDomain,
  resolveSender,
  sanitizeDisplayName,
} from "@/lib/email/identity";
import { applyDevGuard, isLiveSendEnvironment } from "@/lib/email/send";

/**
 * The email spine. The pure block is the important one: resolveSender decides
 * what address a client's customers see, and getting it wrong either looks
 * unprofessional (always sending from our domain) or silently lands in spam
 * (claiming a domain that has not been authenticated).
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `email-${process.pid}`;

describe("sender identity", () => {
  const platform = { platformDomain: "mail.yosherapp.com" };

  it("uses the tenant's own domain once it is verified", () => {
    const sender = resolveSender({
      ...platform,
      tenantName: "Acme Builders",
      verifiedDomain: {
        domain: "mail.acmebuilders.com",
        fromLocalPart: "invoices",
        fromName: "Acme Builders",
      },
    });
    expect(sender.kind).toBe("tenant_domain");
    expect(sender.fromAddress).toBe("invoices@mail.acmebuilders.com");
    expect(sender.from).toBe('"Acme Builders" <invoices@mail.acmebuilders.com>');
  });

  // The fallback must not read as a faceless third-party tool.
  it("falls back to the platform domain but keeps the tenant's name", () => {
    const sender = resolveSender({
      ...platform,
      tenantName: "Acme Builders",
      verifiedDomain: null,
      tenantReplyTo: "dan@acmebuilders.com",
    });
    expect(sender.kind).toBe("platform");
    expect(sender.from).toBe('"Acme Builders" <notifications@mail.yosherapp.com>');
    // Replies still reach the business.
    expect(sender.replyTo).toBe("dan@acmebuilders.com");
  });

  it("prefers the domain's own display name when one is set", () => {
    const sender = resolveSender({
      ...platform,
      tenantName: "Acme Builders LLC",
      verifiedDomain: {
        domain: "mail.acme.com",
        fromLocalPart: "hello",
        fromName: "Acme",
      },
    });
    expect(sender.from).toBe('"Acme" <hello@mail.acme.com>');
  });

  // A tenant name is user-controlled and lands in a mail header.
  it("cannot break out of the From header", () => {
    const sender = resolveSender({
      ...platform,
      tenantName: 'Acme" <evil@attacker.com>, "X',
      verifiedDomain: null,
    });
    expect(sender.from).not.toContain("evil@attacker.com>");
    expect(sender.from.match(/</g)?.length).toBe(1);
    expect(sanitizeDisplayName("a\r\nBcc: x@y.com")).not.toContain("\n");
  });

  it("never emits an empty display name", () => {
    const sender = resolveSender({
      ...platform,
      tenantName: "   ",
      verifiedDomain: null,
    });
    expect(sender.from).toContain('"Yosher"');
  });
});

describe("domain and address parsing", () => {
  it("normalizes what people actually paste", () => {
    expect(normalizeSendingDomain("  MAIL.Acme.com  ")).toBe("mail.acme.com");
    expect(normalizeSendingDomain("https://mail.acme.com/")).toBe("mail.acme.com");
    expect(normalizeSendingDomain("mail.acme.com.")).toBe("mail.acme.com");
  });

  it("rejects things that are not domains", () => {
    expect(normalizeSendingDomain("")).toBeNull();
    expect(normalizeSendingDomain("localhost")).toBeNull();
    expect(normalizeSendingDomain("no spaces.com")).toBeNull();
    expect(normalizeSendingDomain("-bad.com")).toBeNull();
    expect(normalizeSendingDomain("acme")).toBeNull();
  });

  it("knows a subdomain from a root domain", () => {
    expect(isSubdomain("mail.acme.com")).toBe(true);
    expect(isSubdomain("acme.com")).toBe(false);
  });

  it("bounds the local part to what the CHECK allows", () => {
    expect(normalizeLocalPart("Notifications")).toBe("notifications");
    expect(normalizeLocalPart("no-reply.2")).toBe("no-reply.2");
    expect(normalizeLocalPart("has space")).toBeNull();
    expect(normalizeLocalPart("")).toBeNull();
    expect(normalizeLocalPart("a".repeat(80))).toBeNull();
  });

  it("does a cheap sanity check on addresses", () => {
    expect(looksLikeEmail("dan@acme.com")).toBe(true);
    expect(looksLikeEmail("dan@acme")).toBe(false);
    expect(looksLikeEmail("two@@acme.com")).toBe(false);
    expect(looksLikeEmail("with space@acme.com")).toBe(false);
    expect(looksLikeEmail('"quoted"@acme.com')).toBe(false);
    expect(emailDomainOf("Dan@Acme.COM")).toBe("acme.com");
  });
});

/**
 * The guard that stands between a local test run and a real client's inbox.
 * Everything else in this file is correctness; this one is damage control.
 */
describe("dev-environment guard", () => {
  it("rewrites every recipient outside production and shows the real one", () => {
    const result = applyDevGuard("client@realcompany.com", "Your invoice", {
      nodeEnv: "development",
      redirect: "me@example.com",
    });
    expect(result).toEqual({
      to: "me@example.com",
      subject: "[dev -> client@realcompany.com] Your invoice",
    });
  });

  // Fail closed. A missing redirect must not mean "send it for real".
  it("refuses to send at all when the redirect is missing outside production", () => {
    const result = applyDevGuard("client@realcompany.com", "Your invoice", {
      nodeEnv: "development",
      redirect: undefined,
    });
    expect(result).toHaveProperty("blocked");
    expect("to" in result).toBe(false);
  });

  it("passes through untouched in real production", () => {
    const result = applyDevGuard("client@realcompany.com", "Your invoice", {
      vercelEnv: "production",
      nodeEnv: "production",
      redirect: undefined,
    });
    expect(result).toEqual({
      to: "client@realcompany.com",
      subject: "Your invoice",
    });
  });

  /**
   * The case that makes VERCEL_ENV necessary: Vercel builds previews with
   * NODE_ENV=production, so keying on NODE_ENV alone would let a branch
   * preview mail real customers.
   */
  it("redirects on a Vercel preview even though NODE_ENV says production", () => {
    const result = applyDevGuard("client@realcompany.com", "Your invoice", {
      vercelEnv: "preview",
      nodeEnv: "production",
      redirect: "me@example.com",
    });
    expect(result).toMatchObject({ to: "me@example.com" });
  });

  it("refuses on a preview with no redirect configured", () => {
    const result = applyDevGuard("client@realcompany.com", "x", {
      vercelEnv: "preview",
      nodeEnv: "production",
      redirect: undefined,
    });
    expect(result).toHaveProperty("blocked");
  });

  it("treats test runs as non-production", () => {
    const result = applyDevGuard("client@realcompany.com", "x", {
      nodeEnv: "test",
      redirect: "me@example.com",
    });
    expect(result).toMatchObject({ to: "me@example.com" });
  });

  it("falls back to NODE_ENV when not on Vercel", () => {
    expect(isLiveSendEnvironment({ nodeEnv: "production" })).toBe(true);
    expect(isLiveSendEnvironment({ nodeEnv: "development" })).toBe(false);
    // VERCEL_ENV wins whenever it is present.
    expect(
      isLiveSendEnvironment({ vercelEnv: "preview", nodeEnv: "production" }),
    ).toBe(false);
  });
});

d("email domains and send log (database)", () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Email Co", slug: STAMP })
        .returning();
      return row.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("a member can read the send log but never write it", async () => {
    await withSystem((tx) =>
      tx.insert(schema.outboundEmails).values({
        tenantId,
        kind: "share_link",
        toAddress: "sub@example.com",
        toDomain: "example.com",
        subject: "Drawings",
        fromAddress: "notifications@mail.yosherapp.com",
        idempotencyKey: `k-${STAMP}-1`,
        status: "sent",
      }),
    );

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.outboundEmails),
    );
    expect(rows).toHaveLength(1);

    // A forgeable "delivered" is worse than no log at all.
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.outboundEmails).values({
          tenantId,
          kind: "invoice",
          toAddress: "forged@example.com",
          idempotencyKey: `k-${STAMP}-forged`,
        }),
      ),
    ).rejects.toThrow();

    const updated = await withTenant(tenantId, (tx) =>
      tx
        .update(schema.outboundEmails)
        .set({ status: "delivered" })
        .where(eq(schema.outboundEmails.tenantId, tenantId))
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("the same idempotency key cannot produce a second email", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.outboundEmails).values({
          tenantId,
          kind: "share_link",
          toAddress: "sub@example.com",
          idempotencyKey: `k-${STAMP}-1`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a member cannot mark their own domain verified", async () => {
    await withSystem((tx) =>
      tx.insert(schema.emailDomains).values({
        tenantId,
        domain: `mail.${STAMP}.example.com`,
        providerDomainId: "prov_1",
        status: "pending",
      }),
    );

    const readable = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.emailDomains),
    );
    expect(readable).toHaveLength(1);
    expect(readable[0].status).toBe("pending");

    // The whole point: claiming a domain must be the provider's word.
    const updated = await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.emailDomains)
          .set({ status: "verified" })
          .where(eq(schema.emailDomains.tenantId, tenantId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);
  });

  it("two tenants cannot claim the same sending domain", async () => {
    const otherId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-2`,
          name: "Other Co",
          slug: `${STAMP}-2`,
        })
        .returning();
      return row.id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.emailDomains).values({
          tenantId: otherId,
          domain: `mail.${STAMP}.example.com`,
          status: "pending",
        }),
      ),
    ).rejects.toThrow();
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, otherId)),
    );
  });

  it("rejects a status the app does not understand", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.outboundEmails).values({
          tenantId,
          kind: "invoice",
          toAddress: "x@example.com",
          idempotencyKey: `k-${STAMP}-bad-status`,
          status: "teleported",
        }),
      ),
    ).rejects.toThrow();
  });
});
