import { describe, expect, it } from "vitest";
import {
  ANSWER_LONG_MAX,
  ANSWER_TEXT_MAX,
  answerInputName,
  answersFromForm,
  ENQUIRY_MESSAGE_MAX,
  enquiryEmail,
  enquiryNotes,
  enquiryWorkTitle,
  fieldErrorsFrom,
  FORM_FIELD_KINDS,
  newFormField,
  readEnquiryAnswers,
  SiteEnquirySchema,
  splitPersonName,
} from "../src/lib/sites/enquiry-schema";
import { assembleSite, standardSiteCopy } from "../src/lib/sites/copy";
import { newSection, sectionSummary } from "../src/lib/sites/pages";
import { FormFieldSchema, PageContentSchema, SectionSchema, type FormField } from "../src/lib/sites/schema";

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

  it("caps the phone and the page path, and reads the section's place as a number", () => {
    expect(SiteEnquirySchema.safeParse({ ...good, phone: "1".repeat(41) }).success).toBe(false);
    expect(SiteEnquirySchema.parse({ ...good, page: undefined }).page).toBe("/");
    expect(SiteEnquirySchema.parse({ ...good, section: "2" }).section).toBe(2);
    expect(SiteEnquirySchema.parse(good).section).toBe(0);
    expect(SiteEnquirySchema.safeParse({ ...good, section: "12" }).success).toBe(false);
  });
});

describe("the business's own questions", () => {
  const fields: FormField[] = [
    { id: "head01", label: "How many head?", kind: "text", required: true, options: [] },
    { id: "detail", label: "Anything else", kind: "long", required: false, options: [] },
    { id: "pickup", label: "Pickup day", kind: "choice", required: true, options: ["Friday", "Saturday"] },
    { id: "trade1", label: "Is this for a business?", kind: "yesno", required: false, options: [] },
  ];
  const form = (values: Record<string, string>) => (name: string) => values[name] ?? "";

  it("names each input after the question's id", () => {
    expect(answerInputName("head01")).toBe("q_head01");
  });

  it("files answers under the question's words and skips what was left blank", () => {
    const { answers, errors } = answersFromForm(
      fields,
      form({ q_head01: " 12 ", q_pickup: "Friday", q_trade1: "on" }),
    );
    expect(errors).toEqual({});
    expect(answers).toEqual([
      { label: "How many head?", value: "12" },
      { label: "Pickup day", value: "Friday" },
      { label: "Is this for a business?", value: "Yes" },
    ]);
    expect(answersFromForm(fields, form({ q_head01: "1", q_pickup: "Saturday" })).answers).toContainEqual({
      label: "Is this for a business?",
      value: "No",
    });
  });

  it("refuses a missing required answer, a choice that is not offered, and too long an answer", () => {
    const { errors } = answersFromForm(fields, form({ q_pickup: "Sunday", q_detail: "x".repeat(ANSWER_LONG_MAX + 1) }));
    expect(errors.q_head01).toBe("This one is needed to send.");
    expect(errors.q_pickup).toBe("Pick one of the choices.");
    expect(errors.q_detail).toMatch(/Keep this under 1,000 characters/);
    expect(answersFromForm(fields, form({ q_head01: "y".repeat(ANSWER_TEXT_MAX + 1), q_pickup: "Friday" })).errors.q_head01).toMatch(/200/);
    expect(answersFromForm(fields, form({ q_head01: "3" })).errors.q_pickup).toBe("Pick one to send.");
    const mustTick: FormField[] = [{ ...fields[3], required: true }];
    expect(answersFromForm(mustTick, form({})).errors.q_trade1).toBe("Tick this one to send.");
  });

  it("offers four kinds, and a fresh question of each is valid", () => {
    expect(FORM_FIELD_KINDS.map((k) => k.kind)).toEqual(["text", "long", "choice", "yesno"]);
    for (const { kind } of FORM_FIELD_KINDS) {
      expect(FormFieldSchema.safeParse(newFormField("abc123", kind)).success).toBe(true);
    }
    expect(newFormField("abc123", "choice").options.length).toBeGreaterThan(0);
    expect(FormFieldSchema.safeParse({ id: "ABC", label: "x", kind: "text" }).success).toBe(false);
  });

  it("reads stored answers tolerantly", () => {
    expect(readEnquiryAnswers([{ label: "A", value: "1" }, { nope: true }])).toEqual([]);
    expect(readEnquiryAnswers([{ label: "A", value: "1" }])).toEqual([{ label: "A", value: "1" }]);
    expect(readEnquiryAnswers("junk")).toEqual([]);
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
    answers: [{ label: "How many head?", value: "2" }],
    receivedOn: "2026-09-04",
  };

  it("writes the follow-up's notes with where it came from and everything sent", () => {
    const notes = enquiryNotes(words);
    expect(notes).toContain("A message from the form on Oak Row Farm (/contact), 2026-09-04.");
    expect(notes).toContain("Email: jane@example.com");
    expect(notes).toContain("Phone: 740 555 0100");
    expect(notes).toContain("How many head?: 2");
    expect(notes.endsWith(words.message)).toBe(true);
    expect(enquiryNotes({ ...words, phone: "", pagePath: "/" })).not.toContain("Phone:");
    expect(enquiryNotes({ ...words, pagePath: "/" })).toContain("on Oak Row Farm, 2026-09-04.");
  });

  it("writes the business's email so that Reply reaches the sender, and says where else it landed", () => {
    const withContact = enquiryEmail(words, { followUp: true, contact: true });
    expect(withContact.subject).toBe("Jane Doe sent a message from your website");
    expect(withContact.text).toContain("Reply to this email to answer them.");
    expect(withContact.text).toContain("How many head?: 2");
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
    expect(parsed).toEqual({ type: "form", heading: "Write to us", note: "", buttonLabel: "", askPhone: true, thanks: "", fields: [] });
    expect(SectionSchema.safeParse({ type: "form", heading: "x", fields: Array.from({ length: 7 }, (_, i) => newFormField(`q${i}0000`, "text")) }).success).toBe(false);
  });

  it("is on every assembled contact page, after the details", () => {
    const brief = { name: "Oak Row Farm", tagline: "", industry: null, phone: "", email: "", address: "", hoursLines: [] };
    const pages = assembleSite(brief, standardSiteCopy(brief));
    const contact = pages.find((p) => p.path === "/contact");
    expect(contact?.content.sections.map((s) => s.type)).toEqual(["contact", "form"]);
    expect(PageContentSchema.safeParse(contact?.content).success).toBe(true);
  });
});
