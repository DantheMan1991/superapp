import { describe, expect, it } from "vitest";
import {
  FALLBACK_CNAME,
  FALLBACK_IPV4,
  dnsInstructions,
  domainStatusFrom,
  domainStatusLine,
  isApexDomain,
  normalizeDomain,
  readDomainRecords,
} from "../src/lib/sites/domains";
import { classifyHost, platformHostsFromEnv } from "../src/lib/sites/slug";
import { DomainConfigSchema, ProjectDomainSchema } from "../src/lib/vercel/domains";

const env = { platformHosts: ["localhost", "127.0.0.1", "yosherapp.com"], siteDomain: "yosher.site" };

describe("normalizeDomain", () => {
  it("cleans what people paste and says whether it is an apex", () => {
    expect(normalizeDomain("https://WWW.OakRowFarm.com/about", env)).toEqual({ ok: true, domain: "www.oakrowfarm.com", apex: false });
    expect(normalizeDomain("oakrowfarm.com.", env)).toEqual({ ok: true, domain: "oakrowfarm.com", apex: true });
    expect(normalizeDomain("shop.oakrowfarm.co.uk:443", env)).toEqual({ ok: true, domain: "shop.oakrowfarm.co.uk", apex: false });
  });

  it("refuses what cannot be connected", () => {
    expect(normalizeDomain("", env)).toEqual({ ok: false, reason: "empty" });
    expect(normalizeDomain("oakrow", env)).toEqual({ ok: false, reason: "shape" });
    expect(normalizeDomain("76.76.21.21", env)).toEqual({ ok: false, reason: "ip" });
    expect(normalizeDomain("*.oakrowfarm.com", env)).toEqual({ ok: false, reason: "wildcard" });
    expect(normalizeDomain("yosherapp.com", env)).toEqual({ ok: false, reason: "platform" });
    expect(normalizeDomain("app.yosherapp.com", env)).toEqual({ ok: false, reason: "platform" });
    expect(normalizeDomain("oak.yosher.site", env)).toEqual({ ok: false, reason: "platform" });
    expect(normalizeDomain("thing.vercel.app", env)).toEqual({ ok: false, reason: "platform" });
    expect(normalizeDomain("-bad-.example.com", env)).toEqual({ ok: false, reason: "shape" });
  });

  it("treats two labels as an apex and more as a subdomain", () => {
    expect(isApexDomain("example.com")).toBe(true);
    expect(isApexDomain("www.example.com")).toBe(false);
  });
});

describe("dnsInstructions", () => {
  const base = { verified: true, verification: [], misconfigured: true, recommendedCNAME: [], recommendedIPv4: [] };

  it("gives an apex an A record with Vercel's preferred address, or the documented fallback", () => {
    const withRec = dnsInstructions("example.com", {
      ...base,
      recommendedIPv4: [{ rank: 2, value: ["1.1.1.1"] }, { rank: 1, value: ["216.198.79.1"] }],
    });
    expect(withRec).toEqual([{ type: "A", name: "example.com", value: "216.198.79.1", purpose: "Points the domain at your site." }]);
    expect(dnsInstructions("example.com", base)[0].value).toBe(FALLBACK_IPV4);
  });

  it("gives a subdomain a CNAME, and puts the ownership TXT first while unverified", () => {
    const records = dnsInstructions("www.example.com", {
      ...base,
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=abc" }],
      recommendedCNAME: [{ rank: 1, value: "d1d4fc829fe7bc7c.vercel-dns-017.com" }],
    });
    expect(records.map((r) => r.type)).toEqual(["TXT", "CNAME"]);
    expect(records[0]).toMatchObject({ name: "_vercel.example.com", value: "vc-domain-verify=abc" });
    expect(records[1].value).toBe("d1d4fc829fe7bc7c.vercel-dns-017.com");
    expect(dnsInstructions("www.example.com", base)[0].value).toBe(FALLBACK_CNAME);
  });

  it("is active only when verified and correctly configured, and explains the wait", () => {
    expect(domainStatusFrom({ verified: true, misconfigured: false })).toBe("active");
    expect(domainStatusFrom({ verified: true, misconfigured: true })).toBe("pending");
    expect(domainStatusFrom({ verified: false, misconfigured: false })).toBe("pending");
    expect(domainStatusLine({ status: "pending", vercelVerified: false, vercelConfiguredBy: "", lastError: "" })).toMatch(/TXT/);
    expect(domainStatusLine({ status: "pending", vercelVerified: true, vercelConfiguredBy: "", lastError: "" })).toMatch(/points the domain/);
    expect(domainStatusLine({ status: "active", vercelVerified: true, vercelConfiguredBy: "CNAME", lastError: "" })).toMatch(/Live/);
    expect(domainStatusLine({ status: "error", vercelVerified: false, vercelConfiguredBy: "", lastError: "Gone." })).toBe("Gone.");
  });

  it("reads a stored records blob and drops what is not a record", () => {
    expect(readDomainRecords([{ type: "A", name: "x.com", value: "1.2.3.4", purpose: "" }, { type: "MX" }, "junk"])).toHaveLength(1);
    expect(readDomainRecords(null)).toEqual([]);
  });
});

