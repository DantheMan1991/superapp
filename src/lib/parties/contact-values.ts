import type { PartyContactKind } from "@/db/schema";

/**
 * Normalizing and validating a way of reaching somebody. PURE — no database,
 * no `server-only`, so every rule is testable without a session and the same
 * code runs on both sides of the boundary.
 *
 * THE WHOLE POINT: a contact point is stored TWICE, as typed and as matchable.
 * `Bob@Example.COM ` and `bob@example.com` are one address; `(555) 123-4567`
 * and `+1 555 123 4567` are one phone. The person sees what they typed and the
 * machine compares something that can actually be compared.
 *
 * Normalizing at each call site instead would be the same class of mistake as
 * formatting money in more than one place — it works until two call sites
 * disagree, and then a duplicate check silently stops finding duplicates.
 */

export const CONTACT_VALUE_MAX = 320; // RFC 5321's practical email ceiling.

export interface NormalizedContact {
  /** Trimmed, but otherwise as the person typed it. */
  value: string;
  /** What matching compares. Never shown. */
  normalizedValue: string;
}

/**
 * Normalize a value for its kind, or return null if it is not usable.
 *
 * Null means "this is not a `kind`" — an empty string, or something that could
 * not be a way of reaching anybody. The caller refuses rather than storing a
 * row nothing can ever match.
 */
export function normalizeContactValue(
  kind: PartyContactKind,
  raw: string,
): NormalizedContact | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > CONTACT_VALUE_MAX) return null;

  switch (kind) {
    case "email": {
      // Deliberately NOT a full RFC validator. The only questions worth asking
      // here are "could this be delivered to" and "will it match its twin" —
      // anything stricter rejects addresses that genuinely work, and this is
      // not the place that finds out whether mail arrives.
      const at = value.indexOf("@");
      if (at <= 0 || at !== value.lastIndexOf("@")) return null;
      const domain = value.slice(at + 1);
      if (domain.length === 0 || !domain.includes(".") || /\s/.test(value)) {
        return null;
      }
      // The LOCAL PART IS LOWERCASED TOO, and that is a deliberate small lie.
      // RFC 5321 says the local part is case-sensitive; no mail provider anybody
      // uses treats it that way, and matching `Bob@` against `bob@` matters more
      // here than honouring a rule the world ignores. Stated so the next person
      // knows it was a decision.
      return { value, normalizedValue: value.toLowerCase() };
    }

    case "phone": {
      const digits = value.replace(/[^\d+]/g, "");
      const plus = digits.startsWith("+");
      const bare = digits.replace(/\+/g, "");
      // Short enough to be a typo rather than a number. Not an upper bound on
      // country codes — E.164 caps at 15, but extensions push real strings past
      // it and refusing those would lose data to a spec nobody typed against.
      if (bare.length < 6) return null;
      return { value, normalizedValue: plus ? `+${bare}` : bare };
    }

    case "website": {
      // Accept a bare host; people type "acme.com", not "https://acme.com".
      const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      let url: URL;
      try {
        url = new URL(withScheme);
      } catch {
        return null;
      }
      if (!url.hostname.includes(".")) return null;
      // Host plus path, lowercased, trailing slash dropped: `Acme.com/` and
      // `https://acme.com` are the same site.
      const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
      return {
        value,
        normalizedValue: `${url.hostname.toLowerCase()}${path.toLowerCase()}`,
      };
    }
  }
}

/** Human wording for a kind, for labels and error messages. */
export function contactKindLabel(kind: PartyContactKind): string {
  switch (kind) {
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    case "website":
      return "Website";
  }
}

/**
 * Pick the address to use for one kind: the primary if there is one, otherwise
 * the first.
 *
 * Falling back rather than returning nothing is what stops a record with one
 * unflagged email being unreachable. Nobody marks a primary when there is only
 * one, and a composer that offered nothing in that case would be broken for the
 * most common shape of record there is.
 */
export function preferredContact<
  T extends { kind: PartyContactKind; isPrimary: boolean },
>(points: readonly T[], kind: PartyContactKind): T | null {
  const ofKind = points.filter((p) => p.kind === kind);
  return ofKind.find((p) => p.isPrimary) ?? ofKind[0] ?? null;
}

/**
 * The same answer as a string: what a form with ONE email box shows, or "".
 *
 * Lives here rather than beside the write path because the readers are pages
 * and a CSV builder that must stay free of `server-only` — `export-csv.ts`
 * calls itself the testable seam and is tested without a database.
 */
export function preferredContactValue<
  T extends { kind: PartyContactKind; isPrimary: boolean; value: string },
>(points: readonly T[], kind: PartyContactKind): string {
  return preferredContact(points, kind)?.value ?? "";
}
