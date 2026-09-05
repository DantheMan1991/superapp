import { z } from "zod";
import type { FormField, FormFieldKind } from "./schema";

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
  /** The page the form was on, for the record and for the questions' definition. */
  page: z.string().trim().max(200).default("/"),
  /** Which section of that page holds the form: where its questions are read from. */
  section: z.coerce.number().int().min(0).max(11).default(0),
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

/* -- The business's own questions ----------------------------------------- */

export const ANSWER_TEXT_MAX = 200;
export const ANSWER_LONG_MAX = 1000;

/** An answer as stored: the question's words at the time, and what was said. */
export interface EnquiryAnswer {
  label: string;
  value: string;
}

const AnswerSchema = z.object({ label: z.string().max(80), value: z.string().max(ANSWER_LONG_MAX) });

/** Parse what a row holds; a malformed blob reads as no answers rather than throwing. */
export function readEnquiryAnswers(raw: unknown): EnquiryAnswer[] {
  const parsed = z.array(AnswerSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** The input's name for a question, and the key its error is filed under. */
export function answerInputName(id: string): string {
  return `q_${id}`;
}

export const FORM_FIELD_KINDS: ReadonlyArray<{ kind: FormFieldKind; label: string; hint: string }> = [
  { kind: "text", label: "Short answer", hint: "One line, up to 200 characters." },
  { kind: "long", label: "Long answer", hint: "A few lines, up to 1,000 characters." },
  { kind: "choice", label: "Pick one", hint: "A list to choose from." },
  { kind: "yesno", label: "Yes or no", hint: "A box to tick." },
];

export function fieldKindLabel(kind: FormFieldKind): string {
  return FORM_FIELD_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

/** A question with enough in it to draw, ready to be edited. `id` is the caller's (made once). */
export function newFormField(id: string, kind: FormFieldKind): FormField {
  return {
    id,
    label: kind === "yesno" ? "Is this for a business?" : "Your question",
    kind,
    required: false,
    options: kind === "choice" ? ["First choice", "Second choice"] : [],
  };
}

/**
 * Check a visitor's answers against the PUBLISHED questions and turn them
 * into what is stored. `get` reads a raw form value by input name. The
 * words are the business's site talking to its visitor.
 */
export function answersFromForm(
  fields: ReadonlyArray<FormField>,
  get: (name: string) => string,
): { answers: EnquiryAnswer[]; errors: Record<string, string> } {
  const answers: EnquiryAnswer[] = [];
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const name = answerInputName(field.id);
    const raw = get(name).trim();
    switch (field.kind) {
      case "yesno": {
        const yes = raw === "on" || raw === "yes" || raw === "true";
        if (field.required && !yes) errors[name] = "Tick this one to send.";
        answers.push({ label: field.label, value: yes ? "Yes" : "No" });
        break;
      }
      case "choice": {
        if (raw && !field.options.includes(raw)) {
          errors[name] = "Pick one of the choices.";
        } else if (field.required && !raw) {
          errors[name] = "Pick one to send.";
        } else if (raw) {
          answers.push({ label: field.label, value: raw });
        }
        break;
      }
      case "text":
      case "long": {
        const max = field.kind === "text" ? ANSWER_TEXT_MAX : ANSWER_LONG_MAX;
        if (raw.length > max) {
          errors[name] = `Keep this under ${max.toLocaleString("en-US")} characters.`;
        } else if (field.required && !raw) {
          errors[name] = "This one is needed to send.";
        } else if (raw) {
          answers.push({ label: field.label, value: raw });
        }
        break;
      }
    }
  }
  return { answers, errors };
}

/* -- The words a message becomes ------------------------------------------ */

export interface EnquiryWords {
  siteTitle: string;
  pagePath: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  answers: EnquiryAnswer[];
  /** `yyyy-mm-dd` in the tenant's timezone. */
  receivedOn: string;
  /** Set when the message is a booking (ADR 0025): what was booked and when, as words. */
  booking?: { title: string; when: string };
}

function whereFrom(w: Pick<EnquiryWords, "siteTitle" | "pagePath">): string {
  return w.pagePath && w.pagePath !== "/" ? `${w.siteTitle} (${w.pagePath})` : w.siteTitle;
}

/** "Name: …", "Email: …", the phone if given, then every answer, one line each. */
function detailLines(w: EnquiryWords): string[] {
  return [
    `Name: ${w.name}`,
    `Email: ${w.email}`,
    ...(w.phone ? [`Phone: ${w.phone}`] : []),
    ...w.answers.map((a) => `${a.label}: ${a.value}`),
  ];
}

/** The follow-up's title: what to do, and for whom. */
export function enquiryWorkTitle(name: string): string {
  const title = `Reply to ${name.trim()}`;
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}...` : title;
}

/** A booking's follow-up: confirm it with the person. */
export function bookingWorkTitle(name: string): string {
  const title = `Confirm the booking with ${name.trim()}`;
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}...` : title;
}

/** The follow-up's notes: everything the person sent, and where it came from. */
export function enquiryNotes(w: EnquiryWords): string {
  const opening = w.booking
    ? `${w.name} booked ${w.booking.title} for ${w.booking.when}, from ${whereFrom(w)}, ${w.receivedOn}.`
    : `A message from the form on ${whereFrom(w)}, ${w.receivedOn}.`;
  return [opening, "", ...detailLines(w), "", w.message].join("\n");
}

/** The email to the business. Plain text; Reply reaches the person who wrote. */
export function enquiryEmail(
  w: EnquiryWords,
  landed: { followUp: boolean; contact: boolean },
): { subject: string; text: string } {
  const where = w.booking ? "on your Bookings calendar in Yosher" : "in your Yosher workspace";
  const also = landed.contact
    ? `It is also ${where}, as a follow-up, and on their contact record.`
    : landed.followUp
      ? `It is also ${where} and as a follow-up.`
      : w.booking
        ? `It is also ${where}.`
        : "";
  const opening = w.booking
    ? `${w.name} booked ${w.booking.title} for ${w.booking.when} on ${whereFrom(w)}.`
    : `${w.name} sent this from the form on ${whereFrom(w)}.`;
  const ask = w.booking ? "Reply to this email to confirm with them." : "Reply to this email to answer them.";
  return {
    subject: w.booking
      ? `${w.name} booked ${w.booking.title} from your website`
      : `${w.name} sent a message from your website`,
    text: [opening, "", ...detailLines(w), "", w.message, "", "--", `${ask} ${also}`.trim()].join("\n"),
  };
}
