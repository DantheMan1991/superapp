import "server-only";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send";
import { isModuleEnabled } from "@/lib/modules";
import { createParty } from "@/lib/parties";
import { findPartiesByContact } from "@/lib/parties/contacts";
import { ipKey, overPublicCap, startOfUtcDay } from "@/lib/public-caps";
import { busyOnCalendar, findBookingsCalendarId } from "@/lib/schedule/bookings-calendar";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { todayInTimezone } from "@/lib/timezone";
import { createUnlinkedWork, createWorkForEntity } from "@/lib/work/entity-work";
import {
  BOOKING_DAILY_CAP,
  BOOKING_HOURLY_IP_CAP,
  BOOKING_SITE_DAILY_CAP,
  bookingWindow,
  describeBooking,
  isOffered,
  offerSlots,
  SLOTS_DAILY_CAP,
  SLOTS_HOURLY_IP_CAP,
  type BookingSection,
  type OfferedDay,
  type SiteBookingInput,
} from "./booking-core";
import { notifyPlan, tryAddContactPoint } from "./enquiries";
import {
  bookingWorkTitle,
  enquiryEmail,
  enquiryNotes,
  splitPersonName,
  type EnquiryWords,
} from "./enquiry-schema";
import { lookupSiteBySlug, type SiteHit } from "./read";
import { readPageContent, readSiteSettings } from "./schema";
import { normalizeSiteSlug } from "./slug";

/**
 * Booking a time from a site — ADR 0025. A booking lands exactly as an
 * enquiry does (ADR 0021: a party, a CRM record when CRM is on, a follow-up,
 * the `site_enquiries` row, an email to the business), and also as an item
 * on the business's Bookings calendar with the visitor as its attendee.
 *
 * Two public doors, both through the trusted slug lookup and both only for
 * a PUBLISHED site with Scheduling switched on:
 *   - `openBookingTimes` READS the open times: the section's rules from the
 *     published page, minus what is on the Bookings calendar, as `staff`
 *     with no user, which the calendar's workspace-wide `write` share lets
 *     see. It answers with instants and labels and nothing else.
 *   - `receiveSiteBooking` WRITES one. The chosen start is checked against
 *     the times that would be offered at that moment, under a per-calendar
 *     advisory lock, so two visitors cannot both have 9:00 — the second is
 *     told the time was just taken and shown the rest.
 * Nothing the request says about the rules is believed; the rules are read
 * from the published page every time, like the form's questions.
 */
export const BOOKING_ATTEMPT_KIND = "site_booking";
export const SLOTS_ATTEMPT_KIND = "site_slots";

const BOOKING_CAP = { kind: BOOKING_ATTEMPT_KIND, hourlyIpCap: BOOKING_HOURLY_IP_CAP, dailyCap: BOOKING_DAILY_CAP };
const SLOTS_CAP = { kind: SLOTS_ATTEMPT_KIND, hourlyIpCap: SLOTS_HOURLY_IP_CAP, dailyCap: SLOTS_DAILY_CAP };

export interface OpenTimes {
  timezone: string;
  title: string;
  minutes: number;
  days: OfferedDay[];
}

/** A published site with Scheduling on, or null; the caps are the caller's. */
async function bookableSite(siteSlug: string): Promise<SiteHit | null> {
  const slug = normalizeSiteSlug(siteSlug);
  if (!slug.ok) return null;
  const hit = await lookupSiteBySlug(slug.slug);
  if (!hit || hit.status !== "published") return null;
  if (!(await isModuleEnabled(hit.tenantId, "scheduling"))) return null;
  return hit;
}

type SiteTx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** The booking section as PUBLISHED on that page, or null. */
async function publishedBookingSection(
  tx: SiteTx,
  tenantId: string,
  siteId: string,
  pagePath: string,
  index: number,
): Promise<BookingSection | null> {
  const page = await tx.query.sitePages.findFirst({
    where: and(
      eq(schema.sitePages.tenantId, tenantId),
      eq(schema.sitePages.siteId, siteId),
      eq(schema.sitePages.path, pagePath),
    ),
    columns: { published: true },
  });
  const section = page ? readPageContent(page.published).sections[index] : undefined;
  return section?.type === "booking" ? section : null;
}

