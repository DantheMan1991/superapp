import { describe, expect, it } from "vitest";
import {
  ENQUIRY_MESSAGE_MAX,
  enquiryEmail,
  enquiryNotes,
  enquiryWorkTitle,
  fieldErrorsFrom,
  SiteEnquirySchema,
  splitPersonName,
} from "../src/lib/sites/enquiry-schema";
import { assembleSite, standardSiteCopy } from "../src/lib/sites/copy";
import { newSection, sectionSummary } from "../src/lib/sites/pages";
import { PageContentSchema, SectionSchema } from "../src/lib/sites/schema";

const good = {
  site: "oak-row-farm",
  page: "/contact",
  name: "  Jane Doe ",
  email: "Jane@Example.com",
  phone: "",
  message: "Do you have half a beef this autumn?",
};

describe("the enquiry form's shape", () => {
  it("trims what people type and keeps the message", () => {
    const parsed = SiteEnquirySchema.parse(good);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.email).toBe("Jane@Example.com");
    expect(parsed.phone).toBe("");
    expect(parsed.page).toBe("/contact");
  });

  it("truncates a long message rather than refusing it, and refuses an empty one", () => {
    const long = SiteEnquirySchema.parse({ ...good, message: "x".repeat(ENQUIRY_MESSAGE_MAX + 500) });
    expect(long.message).toHaveLength(ENQUIRY_MESSAGE_MAX);
    expect(SiteEnquirySchema.safeParse({ ...good, message: "hi" }).success).toBe(false);
  });

  it("names the field that is wrong, once each, in the form's own words", () => {
    const result = SiteEnquirySchema.safeParse({ ...good, name: "", email: "not-an-email", message: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrorsFrom(result.error.issues);
    expect(errors.name).toBe("Tell us who you are.");
    expect(errors.email).toMatch(/doesn't look right/);
    expect(errors.message).toBe("Tell us a little about what you need.");
    expect(Object.keys(errors).sort()).toEqual(["email", "message", "name"]);
  });

  it("caps the phone and the page path", () => {
    expect(SiteEnquirySchema.safeParse({ ...good, phone: "1".repeat(41) }).success).toBe(false);
    expect(SiteEnquirySchema.parse({ ...good, page: undefined }).page).toBe("/");
  });
});

describe("what a message becomes", () => {
  it("splits a name into a given and a family name without inventing either", () => {
    expect(splitPersonName("Jane Doe")).toEqual({ givenName: "Jane", familyName: "Doe" });
    expect(splitPersonName("Jane van der Berg")).toEqual({ givenName: "Jane", familyName: "van der Berg" });
    expect(splitPersonName("  Jane ")).toEqual({ givenName: "Jane", familyName: null });
    expect(splitPersonName("")).toEqual({ givenName: null, familyName: null });
  });

  it("titles the follow-up as the thing to do, within the title's room", () => {
    expect(enquiryWorkTitle("Jane Doe")).toBe("Reply to Jane Doe");
    expect(enquiryWorkTitle("x".repeat(200)).length).toBeLessThanOrEqual(120);
  });

  const words = {
    siteTitle: "Oak Row Farm",
    pagePath: "/contact",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "740 555 0100",
    message: "Do you have half a beef this autumn?",
    receivedOn: "2026-09-04",
  };

  it("writes the follow-up's notes with where it came from and everything sent", () => {
    const notes = enquiryNotes(words);
    expect(notes).toContain("A message from the form on Oak Row Farm (/contact), 2026-09-04.");
    expect(notes).toContain("Email: jane@example.com");
    expect(notes).toContain("Phone: 740 555 0100");
    expect(notes.endsWith(words.message)).toBe(true);
    expect(enquiryNotes({ ...words, phone: "", pagePath: "/" })).not.toContain("Phone:");
    expect(enquiryNotes({ ...words, pagePath: "/" })).toContain("on Oak Row Farm, 2026-09-04.");
  });

  it("writes the business's email so that Reply reaches the sender, and says where else it landed", () => {
    const withContact = enquiryEmail(words, { followUp: true, contact: true });
    expect(withContact.subject).toBe("Jane Doe sent a message from your website");
    expect(withContact.text).toContain("Reply to this email to answer them.");
    expect(withContact.text).toContain("on their contact record");
    const withoutCrm = enquiryEmail(words, { followUp: true, contact: false });
    expect(withoutCrm.text).toContain("as a follow-up.");
    expect(withoutCrm.text).not.toContain("contact record");
    // Nothing sent to a person carries an em dash.
    expect(withContact.text).not.toContain("—");
  });
});

describe("the form section", () => {
  it("is a section the model knows, with sensible words to start", () => {
    const fresh = newSection("form");
    expect(SectionSchema.safeParse(fresh).success).toBe(true);
    expect(sectionSummary(fresh)).toBe("Send us a message");
    const parsed = SectionSchema.parse({ type: "form", heading: "Write to us" });
    expect(parsed).toEqual({ type: "form", heading: "Write to us", note: "", buttonLabel: "", askPhone: true, thanks: "" });
  });

  it("is on every assembled contact page, after the details", () => {
    const brief = { name: "Oak Row Farm", tagline: "", industry: null, phone: "", email: "", address: "", hoursLines: [] };
    const pages = assembleSite(brief, standardSiteCopy(brief));
    const contact = pages.find((p) => p.path === "/contact");
    expect(contact?.content.sections.map((s) => s.type)).toEqual(["contact", "form"]);
    expect(PageContentSchema.safeParse(contact?.content).success).toBe(true);
  });
});
