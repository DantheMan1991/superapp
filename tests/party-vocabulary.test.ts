import { describe, expect, it } from "vitest";
import {
  CUSTOMER_FALLBACK,
  CUSTOMER_FALLBACK_PLURAL,
  VENDOR_FALLBACK,
  VENDOR_FALLBACK_PLURAL,
  partyWords,
} from "../src/lib/parties/vocabulary";
import { pluralOf } from "../src/lib/packs/resolve";

/**
 * The two words core lets a business rename, and the plural rule behind them.
 *
 * The plural is the part worth testing directly, because a tenant who renames
 * only the singular must not get "Client" beside "Customers" — a screen
 * disagreeing with itself. `pluralOf` is the one rule the screens, the sidebar
 * and the tenant guides all share; these cases pin it from this side.
 */
describe("partyWords", () => {
  it("gives the core English when no profile and no override", () => {
    // The COMMON path: `tenants.industry` defaults to `general`, which is not a
    // profile, so most tenants reach this.
    expect(partyWords({})).toEqual({
      customer: CUSTOMER_FALLBACK,
      customers: CUSTOMER_FALLBACK_PLURAL,
      vendor: VENDOR_FALLBACK,
      vendors: VENDOR_FALLBACK_PLURAL,
    });
  });

  it("renames one word without disturbing the other", () => {
    // The construction pilot's actual case: it says "client" and has no opinion
    // about vendors.
    expect(partyWords({ customer: "Client" })).toEqual({
      customer: "Client",
      customers: "Clients",
      vendor: "Vendor",
      vendors: "Vendors",
    });
  });

  it("renames both words and derives both plurals", () => {
    expect(partyWords({ customer: "Client", vendor: "Supplier" })).toEqual({
      customer: "Client",
      customers: "Clients",
      vendor: "Supplier",
      vendors: "Suppliers",
    });
  });

  it("IGNORES a stray plural key, because there is no such key", () => {
    // An earlier draft of this slice declared `customerPlural`. It was dropped
    // so the screens could not disagree with the guides about a plural, and this
    // pins the removal: a tenant row left over from that draft must not quietly
    // half-work.
    expect(
      partyWords({ customer: "Client", customerPlural: "Clientele" }).customers,
    ).toBe("Clients");
  });

  it("survives junk in the label map rather than throwing", () => {
    // `tenants.labels` is jsonb with no shape constraint. `resolveLabels` is the
    // thing that filters non-strings, but this must not crash if it is ever
    // handed a raw map — a corrupted row means default words, never a dead page.
    const junk = { customer: 42, vendorPlural: null } as unknown as Record<
      string,
      string
    >;
    expect(() => partyWords(junk)).not.toThrow();
  });
});

describe("pluralOf, the one plural rule", () => {
  it("keeps a declared plural for the UNRENAMED word", () => {
    // The case a bare "s" gets wrong: "Lines of businesss".
    expect(pluralOf("Line of business", "Line of business", "Lines of business")).toBe(
      "Lines of business",
    );
  });

  it("appends an s to a tenant's own word, which has no declared plural", () => {
    expect(pluralOf("Client", "Customer", "Customers")).toBe("Clients");
  });

  it("appends an s when no plural was declared at all", () => {
    expect(pluralOf("Zone", "Zone")).toBe("Zones");
  });
});