export async function openBookingTimes(
  input: { site: string; page: string; section: number },
  ip: string,
  now = new Date(),
): Promise<OpenTimes | null> {
  const hit = await bookableSite(input.site);
  if (!hit) return null;
  if (await overPublicCap(SLOTS_CAP, ipKey(ip))) return null;
  return withTenant(
    hit.tenantId,
    async (tx) => {
      const site = await tx.query.sites.findFirst({
        where: and(eq(schema.sites.tenantId, hit.tenantId), eq(schema.sites.id, hit.id)),
        columns: { id: true, status: true },
      });
      if (!site || site.status !== "published") return null;
      const section = await publishedBookingSection(tx, hit.tenantId, site.id, input.page || "/", input.section);
      if (!section) return null;
      const calendarId = await findBookingsCalendarId(tx, hit.tenantId);
      if (!calendarId) return null;
      const timezone = await getTenantTimezone(tx, hit.tenantId);
      const window = bookingWindow(section, now);
      const busy = await busyOnCalendar(tx, calendarId, window.from, window.to);
      return { timezone, title: section.title, minutes: section.minutes, days: offerSlots(section, busy, now, timezone) };
    },
    { role: "staff" },
  );
}

export type BookingResult =
  | { ok: true; booked: string }
  | { ok: false; reason: "fields"; fieldErrors: Record<string, string> }
  | { ok: false; reason: "taken" | "capped" | "unavailable" | "failed" };

interface Landed {
  enquiryId: string;
  tenantId: string;
  words: EnquiryWords;
  contactRecord: boolean;
  plan: Awaited<ReturnType<typeof notifyPlan>>;
}

type Outcome =
  | { kind: "landed"; landed: Landed }
  | { kind: "taken" }
  | { kind: "capped" }
  | { kind: "unavailable" };

