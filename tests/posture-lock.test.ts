import { describe, expect, it } from "vitest";
import {
  clerkFrontendApi,
  fetchedByScript,
  isPosturePath,
  lockCrossing,
  lockCsp,
  lockedArea,
  newNonce,
  postureCrossing,
  postureCsp,
  sameSitePath,
} from "@/lib/posture-lock";

/**
 * THE POSTURE PAGES' LOCK (src/lib/posture-lock.ts, ADR 0122): which pages it
 * covers, the policy itself, and what the proxy does at the pages' edge. The
 * drive proved the browser holds to it; this proves the rules say what the
 * ADR says.
 */

/** A policy as directive name to its sources. */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...sources] = part.split(" ");
      return [name, sources];
    }),
  );
}

const PROD_KEY = "pk_live_Y2xlcmsueW9zaGVyYXBwLmNvbSQ"; // clerk.yosherapp.com$, from the live sign-in page

describe("the posture pages", () => {
  it("are the posture check's page and everything under it", () => {
    for (const path of [
      "/personal/m/fitness/posture",
      "/personal/m/fitness/posture/check",
      "/personal/m/fitness/posture/setup",
      "/personal/m/fitness/posture/checks/11eaabf7-f067-4673-b865-ef9a911eebbe",
      "/personal/m/fitness/posture/export",
    ]) {
      expect(isPosturePath(path), path).toBe(true);
    }
    for (const path of ["/personal/m/fitness", "/personal/m/fitness/posture-notes", "/personal", "/dashboard", "/"]) {
      expect(isPosturePath(path), path).toBe(false);
    }
  });
});

describe("Clerk's address", () => {
  it("is read from the publishable key the page signs in with", () => {
    expect(clerkFrontendApi(PROD_KEY)).toBe("clerk.yosherapp.com");
    expect(clerkFrontendApi("pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk")).toBe("example.clerk.accounts.dev");
  });

  it("is nothing for anything that is not a publishable key naming a host", () => {
    for (const key of [
      undefined,
      "",
      "xk_live_Y2xlcmsueW9zaGVyYXBwLmNvbSQ", // the right host, but not a publishable key's prefix
      "pk_live_!!!",
      `pk_live_${btoa("clerk.yosherapp.com")}`, // no $ after the host
      `pk_live_${btoa("a b.example$")}`,
      `pk_live_${btoa("javascript:alert(1)$")}`,
      `pk_live_${btoa("localhost$")}`, // not a dotted host
    ]) {
      expect(clerkFrontendApi(key), String(key)).toBeNull();
    }
  });
});

