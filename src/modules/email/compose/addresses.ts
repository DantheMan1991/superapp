import type { JmapEmailAddress } from "@/lib/email/jmap/types";

/**
 * Turning a typed recipient line back into addresses.
 *
 * `Dana Rowe <dana@x.test>, billing@y.test, "Smith, John" <j@z.test>`
 *
 * Pure, and tested, because the failure is silent and expensive in both
 * directions: split too eagerly and "Smith, John" becomes two recipients, one
 * of them nonsense; split too cautiously and two real people become one address
 * that bounces. Either way somebody finds out after the message has gone.
 */

/**
 * Split on commas and semicolons that are NOT inside quotes or angle brackets.
 *
 * Outlook and several address books paste semicolon-separated lists, so
 * accepting both is the difference between "paste worked" and "paste produced
 * one enormous invalid address".
 */
export function splitRecipients(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && char === "<") inAngle = true;
    if (!inQuotes && char === ">") inAngle = false;
    if ((char === "," || char === ";") && !inQuotes && !inAngle) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const ANGLE = /^(.*?)<([^<>]+)>$/;

/** One `Name <addr>` or bare `addr`. Returns null for anything unusable. */
export function parseRecipient(raw: string): JmapEmailAddress | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const angled = ANGLE.exec(trimmed);
  if (angled) {
    const email = angled[2].trim();
    if (email.length === 0) return null;
    let name = angled[1].trim();
    // Strip the surrounding quotes a display name with a comma needs, without
    // touching quotes inside it.
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
      name = name.slice(1, -1);
    }
    return { name: name.length > 0 ? name : null, email };
  }

  // A bare address. Anything with whitespace left in it is not one — that is
  // usually a name somebody typed without an address, and guessing at it would
  // send mail to a fabricated recipient.
  if (/\s/.test(trimmed)) return null;
  return { name: null, email: trimmed };
}

export interface ParsedRecipients {
  addresses: JmapEmailAddress[];
  /** The fragments that could not be read, verbatim, so the UI can name them. */
  invalid: string[];
}

/**
 * Parse a whole line.
 *
 * Unreadable fragments are RETURNED rather than dropped. Dropping them means a
 * message goes to three people when somebody meant four and nothing anywhere
 * says so; naming them lets the composer refuse and point at the problem.
 */
export function parseRecipients(line: string): ParsedRecipients {
  const addresses: JmapEmailAddress[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of splitRecipients(line)) {
    const parsed = parseRecipient(part);
    if (!parsed) {
      invalid.push(part);
      continue;
    }
    const key = parsed.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(parsed);
  }

  return { addresses, invalid };
}