describe("classifyHost", () => {
  const opts = { siteDomain: "yosher.site", platformHosts: platformHostsFromEnv({ NEXT_PUBLIC_APP_URL: "https://yosherapp.com" }) };

  it("keeps the platform's own hosts", () => {
    for (const host of ["yosherapp.com", "www.yosherapp.com", "localhost:3000", "127.0.0.1", "superapp-git-x.vercel.app", "yosher.site", "www.yosher.site", "a.b.yosher.site"]) {
      expect(classifyHost(host, opts)).toEqual({ kind: "platform" });
    }
  });

  it("names a site's free address and a connected domain", () => {
    expect(classifyHost("oak-row.yosher.site", opts)).toEqual({ kind: "site", slug: "oak-row" });
    expect(classifyHost("WWW.OakRowFarm.com:443", opts)).toEqual({ kind: "custom", host: "www.oakrowfarm.com" });
    expect(classifyHost("oakrowfarm.com", opts)).toEqual({ kind: "custom", host: "oakrowfarm.com" });
    expect(classifyHost("", opts)).toEqual({ kind: "platform" });
    expect(classifyHost("justaword", opts)).toEqual({ kind: "platform" });
  });

  it("lets a site's free address win over a platform host's subdomains, which on a laptop are the same names", () => {
    const local = { siteDomain: "localhost", platformHosts: platformHostsFromEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }) };
    expect(classifyHost("oak-row-farm.localhost:3000", local)).toEqual({ kind: "site", slug: "oak-row-farm" });
    expect(classifyHost("localhost:3000", local)).toEqual({ kind: "platform" });
    expect(classifyHost("www.localhost:3000", local)).toEqual({ kind: "platform" });
    // In production the platform's own subdomains stay its own.
    expect(classifyHost("www.yosherapp.com", opts)).toEqual({ kind: "platform" });
    expect(classifyHost("preview-x.vercel.app", opts)).toEqual({ kind: "platform" });
  });

  it("reads the platform hosts from the app url and never fails on a bad one", () => {
    expect(platformHostsFromEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toEqual(["localhost", "127.0.0.1", "localhost"]);
    expect(platformHostsFromEnv({ NEXT_PUBLIC_APP_URL: "not a url" })).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("Vercel's answers", () => {
  it("parse the documented shapes and tolerate what is missing", () => {
    expect(
      ProjectDomainSchema.parse({ name: "www.example.com", apexName: "example.com", projectId: "prj", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=x", reason: "pending_domain" }] }).verification,
    ).toHaveLength(1);
    expect(ProjectDomainSchema.parse({ name: "x.com", apexName: "x.com", verified: true }).verification).toEqual([]);
    const config = DomainConfigSchema.parse({ configuredBy: null, misconfigured: true, acceptedChallenges: ["http-01"], recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }], recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }] });
    expect(config.configuredBy).toBeNull();
    expect(DomainConfigSchema.safeParse({ configuredBy: "MX", misconfigured: false }).success).toBe(false);
  });
});
