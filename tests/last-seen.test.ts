import { describe, expect, it } from "vitest";
import { describeAgo, isQuiet, shouldStampSeen } from "../src/lib/last-seen";

const now = new Date("2026-09-10T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("shouldStampSeen", () => {
  it("stamps a never-seen member, and one an hour or more stale", () => {
    expect(shouldStampSeen(null, now)).toBe(true);
    expect(shouldStampSeen(ago(60), now)).toBe(true);
    expect(shouldStampSeen(ago(600), now)).toBe(true);
  });
  it("leaves a fresh stamp alone", () => {
    expect(shouldStampSeen(ago(1), now)).toBe(false);
    expect(shouldStampSeen(ago(59), now)).toBe(false);
  });
});

describe("describeAgo", () => {
  it("reads at a glance", () => {
    expect(describeAgo(null, now)).toBe("never");
    expect(describeAgo(ago(0), now)).toBe("just now");
    expect(describeAgo(ago(5), now)).toBe("5 min ago");
    expect(describeAgo(ago(180), now)).toBe("3 h ago");
    expect(describeAgo(ago(60 * 24 * 4), now)).toBe("4 d ago");
    expect(describeAgo(ago(60 * 24 * 95), now)).toBe("3 mo ago");
  });
});

describe("isQuiet", () => {
  it("is quiet with no sign of life, or none for thirty days", () => {
    expect(isQuiet(null, null, now)).toBe(true);
    expect(isQuiet(ago(60 * 24 * 31), null, now)).toBe(true);
    expect(isQuiet(null, ago(60 * 24 * 40), now)).toBe(true);
  });
  it("is not quiet when either signal is recent", () => {
    expect(isQuiet(ago(60), null, now)).toBe(false);
    expect(isQuiet(ago(60 * 24 * 40), ago(60 * 24 * 2), now)).toBe(false);
  });
});
