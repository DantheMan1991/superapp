import { describe, expect, it } from "vitest";
import { failureSentence } from "../src/modules/accounting/core/errors";

/**
 * The sentence the recurring list shows for a stored error CODE.
 *
 * `recurring_entries.last_error` holds the code and never the message, and
 * `friendlyMessage` takes an error rather than a code — so this is the only
 * way a note becomes words. A code with no sentence would render `undefined`
 * in a badge, which is the exact "unnamed on every surface" failure the column
 * exists to end.
 */
describe("failureSentence", () => {
  const FALLBACK = "Failed for a reason the sweep could not name.";

  it("names every code the sweep can actually leave", () => {
    for (const code of [
      "ACCOUNT_NOT_CODABLE",
      "ACCOUNT_INACTIVE",
      "ACCOUNT_NOT_FOUND",
      "RECURRING_TEMPLATE_INVALID",
      "PERIOD_CLOSED",
      "TAX_RATE_INVALID",
      "CUSTOMER_NOT_FOUND",
      "VENDOR_NOT_FOUND",
      "DIMENSION_INVALID",
    ]) {
      const sentence = failureSentence(code);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toBe(FALLBACK);
    }
  });

  it("falls back for the sweep's own UNKNOWN and for a stranger, never undefined", () => {
    expect(failureSentence("UNKNOWN")).toBe(FALLBACK);
    expect(failureSentence("NOT_A_CODE_ANYONE_WROTE")).toBe(FALLBACK);
    expect(failureSentence("")).toBe(FALLBACK);
  });
});
