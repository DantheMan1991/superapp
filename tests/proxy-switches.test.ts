import { describe, expect, it } from "vitest";
import { authorizedPartiesFromEnv } from "@/lib/authorized-parties";
import {
  isMaintenanceExempt,
  MAINTENANCE_HTML,
  maintenanceModeFromEnv,
  shouldServeMaintenance,
} from "@/lib/maintenance";

/**
 * The two environment switches the proxy reads on every request. Both are
 * pure so that "would this lock everyone out" is a test, not a deploy.
 */

describe("maintenance mode", () => {
  it("is off unless the switch is clearly on", () => {
    expect(maintenanceModeFromEnv({})).toBe(false);
    expect(maintenanceModeFromEnv({ MAINTENANCE_MODE: "" })).toBe(false);
    expect(maintenanceModeFromEnv({ MAINTENANCE_MODE: "0" })).toBe(false);
    expect(maintenanceModeFromEnv({ MAINTENANCE_MODE: "false" })).toBe(false);
    expect(maintenanceModeFromEnv({ MAINTENANCE_MODE: "soon" })).toBe(false);
  });

  it("accepts the obvious spellings of on", () => {
    for (const value of ["1", "true", "ON", " yes "]) {
      expect(maintenanceModeFromEnv({ MAINTENANCE_MODE: value })).toBe(true);
    }
  });

  it("keeps the machine callers open and closes everything else", () => {
    for (const open of [
      "/api/webhooks/clerk",
      "/api/webhooks/stripe/connect",
      "/api/cron/digest",
      "/api/inbound/resend",
      "/api/email/events",
    ]) {
      expect(isMaintenanceExempt(open)).toBe(true);
    }
    for (const closed of ["/", "/dashboard", "/onboarding", "/sign-in", "/api/mail/img", "/s/token"]) {
      expect(isMaintenanceExempt(closed)).toBe(false);
    }
  });

  it("serves the page only when on and not exempt", () => {
    expect(shouldServeMaintenance("/dashboard", { MAINTENANCE_MODE: "1" })).toBe(true);
    expect(shouldServeMaintenance("/api/webhooks/clerk", { MAINTENANCE_MODE: "1" })).toBe(false);
    expect(shouldServeMaintenance("/dashboard", {})).toBe(false);
  });

  it("depends on nothing that could itself be down", () => {
    expect(MAINTENANCE_HTML).not.toMatch(/<script|<link|src=/);
    expect(MAINTENANCE_HTML).toContain("noindex");
  });
});

describe("authorizedParties", () => {
  const live = "pk_live_abc";

  it("does not check at all on a development instance or without a key", () => {
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc",
        NEXT_PUBLIC_APP_URL: "https://yosherapp.com",
      }),
    ).toBeUndefined();
    expect(authorizedPartiesFromEnv({ NEXT_PUBLIC_APP_URL: "https://yosherapp.com" })).toBeUndefined();
  });

  it("allows the app origin and its www twin on a production instance", () => {
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
        NEXT_PUBLIC_APP_URL: "https://yosherapp.com/",
      }),
    ).toEqual(["https://yosherapp.com", "https://www.yosherapp.com"]);
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
        NEXT_PUBLIC_APP_URL: "https://www.yosherapp.com",
      }),
    ).toEqual(["https://www.yosherapp.com", "https://yosherapp.com"]);
  });

  it("gives no twin to a port, a deeper subdomain or a single label", () => {
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toEqual(["http://localhost:3000"]);
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
        NEXT_PUBLIC_APP_URL: "https://app.yosher.farm",
      }),
    ).toEqual(["https://app.yosher.farm"]);
  });

  it("adds the deployment's own Vercel hosts, which arrive without a scheme", () => {
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
        NEXT_PUBLIC_APP_URL: "https://yosherapp.com",
        VERCEL_URL: "superapp-abc123.vercel.app",
        VERCEL_BRANCH_URL: "superapp-git-main.vercel.app",
      }),
    ).toEqual([
      "https://yosherapp.com",
      "https://www.yosherapp.com",
      "https://superapp-abc123.vercel.app",
      "https://superapp-git-main.vercel.app",
    ]);
  });

  it("ignores a malformed app URL and never returns an empty list", () => {
    expect(
      authorizedPartiesFromEnv({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live,
        NEXT_PUBLIC_APP_URL: "yosherapp",
        VERCEL_URL: "superapp.vercel.app",
      }),
    ).toEqual(["https://superapp.vercel.app"]);
    expect(
      authorizedPartiesFromEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: live, NEXT_PUBLIC_APP_URL: "::" }),
    ).toBeUndefined();
  });
});