describe("the policy", () => {
  const prod = parse(postureCsp({ nonce: "abc123", clerk: "clerk.yosherapp.com", devSocket: null }));

  it("lets the page reach this site and Clerk, and nothing else", () => {
    expect(prod["connect-src"]).toEqual(["'self'", "https://clerk.yosherapp.com"]);
    expect(prod["default-src"]).toEqual(["'self'"]);
    expect(prod["img-src"]).toEqual(["'self'", "blob:", "data:", "https://img.clerk.com"]);
    expect(prod["font-src"]).toEqual(["'self'", "data:"]);
    expect(prod["media-src"]).toEqual(["'self'", "blob:"]);
    expect(prod["form-action"]).toEqual(["'self'"]);
  });

  it("runs only the page's own scripts, Clerk's, and the pose model's WebAssembly", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'wasm-unsafe-eval'", "https://clerk.yosherapp.com"]);
    expect(prod["script-src"]).not.toContain("'unsafe-inline'");
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    // The worker starts from a blob, to be held to this policy (client/blob-worker.ts).
    expect(prod["worker-src"]).toEqual(["'self'", "blob:"]);
  });

  it("allows no frames, no plugins, and no other site framing the page", () => {
    expect(prod["frame-src"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
  });

  it("names no other server at all", () => {
    const everything = Object.values(prod).flat().filter((s) => s.startsWith("http") || s.startsWith("ws"));
    expect(everything.every((s) => s === "https://clerk.yosherapp.com" || s === "https://img.clerk.com")).toBe(true);
  });

  it("adds only what the dev server needs, in development", () => {
    const dev = parse(postureCsp({ nonce: "n", clerk: "example.clerk.accounts.dev", devSocket: "ws://localhost:3100" }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toEqual([
      "'self'",
      "https://example.clerk.accounts.dev",
      "ws://localhost:3100",
      "https://clerk-telemetry.com",
    ]);
  });

  it("leaves Clerk out when there is no key to read it from", () => {
    const none = parse(postureCsp({ nonce: "n", clerk: null, devSocket: null }));
    expect(none["connect-src"]).toEqual(["'self'"]);
    expect(none["script-src"]).toEqual(["'self'", "'nonce-n'", "'wasm-unsafe-eval'"]);
  });

  it("gets a fresh nonce every page load", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe("the pages' edge", () => {
  const posture = "/personal/m/fitness/posture";
  const workouts = "/personal/m/fitness";
  const go = (pathname: string, fromPath: string | null, fetched = true, method = "GET") =>
    postureCrossing({ pathname, method, fetched, fromPath });

  it("locks a page load of a posture page, and only that", () => {
    expect(go(posture, null, false)).toBe("lock");
    expect(go(`${posture}/check`, workouts, false)).toBe("lock");
    expect(go(`${posture}/check`, null, false, "HEAD")).toBe("lock");
    // A server action posts to the page it is on; it renders no page.
    expect(go(`${posture}/check`, `${posture}/check`, false, "POST")).toBe("pass");
    expect(go(workouts, posture, false)).toBe("pass");
  });

  it("turns the router crossing the edge, either way, into a full page load", () => {
    expect(go(posture, workouts)).toBe("full-load");
    expect(go(workouts, `${posture}/checks/x`)).toBe("full-load");
    expect(go("/dashboard", `${posture}/check`)).toBe("full-load");
  });

  it("lets the router move freely on either side", () => {
    expect(go(`${posture}/check`, posture)).toBe("pass");
    expect(go(posture, `${posture}/checks/x`)).toBe("pass");
    expect(go(workouts, "/personal")).toBe("pass");
  });

  it("passes the router when the browser did not say where it came from: the guard catches that", () => {
    expect(go(posture, null)).toBe("pass");
    expect(go(workouts, null)).toBe("pass");
  });

  it("never takes a posture page's own fetches for a crossing: an API, or a post", () => {
    // The coach's voice clips, fetched while a check runs.
    expect(go("/api/fitness/voice", `${posture}/check`)).toBe("pass");
    expect(go(workouts, posture, true, "POST")).toBe("pass");
  });

  it("tells a script's fetch from a page load by what the browser says, Next's header only without it", () => {
    expect(fetchedByScript("empty", null)).toBe(true);
    expect(fetchedByScript("document", null)).toBe(false);
    // In production Next hides `rsc` from the proxy; where the browser does speak, its word wins.
    expect(fetchedByScript("document", "1")).toBe(false);
    expect(fetchedByScript(null, "1")).toBe(true);
    expect(fetchedByScript(null, null)).toBe(false);
  });

  it("believes only a referrer from this site, by the request's own host", () => {
    expect(sameSitePath("https://yosherapp.com/personal/m/fitness/posture?x=1", "yosherapp.com")).toBe(posture);
    expect(sameSitePath("http://localhost:3100/personal/m/fitness", "localhost:3100")).toBe(workouts);
    expect(sameSitePath("http://localhost:3000/personal/m/fitness", "localhost:3100")).toBeNull();
    expect(sameSitePath("https://evil.example/personal/m/fitness/posture", "yosherapp.com")).toBeNull();
    expect(sameSitePath("not a url", "yosherapp.com")).toBeNull();
    expect(sameSitePath(null, "yosherapp.com")).toBeNull();
  });
});

describe("Health's progress photos, under the same lock (ADR 0128)", () => {
  const photos = "/personal/m/health/photos";
  const health = "/personal/m/health";
  const posture = "/personal/m/fitness/posture";
  const go = (pathname: string, fromPath: string | null, fetched = true, method = "GET") =>
    lockCrossing({ pathname, method, fetched, fromPath });

  it("are the photos' own page and everything under it, an area of their own", () => {
    for (const path of [photos, `${photos}/take`]) expect(lockedArea(path), path).toBe("health-photos");
    for (const path of [health, `${health}/body`, `${health}/photos-notes`, `${health}/progress`]) {
      expect(lockedArea(path), path).toBeNull();
    }
    expect(lockedArea(`${posture}/check`)).toBe("posture");
    expect(isPosturePath(`${photos}/take`)).toBe(false);
  });

  it("get the posture pages' policy without WebAssembly, which they never run", () => {
    const policy = parse(lockCsp({ nonce: "n", clerk: "clerk.yosherapp.com", devSocket: null, area: "health-photos" }));
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-n'", "https://clerk.yosherapp.com"]);
    expect(policy["connect-src"]).toEqual(["'self'", "https://clerk.yosherapp.com"]);
    expect(policy["img-src"]).toEqual(["'self'", "blob:", "data:", "https://img.clerk.com"]);
    expect(policy["frame-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    // The posture pages keep theirs.
    expect(parse(postureCsp({ nonce: "n", clerk: null, devSocket: null }))["script-src"]).toContain("'wasm-unsafe-eval'");
  });

  it("are locked on a page load, loaded whole across their edge, and free between their own pages", () => {
    expect(go(photos, null, false)).toBe("lock");
    expect(go(`${photos}/take`, `${health}/body`, false)).toBe("lock");
    expect(go(photos, `${health}/body`)).toBe("full-load");
    expect(go(`${health}/body`, photos)).toBe("full-load");
    expect(go(`${photos}/take`, photos)).toBe("pass");
    expect(go(photos, `${photos}/take`)).toBe("pass");
    // Two locked areas have two policies: between them is a crossing too.
    expect(go(photos, `${posture}/check`)).toBe("full-load");
    expect(go(posture, `${photos}/take`)).toBe("full-load");
    // The countdown's voice is an API on this site, not a crossing.
    expect(go("/api/health/voice", `${photos}/take`)).toBe("pass");
  });

  it("keep ADR 0122's name for the crossing", () => {
    expect(postureCrossing).toBe(lockCrossing);
  });
});
