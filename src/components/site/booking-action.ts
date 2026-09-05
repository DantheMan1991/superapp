"use server";

import { headers } from "next/headers";
import { SiteBookingSchema, type BookingState } from "@/lib/sites/booking-core";
import { receiveSiteBooking } from "@/lib/sites/bookings";
import { fieldErrorsFrom } from "@/lib/sites/enquiry-schema";

/**
 * PUBLIC server action, the enquiry form's twin (`enquiry-action.ts`): no
 * session to require, a honeypot, Zod at the boundary, the caps, and a
 * request that can name only a site's slug, which `receiveSiteBooking`
 * turns into a tenant through the trusted lookup. The chosen time is checked
 * against the open times at the moment of writing, never trusted.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

const CHECK_FIELDS = "Check the highlighted fields and try again.";

export async function submitSiteBooking(_prev: BookingState, formData: FormData): Promise<BookingState> {
  if (String(formData.get("website") ?? "").length > 0) {
    return { status: "success", booked: "" };
  }
  const parsed = SiteBookingSchema.safeParse({
    site: formData.get("site") ?? "",
    page: formData.get("page") ?? "/",
    section: formData.get("section") ?? "0",
    start: formData.get("start") ?? "",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }
  const result = await receiveSiteBooking(parsed.data, await clientIp());
  if (result.ok) return { status: "success", booked: result.booked };
  switch (result.reason) {
    case "fields":
      return { status: "error", message: CHECK_FIELDS, fieldErrors: result.fieldErrors };
    case "taken":
      return { status: "error", message: "That time was just taken. Pick another." };
    case "capped":
      return {
        status: "error",
        message: "That's a few bookings from here already. Give it an hour, or use the phone or email on this page.",
      };
    case "unavailable":
      return { status: "error", message: "Booking isn't open right now. Use the phone or email on this page." };
    default:
      return { status: "error", message: "That didn't go through. Try again, or use the phone or email on this page." };
  }
}
