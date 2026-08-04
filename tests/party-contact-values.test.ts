import { describe, expect, it } from "vitest";
import {
  contactKindLabel,
  normalizeContactValue,
  preferredContact,
  CONTACT_VALUE_MAX,
} from "../src/lib/parties/contact-values";

/**
 * Contact-point normalization, without a database.
 *
 * These are the rules the duplicate check rests on. If two spellings of one
 * address normalize differently, the check silently stops finding duplicates —
 * a failure that looks like "the feature does nothing" rather than an error.
 */

describe("normalizeContactValue — email", () => {
  it("matches addresses that differ only by case or padding", () => {
    const a = normalizeContactValue("email", "  Bob@Example.COM ");
    const b = normalizeContactValue("email", "bob@example.com");
    expect(a?.normalizedValue).toBe(b?.normalizedValue);
  });

  it("keeps the typed form for display", () => {
    // The person sees what they wrote; only the matcher sees the other one.
    expect(normalizeContactValue("email", " Bob@Example.com ")?.value).toBe(
      "Bob@Example.com",
    );
  });

  it("lowercases the local part too, which RFC 5321 does not require", () => {
    // A deliberate small lie — no provider anybody uses is case-sensitive, and
    // matching matters more here than honouring a rule the world ignores.
    expect(normalizeContactValue("email", "Bob.Smith@x.com")?.normalizedValue).toBe(
      "bob.smith@x.com",
    );
  });

  it("refuses things that could not be delivered to", () => {
    for (const bad of ["", "   ", "bob", "bob@", "@example.com", "a@b", "a b@c.com", "a@b@c.com"]) {
      expect(normalizeContactValue("email", bad), bad).toBeNull();
    }
  });

  it("accepts addresses a stricter validator would wrongly reject", () => {
    // Plus-addressing and unusual TLDs are real and deliverable.
    expect(normalizeContactValue("email", "bob+crm@example.co.uk")).not.toBeNull();
    expect(normalizeContactValue("email", "a@b.io")).not.toBeNull();
  });

  it("refuses anything past the length ceiling", () => {
    const long = `${"x".repeat(CONTACT_VALUE_MAX)}@example.com`;
    expect(normalizeContactValue("email", long)).toBeNull();
  });
});

describe("normalizeContactValue — phone", () => {
  it("matches numbers that differ only by punctuation", () => {
    const a = normalizeContactValue("phone", "(555) 123-4567");
    const b = normalizeContactValue("phone", "555.123.4567");
    const c = normalizeContactValue("phone", "555 123 4567");
    expect(a?.normalizedValue).toBe("5551234567");
    expect(b?.normalizedValue).toBe(a?.normalizedValue);
    expect(c?.normalizedValue).toBe(a?.normalizedValue);
  });

  it("keeps a leading plus, because it changes what the number means", () => {
    expect(normalizeContactValue("phone", "+1 555 123 4567")?.normalizedValue).toBe(
      "+15551234567",
    );
    // And an international number is NOT the same as the bare one.
    expect(normalizeContactValue("phone", "+15551234567")?.normalizedValue).not.toBe(
      normalizeContactValue("phone", "5551234567")?.normalizedValue,
    );
  });

  it("refuses something too short to be a number", () => {
    expect(normalizeContactValue("phone", "12345")).toBeNull();
    expect(normalizeContactValue("phone", "n/a")).toBeNull();
  });

  it("keeps a number with an extension rather than losing it to a spec", () => {
    // E.164 caps at 15 digits; extensions push real strings past it and
    // refusing those would discard data somebody typed on purpose.
    expect(normalizeContactValue("phone", "+1 555 123 4567 x8901")).not.toBeNull();
  });
});

describe("normalizeContactValue — website", () => {
  it("accepts a bare host, because that is what people type", () => {
    expect(normalizeContactValue("website", "acme.com")?.normalizedValue).toBe(
      "acme.com",
    );
  });

  it("matches the same site written several ways", () => {
    const forms = ["acme.com", "Acme.com/", "https://acme.com", "HTTPS://ACME.COM/"];
    const normalized = forms.map((f) => normalizeContactValue("website", f)?.normalizedValue);
    expect(new Set(normalized).size).toBe(1);
  });

  it("keeps a path, because two pages are not one site entry", () => {
    expect(normalizeContactValue("website", "acme.com/support")?.normalizedValue).toBe(
      "acme.com/support",
    );
  });

  it("refuses something with no dot in the host", () => {
    expect(normalizeContactValue("website", "localhost")).toBeNull();
    expect(normalizeContactValue("website", "")).toBeNull();
  });
});

describe("preferredContact", () => {
  const pt = (kind: "email" | "phone", isPrimary: boolean, id: string) => ({
    kind,
    isPrimary,
    id,
  });

  it("prefers the primary", () => {
    const points = [pt("email", false, "a"), pt("email", true, "b")];
    expect(preferredContact(points, "email")?.id).toBe("b");
  });

  it("FALLS BACK to the first when nothing is flagged", () => {
    // Nobody marks a primary when there is only one, and a composer that
    // offered nothing in that case would be broken for the commonest record.
    const points = [pt("email", false, "a"), pt("email", false, "b")];
    expect(preferredContact(points, "email")?.id).toBe("a");
  });

  it("does not cross kinds", () => {
    const points = [pt("phone", true, "p")];
    expect(preferredContact(points, "email")).toBeNull();
  });

  it("returns null when there is nothing of that kind", () => {
    expect(preferredContact([], "email")).toBeNull();
  });
});

describe("contactKindLabel", () => {
  it("names every kind", () => {
    expect(contactKindLabel("email")).toBe("Email");
    expect(contactKindLabel("phone")).toBe("Phone");
    expect(contactKindLabel("website")).toBe("Website");
  });
});