export async function receiveSiteBooking(
  input: SiteBookingInput,
  ip: string,
  now = new Date(),
): Promise<BookingResult> {
  const hit = await bookableSite(input.site);
  if (!hit) return { ok: false, reason: "unavailable" };
  const ipHash = ipKey(ip);
  if (await overPublicCap(BOOKING_CAP, ipHash)) return { ok: false, reason: "capped" };
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "fields", fieldErrors: { start: "Pick a time." } };

  const crmOn = await isModuleEnabled(hit.tenantId, "crm");

  let outcome: Outcome;
  try {
    outcome = await withTenant(
      hit.tenantId,
      async (tx): Promise<Outcome> => {
        const site = await tx.query.sites.findFirst({
          where: and(eq(schema.sites.tenantId, hit.tenantId), eq(schema.sites.id, hit.id)),
        });
        if (!site || site.status !== "published") return { kind: "unavailable" };

        const [{ n: today }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.siteEnquiries)
          .where(
            and(
              eq(schema.siteEnquiries.tenantId, hit.tenantId),
              eq(schema.siteEnquiries.siteId, site.id),
              isNotNull(schema.siteEnquiries.bookingStartsAt),
              gte(schema.siteEnquiries.createdAt, startOfUtcDay(now)),
            ),
          );
        if (today >= BOOKING_SITE_DAILY_CAP) return { kind: "capped" };

        const pagePath = input.page || "/";
        const section = await publishedBookingSection(tx, hit.tenantId, site.id, pagePath, input.section);
        if (!section) return { kind: "unavailable" };
        const calendarId = await findBookingsCalendarId(tx, hit.tenantId);
        if (!calendarId) return { kind: "unavailable" };
        const timezone = await getTenantTimezone(tx, hit.tenantId);

        // One booking at a time per calendar, so the check below cannot be
        // raced by a second visitor choosing the same slot in the same second.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${calendarId}))`);
        const window = bookingWindow(section, now);
        const busy = await busyOnCalendar(tx, calendarId, window.from, window.to);
        if (!isOffered(section, busy, start, now, timezone)) return { kind: "taken" };
        const end = new Date(start.getTime() + section.minutes * 60_000);
        const when = describeBooking(start, end, timezone);

        const settings = readSiteSettings(site.settings);
        const plan = await notifyPlan(hit.tenantId, settings.email);
        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, hit.tenantId),
          columns: { name: true },
        });
        const receivedOn = todayInTimezone(timezone);

        // 1. The party: known by this email, or new.
        const matches = await findPartiesByContact(tx, hit.tenantId, "email", input.email);
        const party =
          matches[0]?.party ??
          (await createParty(tx, hit.tenantId, {
            kind: "person",
            displayName: input.name,
            ...splitPersonName(input.name),
          }));
        await tryAddContactPoint(tx, hit.tenantId, party.id, "email", input.email);
        if (input.phone) await tryAddContactPoint(tx, hit.tenantId, party.id, "phone", input.phone);

        // 2. CRM's record, only when CRM is on.
        if (crmOn) {
          await tx
            .insert(schema.crmPartyDetails)
            .values({ tenantId: hit.tenantId, partyId: party.id, source: "website" })
            .onConflictDoNothing();
        }

        const words: EnquiryWords = {
          siteTitle: site.title || tenant?.name || "your website",
          pagePath,
          name: input.name,
          email: input.email,
          phone: input.phone,
          message: input.note || `Booked ${section.title} for ${when}.`,
          answers: [],
          receivedOn,
          booking: { title: section.title, when },
        };

        // 3. The follow-up, due today: confirm it with them.
        const workInput = { title: bookingWorkTitle(input.name), notes: enquiryNotes(words), dueOn: receivedOn };
        const workCtx = { tenantId: hit.tenantId, userId: "" };
        const workItemId = crmOn
          ? await createWorkForEntity(
              tx,
              workCtx,
              { extensionSlug: "crm", entityType: "contact", entityId: party.id },
              workInput,
            )
          : await createUnlinkedWork(tx, workCtx, workInput);

        // 4. The calendar item, with the visitor on it. Written through the
        //    member policies by way of the calendar's workspace-wide share.
        const [item] = await tx
          .insert(schema.scheduleItems)
          .values({
            tenantId: hit.tenantId,
            calendarId,
            title: `${section.title}: ${input.name}`,
            description: enquiryNotes(words),
            startsAt: start,
            endsAt: end,
            allDay: false,
            timeZone: timezone,
            showAs: "busy",
            kind: "booking",
            metadata: { source: "website", siteId: site.id, partyId: party.id },
            createdByClerkUserId: "",
          })
          .returning({ id: schema.scheduleItems.id });
        await tx.insert(schema.scheduleItemAttendees).values({
          tenantId: hit.tenantId,
          itemId: item.id,
          externalEmail: input.email,
          externalName: input.name,
          response: "accepted",
        });

        // 5. The record of what was booked: an enquiry with a time.
        const [row] = await tx
          .insert(schema.siteEnquiries)
          .values({
            tenantId: hit.tenantId,
            siteId: site.id,
            pagePath,
            name: input.name,
            email: input.email,
            phone: input.phone,
            message: words.message,
            answers: [],
            partyId: party.id,
            workItemId,
            notifyVia: plan.via,
            ipHash,
            bookingStartsAt: start,
            bookingEndsAt: end,
            bookingTitle: section.title,
            scheduleItemId: item.id,
          })
          .returning({ id: schema.siteEnquiries.id });

        // 6. Identifiers only.
        await logAuditInTx(tx, {
          action: "site.booking.received",
          tenantId: hit.tenantId,
          targetType: "site_enquiry",
          targetId: row.id,
          meta: {
            siteId: site.id,
            partyId: party.id,
            matchedExisting: matches.length > 0,
            workItemId,
            scheduleItemId: item.id,
            calendarId,
            crmRecord: crmOn,
            notifyVia: plan.via,
          },
        });

        return { kind: "landed", landed: { enquiryId: row.id, tenantId: hit.tenantId, words, contactRecord: crmOn, plan } };
      },
      { role: "staff" },
    );
  } catch (err) {
    console.error("site booking: could not be recorded", err instanceof Error ? err.message : err);
    return { ok: false, reason: "failed" };
  }
  if (outcome.kind !== "landed") return { ok: false, reason: outcome.kind };

  const { landed } = outcome;
  const mail = enquiryEmail(landed.words, { followUp: true, contact: landed.contactRecord });
  for (const to of landed.plan.recipients) {
    const sent = await sendEmail({
      tenantId: landed.tenantId,
      kind: "enquiry",
      to: to.email,
      subject: mail.subject,
      text: mail.text,
      idempotencyKey: `booking:${landed.enquiryId}:${to.key}`,
      replyTo: landed.words.email,
    });
    if (!sent.ok) console.error(`site booking: email not sent (${sent.reason})`);
  }
  return { ok: true, booked: landed.words.booking?.when ?? "" };
}
