import { describe, expect, it } from "vitest";
import { isPublicAddress, validateHopUrl } from "@/lib/net/ssrf";

/**
 * SSRF guards for the mail image proxy.
 *
 * Pure, so every range boundary is exercised without a network — which matters
 * more here than almost anywhere else, because the failure mode is silent: a
 * wrong range does not throw, it just lets an anonymous sender aim our server
 * at something internal.
 *
 * The boundary cases are deliberate. Off-by-one on a CIDR is the mistake this
 * kind of code actually makes, so each blocked range is tested at the address
 * just below it, at both edges, and just above.
 */

describe("isPublicAddress — IPv4", () => {
  it("accepts ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "203.0.114.1"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("blocks loopback, private and link-local", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "0.0.0.0",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("blocks the cloud metadata address specifically", () => {
    // The single most valuable target on this list: it hands out credentials.
    expect(isPublicAddress("169.254.169.254")).toBe(false);
  });

  it("gets the CIDR boundaries exactly right", () => {
    const table: Array<[string, boolean]> = [
      ["9.255.255.255", true], // just below 10/8
      ["10.0.0.0", false],
      ["10.255.255.255", false],
      ["11.0.0.0", true], // just above
      ["172.15.255.255", true], // just below 172.16/12
      ["172.16.0.0", false],
      ["172.31.255.255", false],
      ["172.32.0.0", true], // just above
      ["192.167.255.255", true],
      ["192.168.0.0", false],
      ["192.168.255.255", false],
      ["192.169.0.0", true],
      ["100.63.255.255", true], // just below CGNAT 100.64/10
      ["100.64.0.0", false],
      ["100.127.255.255", false],
      ["100.128.0.0", true],
    ];
    for (const [ip, expected] of table) {
      expect(isPublicAddress(ip), ip).toBe(expected);
    }
  });

  it("blocks multicast, reserved and broadcast", () => {
    for (const ip of ["224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("refuses non-canonical spellings rather than resolving them", () => {
    // 2130706433, 0x7f000001, 017700000001 and 127.1 are all 127.0.0.1 to the
    // operating system. Refusing to parse them is safer than decoding them.
    for (const ip of ["2130706433", "0x7f000001", "017700000001", "127.1", "127.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("isPublicAddress — IPv6", () => {
  it("accepts a public v6 address", () => {
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("blocks loopback, unspecified, unique-local, link-local and multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("blocks the documentation range", () => {
    expect(isPublicAddress("2001:db8::1")).toBe(false);
  });

  /**
   * The three that get missed. Each carries an IPv4 address inside an IPv6
   * one, so a checker that treats the families separately lets them through.
   */
  it("decodes IPv4-mapped addresses and re-checks them as IPv4", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it("decodes NAT64 addresses", () => {
    expect(isPublicAddress("64:ff9b::127.0.0.1")).toBe(false);
    expect(isPublicAddress("64:ff9b::8.8.8.8")).toBe(true);
  });

  it("decodes 6to4 addresses", () => {
    // 2002:7f00:0001:: embeds 127.0.0.1
    expect(isPublicAddress("2002:7f00:1::")).toBe(false);
    expect(isPublicAddress("2002:0808:0808::")).toBe(true);
  });

  it("ignores a zone id rather than being confused by it", () => {
    expect(isPublicAddress("fe80::1%eth0")).toBe(false);
  });

  it("treats an unparseable address as unsafe", () => {
    for (const ip of ["", "nonsense", "12345::::1", ":::"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("validateHopUrl", () => {
  it("accepts ordinary image URLs", () => {
    for (const url of [
      "https://cdn.example.com/logo.png",
      "http://images.example.com:80/a.gif",
      "https://example.com:443/b.jpg?v=2",
    ]) {
      expect(validateHopUrl(url).ok, url).toBe(true);
    }
  });

  it("refuses every scheme that is not http(s)", () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/x.png",
      "data:image/png;base64,AAAA",
      "blob:https://example.com/x",
      "jar:http://example.com/!/x",
      "dict://example.com/",
    ]) {
      const result = validateHopUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it("refuses credentials embedded in the URL", () => {
    expect(validateHopUrl("http://user:pass@example.com/x.png")).toMatchObject({
      ok: false,
      reason: "credentials",
    });
  });

  it("refuses any port that is not 80 or 443", () => {
    // This alone removes Postgres, Redis, SSH, Elasticsearch and every dev
    // server from the attack surface.
    for (const port of [22, 5432, 6379, 8080, 9200, 3000, 25]) {
      const result = validateHopUrl(`http://example.com:${port}/x.png`);
      expect(result.ok, String(port)).toBe(false);
      expect(result.reason).toBe("port");
    }
  });

  it("refuses private hosts given as literals", () => {
    for (const url of [
      "http://127.0.0.1/x.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/x.png",
      "http://[fd00::1]/x.png",
      "http://10.0.0.1/x.png",
      "http://[::ffff:127.0.0.1]/x.png",
    ]) {
      const result = validateHopUrl(url);
      expect(result.ok, url).toBe(false);
      expect(result.reason, url).toBe("private");
    }
  });

  it("refuses integer and hex spellings of an address", () => {
    for (const url of ["http://2130706433/x.png", "http://0x7f000001/x.png"]) {
      expect(validateHopUrl(url).ok, url).toBe(false);
    }
  });

  it("refuses a URL long enough to be pathological", () => {
    const long = `https://example.com/${"a".repeat(4000)}.png`;
    expect(validateHopUrl(long)).toMatchObject({ ok: false, reason: "length" });
  });

  it("allows a hostname through — DNS is checked at connect time, not here", () => {
    // The rebinding window is closed by resolving and connecting to the same
    // address in fetch-image.ts. This function cannot close it alone, and it is
    // important that it does not pretend to.
    expect(validateHopUrl("https://localhost/x.png").ok).toBe(true);
  });
});
