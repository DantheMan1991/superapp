import { z } from "zod";

/**
 * The enquiry form's shape and the words built from one — pure, shared by
 * the public form, its server action and the write path.
 *
 * Lives outside the `"use server"` file because such a module may only
 * export async functions; the platform's contact form learned that the hard
 * way (`src/app/(marketing)/contact/schema.ts`).
 */

export const ENQUIRY_MESSAGE_MAX = 4000;

/** Submissions tolerated from one IP per hour, across every site. */
export const ENQUIRY_HOURLY_IP_CAP = 5;
/** Submissions accepted platform-wide per UTC day. Protects the provider bill. */
export const ENQUIRY_DAILY_CAP = 1000;
/** Submissions one site accepts per UTC day. Protects one inbox and one work list from a bot. */
export const ENQUIRY_SITE_DAILY_CAP = 100;

export interface EnquiryState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const SiteEnquirySchema = z.object({
  /** The site's slug — the one address every site has, whatever host the form was on. */
  site: z.string().trim().min(1).max(60),
  /** The page the form was on, for the record. */
  page: z.string().trim().max(200).default("/"),
  name: z
    .string()
    .trim()
    .min(1, "Tell us who you are.")
    .max(120, "That name is too long."),
  email: z
    .string()
    .trim()
    .email("That email doesn't look right. Check it and try again.")
    .max(254, "That email is too long."),
  phone: z.string().trim().max(40, "That phone number is too long.").default(""),
  message: z
    .string()
    // Truncate-then-validate, the interview's precedent: never refuse a
    // customer's message purely for being long.
    .transform((s) => s.slice(0, ENQUIRY_MESSAGE_MAX).trim())
    .pipe(z.string().min(5, "Tell us a little about what you need.")),
});
export type SiteEnquiryInput = z.infer<typeof SiteEnquirySchema>;

/** One message per field, the first issue winning, keyed the way the form's inputs are named. */
export function fieldErrorsFrom(issues: ReadonlyArray<z.ZodIssue>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/**
 * "Jane Doe" → Jane / Doe; "Jane van der Berg" → Jane / van der Berg;
 * "Jane" → Jane / nothing. The display name keeps what was typed; these
 * only give the record's structured names a start.
 */
export function splitPersonName(name: string): { givenName: string | null; familyName: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: null, familyName: null };
  if (parts.length === 1) return { givenName: parts[0], familyName: null };
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

export interface EnquiryWords {
  siteTitle: string;
  pagePath: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  /** `yyyy-mm-dd` in the tenant's timezone. */
  receivedOn: string;
}

function whereFrom(w: Pick<EnquiryWords, "siteTitle" | "pagePath">): string {
  return w.pagePath && w.pagePath !== "/" ? `${w.siteTitle} (${w.pagePath})` : w.siteTitle;
}

/** The follow-up's title: what to do, and for whom. */
export function enquiryWorkTitle(name: string): string {
  const title = `Reply to ${name.trim()}`;
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}...` : title;
}

/** The follow-up's notes: everything the person sent, and where it came from. */
export function enquiryNotes(w: EnquiryWords): string {
  return [
    `A message from the form on ${whereFrom(w)}, ${w.receivedOn}.`,
    "",
    `Name: ${w.name}`,
    `Email: ${w.email}`,
    ...(w.phone ? [`Phone: ${w.phone}`] : []),
    "",
    w.message,
  ].join("\n");
}

/** The email to the business. Plain text; Reply reaches the person who wrote. */
export function enquiryEmail(
  w: EnquiryWords,
  landed: { followUp: boolean; contact: boolean },
): { subject: string; text: string } {
  const also = landed.contact
    ? "It is also in your Yosher workspace as a follow-up, and on their contact record."
    : landed.followUp
      ? "It is also in your Yosher workspace as a follow-up."
      : "";
  return {
    subject: `${w.name} sent a message from your website`,
    text: [
      `${w.name} sent this from the form on ${whereFrom(w)}.`,
      "",
      `Name: ${w.name}`,
      `Email: ${w.email}`,
      ...(w.phone ? [`Phone: ${w.phone}`] : []),
      "",
      w.message,
      "",
      "--",
      `Reply to this email to answer them. ${also}`.trim(),
    ].join("\n"),
  };
}
