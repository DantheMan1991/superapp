import { describe, expect, it } from "vitest";
import {
  MAX_PIN_FAILURES,
  PIN_LOCKOUT_MINUTES,
  isPin,
  isPinLocked,
  isWeakPin,
  lockoutRemaining,
  pinLockedUntil,
} from "@/modules/time/core/pin";

const at = (iso: string) => new Date(iso);

describe("isPin", () => {
  it("takes four to eight digits", () => {
    expect(isPin("4821")).toBe(true);
    expect(isPin("48210000")).toBe(true);
  });

  it("refuses anything a numeric keypad cannot produce", () => {
    expect(isPin("48a1")).toBe(false);
    expect(isPin("48 21")).toBe(false);
    expect(isPin("")).toBe(false);
  });

  it("refuses too short and too long", () => {
    expect(isPin("482")).toBe(false);
    expect(isPin("482100001")).toBe(false);
  });
});

describe("isWeakPin", () => {
  it("catches the ones everybody picks", () => {
    expect(isWeakPin("0000")).toBe(true);
    expect(isWeakPin("7777")).toBe(true);
    expect(isWeakPin("1234")).toBe(true);
    expect(isWeakPin("4321")).toBe(true);
    expect(isWeakPin("12345678")).toBe(true);
  });

  it("leaves an ordinary PIN alone", () => {
    expect(isWeakPin("4821")).toBe(false);
    expect(isWeakPin("1235")).toBe(false);
    expect(isWeakPin("1357")).toBe(false); // a run of 2 is not a run
  });

  it("has no opinion about something that is not a PIN at all", () => {
    // The length check refuses it first; this must not claim it is "weak",
    // which would send the wrong message to whoever is choosing one.
    expect(isWeakPin("11")).toBe(false);
  });
});

describe("the lockout", () => {
  it("is open until the last tolerated failure is used up", () => {
    expect(pinLockedUntil(MAX_PIN_FAILURES - 1, at("2026-09-12T08:00:00Z"))).toBeNull();
  });

  it("shuts on the failure that reaches the cap", () => {
    const until = pinLockedUntil(MAX_PIN_FAILURES, at("2026-09-12T08:00:00Z"));
    expect(until).toEqual(
      new Date(at("2026-09-12T08:00:00Z").getTime() + PIN_LOCKOUT_MINUTES * 60000),
    );
  });

  it("is open when there is a count but no time to measure from", () => {
    // Defensive: a count without a timestamp cannot say when it expires, and
    // locking forever on a half-written row is the wrong failure.
    expect(pinLockedUntil(99, null)).toBeNull();
  });

  it("OPENS ITSELF once the wait is over", () => {
    const failedAt = at("2026-09-12T08:00:00Z");
    expect(isPinLocked(MAX_PIN_FAILURES, failedAt, at("2026-09-12T08:10:00Z"))).toBe(true);
    expect(isPinLocked(MAX_PIN_FAILURES, failedAt, at("2026-09-12T08:15:00Z"))).toBe(false);
    expect(isPinLocked(MAX_PIN_FAILURES, failedAt, at("2026-09-12T09:00:00Z"))).toBe(false);
  });

  it("says how long is left in whole minutes, never zero", () => {
    const until = at("2026-09-12T08:15:00Z");
    expect(lockoutRemaining(until, at("2026-09-12T08:00:00Z"))).toBe("15 minutes");
    expect(lockoutRemaining(until, at("2026-09-12T08:14:10Z"))).toBe("1 minute");
    // A second left still reads as a minute: "0 minutes" tells somebody to
    // try now, and they would fail.
    expect(lockoutRemaining(until, at("2026-09-12T08:14:59Z"))).toBe("1 minute");
  });
});
