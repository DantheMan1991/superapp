import { describe, expect, it } from "vitest";
import {
  autoReplyState,
  MAX_BODY,
  validateAutoReply,
  type AutoReplyDraft,
} from "@/modules/email/auto-reply/validate";

const NOW = new Date("2026-08-10T12:00:00Z");

function draft(over: Partial<AutoReplyDraft> = {}): AutoReplyDraft {
  return {
    isEnabled: true,
    fromDate: null,
    toDate: null,
    subject: "Away from the office",
    textBody: "I am away until Monday and will reply then.",
    ...over,
  };
}

describe("validateAutoReply", () => {
  it("accepts an ordinary reply with no dates", () => {
    expect(validateAutoReply(draft(), NOW)).toBeNull();
  });

  it("accepts a window in the future", () => {
    const ok = draft({
      fromDate: "2026-08-11T00:00:00Z",
      toDate: "2026-08-18T00:00:00Z",
    });
    expect(validateAutoReply(ok, NOW)).toBeNull();
  });

  it("refuses an enabled reply with no message", () => {
    // The server would send an empty message to everyone who writes to you,
    // which is worse than sending nothing.
    expect(validateAutoReply(draft({ textBody: "" }), NOW)?.field).toBe("textBody");
    expect(validateAutoReply(draft({ textBody: "   \n  " }), NOW)?.field).toBe(
      "textBody",
    );
  });

  it("says nothing about a DISABLED reply, however empty", () => {
    // Somebody turning it off is not somebody making a mistake, and refusing
    // to save would trap them in a form they are trying to leave.
    const off = draft({ isEnabled: false, textBody: "", subject: "" });
    expect(validateAutoReply(off, NOW)).toBeNull();
  });

  it("refuses an end date that has already passed", () => {
    // THE quiet failure: it saves, it reports success, and it never sends.
    const spent = draft({ toDate: "2026-08-09T00:00:00Z" });
    const problem = validateAutoReply(spent, NOW);
    expect(problem?.field).toBe("toDate");
    expect(problem?.message).toContain("never send");
  });

  it("refuses an end before the start", () => {
    const backwards = draft({
      fromDate: "2026-08-20T00:00:00Z",
      toDate: "2026-08-15T00:00:00Z",
    });
    expect(validateAutoReply(backwards, NOW)?.field).toBe("toDate");
  });

  it("refuses an end equal to the start", () => {
    const zero = draft({
      fromDate: "2026-08-20T00:00:00Z",
      toDate: "2026-08-20T00:00:00Z",
    });
    expect(validateAutoReply(zero, NOW)?.field).toBe("toDate");
  });

  it("refuses an end date that is not a date", () => {
    expect(validateAutoReply(draft({ toDate: "next tuesday" }), NOW)?.field).toBe(
      "toDate",
    );
  });

  it("bounds the body and the subject", () => {
    expect(validateAutoReply(draft({ textBody: "x".repeat(MAX_BODY + 1) }), NOW)
      ?.field).toBe("textBody");
    expect(validateAutoReply(draft({ subject: "x".repeat(201) }), NOW)?.field).toBe(
      "subject",
    );
  });
});

describe("autoReplyState", () => {
  it("is off when disabled, whatever the dates say", () => {
    const state = autoReplyState(
      { isEnabled: false, fromDate: "2026-08-01T00:00:00Z", toDate: null },
      NOW,
    );
    expect(state.state).toBe("off");
  });

  it("is active with no dates at all", () => {
    const state = autoReplyState(
      { isEnabled: true, fromDate: null, toDate: null },
      NOW,
    );
    expect(state).toEqual({ state: "active", until: null });
  });

  it("is scheduled before the window opens", () => {
    // Enabled but dormant. Reporting this as "on" is how somebody believes
    // their customers are being answered when they are not.
    const state = autoReplyState(
      { isEnabled: true, fromDate: "2026-08-20T00:00:00Z", toDate: null },
      NOW,
    );
    expect(state.state).toBe("scheduled");
  });

  it("is ended after the window closes, even though it is still enabled", () => {
    // The box is still ticked. `isEnabled` is true. Nothing is being sent.
    const state = autoReplyState(
      {
        isEnabled: true,
        fromDate: "2026-08-01T00:00:00Z",
        toDate: "2026-08-05T00:00:00Z",
      },
      NOW,
    );
    expect(state.state).toBe("ended");
  });

  it("is active inside the window, and reports when it stops", () => {
    const state = autoReplyState(
      {
        isEnabled: true,
        fromDate: "2026-08-01T00:00:00Z",
        toDate: "2026-08-20T00:00:00Z",
      },
      NOW,
    );
    expect(state.state).toBe("active");
    if (state.state === "active") {
      expect(state.until?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    }
  });

  it("treats the boundaries as closed at the end and open at the start", () => {
    // A window ending exactly now is over; one starting exactly now has begun.
    const endsNow = autoReplyState(
      { isEnabled: true, fromDate: null, toDate: NOW.toISOString() },
      NOW,
    );
    expect(endsNow.state).toBe("ended");
    const startsNow = autoReplyState(
      { isEnabled: true, fromDate: NOW.toISOString(), toDate: null },
      NOW,
    );
    expect(startsNow.state).toBe("active");
  });
});
