import { describe, expect, it } from "vitest";
import {
  bookingWindow,
  dayLabel,
  describeBooking,
  isOffered,
  offerSlots,
  SiteBookingSchema,
  timeLabel,
  type BookingRules,
} from "../src/lib/sites/booking-core";
import { bookingWorkTitle, enquiryEmail, enquiryNotes, type EnquiryWords } from "../src/lib/sites/enquiry-schema";
import { newSection, sectionSummary } from "../src/lib/sites/pages";
import { SectionSchema } from "../src/lib/sites/schema";

const TZ = "America/New_York";
// A Monday, 04:00 in New York (08:00Z), before the day's window opens.
const NOW = new Date("2026-09-14T08:00:00Z");
const rules: BookingRules = { minutes: 30, days: [1, 2, 3, 4, 5], from: "09:00", to: "12:00", leadHours: 24, horizonDays: 7 };

describe("a booking section", () => {
  it("starts with weekday mornings-to-evenings, half an hour, a day's notice, a month ahead", () => {
    const section = SectionSchema.parse(newSection("booking"));
    expect(section.type === "booking" && section).toMatchObject({
      minutes: 30,
      days: [1, 2, 3, 4, 5],
      from: "09:00",
      to: "17:00",
      leadHours: 24,
      horizonDays: 30,
      askPhone: true,
    });
    expect(sectionSummary(newSection("booking"))).toBe("Book a time: Visit, 30 min");
    expect(SectionSchema.safeParse({ ...newSection("booking"), from: "25:00" }).success).toBe(false);
    expect(SectionSchema.safeParse({ ...newSection("booking"), days: [7] }).success).toBe(false);
    expect(SectionSchema.safeParse({ ...newSection("booking"), minutes: 20 }).success).toBe(false);
    expect(SectionSchema.safeParse({ ...newSection("booking"), title: "" }).success).toBe(false);
  });

  it("offers the free times inside its rules, after the notice, aligned to the half hour", () => {
    expect(bookingWindow(rules, NOW)).toEqual({
      from: new Date("2026-09-15T08:00:00Z"),
      to: new Date("2026-09-21T08:00:00Z"),
    });
    const days = offerSlots(rules, [], NOW, TZ);
    // Monday is inside the notice; the week runs Tuesday to Friday, then the next Monday is past the horizon's Monday 04:00.
    expect(days.map((d) => d.date)).toEqual(["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(days[0].label).toBe("Tue, Sep 15");
    expect(days[0].slots.map((s) => s.label)).toEqual(["9:00 am", "9:30 am", "10:00 am", "10:30 am", "11:00 am", "11:30 am"]);
    expect(days[0].slots[0]).toEqual({ start: "2026-09-15T13:00:00.000Z", end: "2026-09-15T13:30:00.000Z", label: "9:00 am" });
  });

  it("leaves out what is on the calendar, and a longer booking needs a longer gap", () => {
    const busy = [{ startsAt: new Date("2026-09-15T13:15:00Z"), endsAt: new Date("2026-09-15T14:15:00Z") }];
    const tuesday = offerSlots(rules, busy, NOW, TZ)[0];
    expect(tuesday.slots.map((s) => s.label)).toEqual(["10:30 am", "11:00 am", "11:30 am"]);
    const hour = offerSlots({ ...rules, minutes: 60 }, busy, NOW, TZ)[0];
    expect(hour.slots.map((s) => s.label)).toEqual(["10:30 am", "11:00 am"]);
  });

  it("believes a start only when it is one of the times it would offer right now", () => {
    expect(isOffered(rules, [], new Date("2026-09-15T13:00:00Z"), NOW, TZ)).toBe(true);
    // Not on the half hour.
    expect(isOffered(rules, [], new Date("2026-09-15T13:15:00Z"), NOW, TZ)).toBe(false);
    // Inside the notice.
    expect(isOffered(rules, [], new Date("2026-09-14T13:00:00Z"), NOW, TZ)).toBe(false);
    // Taken.
    const busy = [{ startsAt: new Date("2026-09-15T13:00:00Z"), endsAt: new Date("2026-09-15T13:30:00Z") }];
    expect(isOffered(rules, busy, new Date("2026-09-15T13:00:00Z"), NOW, TZ)).toBe(false);
    expect(isOffered(rules, busy, new Date("2026-09-15T13:30:00Z"), NOW, TZ)).toBe(true);
    // A weekend day is never offered.
    expect(isOffered({ ...rules, leadHours: 0 }, [], new Date("2026-09-19T13:00:00Z"), NOW, TZ)).toBe(false);
  });

  it("says a time the way a person would", () => {
    expect(timeLabel(new Date("2026-09-15T13:00:00Z"), TZ)).toBe("9:00 am");
    expect(dayLabel("2026-09-15")).toBe("Tue, Sep 15");
    expect(describeBooking(new Date("2026-09-15T13:00:00Z"), new Date("2026-09-15T13:30:00Z"), TZ)).toBe(
      "Tuesday, September 15, 9:00 am to 9:30 am",
    );
  });

  it("checks a request the way the enquiry form is checked, with a time in front", () => {
    const good = { site: "oak-row-farm", page: "/contact", section: "1", start: "2026-09-15T13:00:00.000Z", name: " Jane Doe ", email: "jane@example.com", phone: "", note: "x".repeat(1200) };
    const parsed = SiteBookingSchema.parse(good);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.section).toBe(1);
    expect(parsed.note).toHaveLength(1000);
    expect(SiteBookingSchema.safeParse({ ...good, start: "tomorrow at nine" }).success).toBe(false);
    expect(SiteBookingSchema.safeParse({ ...good, email: "nope" }).success).toBe(false);
    expect(SiteBookingSchema.parse({ ...good, note: undefined }).note).toBe("");
  });

  it("writes the follow-up and the email as a booking", () => {
    const words: EnquiryWords = {
      siteTitle: "Oak Row Farm",
      pagePath: "/contact",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "",
      message: "Booked Farm visit for Tuesday, September 15, 9:00 am to 9:30 am.",
      answers: [],
      receivedOn: "2026-09-14",
      booking: { title: "Farm visit", when: "Tuesday, September 15, 9:00 am to 9:30 am" },
    };
    expect(bookingWorkTitle("Jane Doe")).toBe("Confirm the booking with Jane Doe");
    expect(enquiryNotes(words).split("\n")[0]).toBe(
      "Jane Doe booked Farm visit for Tuesday, September 15, 9:00 am to 9:30 am, from Oak Row Farm (/contact), 2026-09-14.",
    );
    const mail = enquiryEmail(words, { followUp: true, contact: true });
    expect(mail.subject).toBe("Jane Doe booked Farm visit from your website");
    expect(mail.text).toContain("Jane Doe booked Farm visit for Tuesday, September 15, 9:00 am to 9:30 am on Oak Row Farm (/contact).");
    expect(mail.text).toContain("Reply to this email to confirm with them. It is also on your Bookings calendar in Yosher, as a follow-up, and on their contact record.");
    // A plain message reads as it always did.
    const plain = enquiryEmail({ ...words, booking: undefined, message: "Hello" }, { followUp: true, contact: false });
    expect(plain.subject).toBe("Jane Doe sent a message from your website");
    expect(plain.text).toContain("Reply to this email to answer them. It is also in your Yosher workspace and as a follow-up.");
  });
});
