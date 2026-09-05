import { NextResponse } from "next/server";
import { z } from "zod";
import { openBookingTimes } from "@/lib/sites/bookings";

/**
 * The open times for a site's booking section — PUBLIC, read-only, and the
 * third unauthenticated door into a tenant after the enquiry form and the
 * view beacon (ADR 0025). The answer is instants and labels; a site that is
 * not published, has no such section, or has Scheduling off gets an empty
 * list, the same as a site that does not exist, so nothing here says which
 * addresses are real. Never cached: what is open changes with every booking.
 */
export const dynamic = "force-dynamic";

const Query = z.object({
  site: z.string().trim().min(1).max(60),
  page: z.string().trim().max(200).default("/"),
  section: z.coerce.number().int().min(0).max(11).default(0),
});

const EMPTY = { days: [] };
const HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = Query.safeParse({
    site: url.searchParams.get("site") ?? "",
    page: url.searchParams.get("page") ?? "/",
    section: url.searchParams.get("section") ?? "0",
  });
  if (!parsed.success) return NextResponse.json(EMPTY, { headers: HEADERS });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const open = await openBookingTimes(parsed.data, ip);
  return NextResponse.json(open ?? EMPTY, { headers: HEADERS });
}
