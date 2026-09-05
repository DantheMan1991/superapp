"use server";

import { headers } from "next/headers";
import { fieldErrorsFrom, SiteEnquirySchema, type EnquiryState } from "@/lib/sites/enquiry-schema";
import { receiveSiteEnquiry } from "@/lib/sites/enquiries";

/**
 * PUBLIC server action — unauthenticated by design, like the platform's own
 * contact form. There is no `requireX` here because there is no session to
 * require; the defences are a honeypot, Zod at the boundary, the caps, and
 * the fact that the only thing the request can name is a site's slug, which
 * `receiveSiteEnquiry` turns into a tenant through the trusted lookup and
 * refuses unless that site is published. The words a visitor reads back are
 * the business's site talking, not Yosher.
 *
 * The business's own questions arrive as `q_<id>` values and are checked in
 * `receiveSiteEnquiry` against the PUBLISHED definition of the form, never
 * against anything the request says the questions are.
 *
 * Only async functions may be exported from this file — the schema and the
 * state type live in `src/lib/sites/enquiry-schema.ts`.
 */

/** First hop of x-forwarded-for — trustworthy on Vercel. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

const CHECK_FIELDS = "Check the highlighted fields and try again.";

export async function submitSiteEnquiry(
  _prev: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  // Honeypot. A person never sees this field, so anything in it is a bot.
  // Answer with the success state: telling a scraper which submissions were
  // rejected is how it learns to stop tripping the trap.
  if (String(formData.get("website") ?? "").length > 0) {
    return { status: "success" };
  }

  const parsed = SiteEnquirySchema.safeParse({
    site: formData.get("site") ?? "",
    page: formData.get("page") ?? "/",
    section: formData.get("section") ?? "0",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const rawAnswers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("q_") && typeof value === "string") rawAnswers[key] = value;
  }

  const result = await receiveSiteEnquiry(parsed.data, rawAnswers, await clientIp());
  if (result.ok) return { status: "success" };

  switch (result.reason) {
    case "fields":
      return { status: "error", message: CHECK_FIELDS, fieldErrors: result.fieldErrors };
    case "capped":
      return {
        status: "error",
        message: "That's a few messages from here already. Give it an hour, or use the phone or email on this page.",
      };
    case "unavailable":
      return {
        status: "error",
        message: "This form isn't taking messages right now. Use the phone or email on this page.",
      };
    default:
      return {
        status: "error",
        message: "That didn't go through. Try again, or use the phone or email on this page.",
      };
  }
}
