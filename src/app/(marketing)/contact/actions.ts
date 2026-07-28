"use server";

import { headers } from "next/headers";
import { submitContactEnquiry } from "@/lib/contact";
import { contactSchema, type ContactState } from "./schema";

/**
 * PUBLIC server action — unauthenticated by design, like the health check's.
 *
 * The defences are: a fixed recipient that no input can influence, Zod at the
 * boundary, a honeypot field, and per-IP plus platform-wide caps enforced in
 * `src/lib/contact.ts`. There is no `requireX` here because there is no
 * session to require.
 *
 * Only async functions may be exported from this file — the schema, the state
 * type and the length cap live in `./schema`.
 */

/** First hop of x-forwarded-for — trustworthy on Vercel. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

export async function sendContactMessage(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  // Honeypot. A real person never sees this field, so anything in it is a bot.
  // Answer with the success state rather than an error: telling a scraper which
  // of its submissions were rejected is how it learns to stop tripping the trap.
  if (String(formData.get("website") ?? "").length > 0) {
    return { status: "success" };
  }

  const parsed = contactSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    business: formData.get("business") ?? "",
    message: formData.get("message") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }

  const result = await submitContactEnquiry(parsed.data, await clientIp());
  if (result.ok) return { status: "success" };

  switch (result.reason) {
    case "capped":
      return {
        status: "error",
        message:
          "That's a few messages from here already — give it an hour, or email us directly.",
      };
    case "not_configured":
      return {
        status: "error",
        message:
          "Our contact form is having a moment. Please email us directly and we'll pick it up.",
      };
    default:
      return {
        status: "error",
        message: "That didn't go through — try again, or email us directly.",
      };
  }
}
