import { describe, expect, it } from "vitest";
import {
  decideSupportView,
  SUPPORT_SESSION_MINUTES,
  supportExpiry,
} from "../src/lib/support-view-decide";

/**
 * The wall of the support view (back-office slice 4), pure: a live session is
 * honoured for a GET and for nothing else.
 */
describe("decideSupportView", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const live = { expiresAt: new Date("2026-09-10T12:30:00Z"), endedAt: null };
  const get = { method: "GET", isAction: false, now };

  it("is nothing without a session, after expiry, or once ended", () => {
    expect(decideSupportView(null, get)).toEqual({ kind: "none" });
    expect(
      decideSupportView({ expiresAt: new Date("2026-09-10T11:59:59Z"), endedAt: null }, get),
    ).toEqual({ kind: "none" });
    expect(
      decideSupportView({ ...live, endedAt: new Date("2026-09-10T11:50:00Z") }, get),
    ).toEqual({ kind: "none" });
  });

  it("answers a GET or a HEAD as a view", () => {
    expect(decideSupportView(live, get)).toEqual({ kind: "view" });
    expect(decideSupportView(live, { ...get, method: "HEAD" })).toEqual({ kind: "view" });
  });

  it("refuses a server action even on a GET, and refuses every other method", () => {
    expect(decideSupportView(live, { ...get, isAction: true })).toEqual({
      kind: "refuse",
      reason: "action",
    });
    for (const method of ["POST", "PUT", "PATCH", "DELETE", ""]) {
      expect(decideSupportView(live, { ...get, method })).toEqual({
        kind: "refuse",
        reason: "method",
      });
    }
  });

  it("an unstamped method reads as not-a-GET", () => {
    // The middleware did not run: the safe way round is to refuse.
    expect(decideSupportView(live, { ...get, method: "" }).kind).toBe("refuse");
  });

  it("expires an hour after it opens", () => {
    expect(supportExpiry(now).getTime() - now.getTime()).toBe(SUPPORT_SESSION_MINUTES * 60_000);
  });
});
