import { describe, expect, it } from "vitest";
import {
  frameFromInput,
  frameInputFrom,
  linkProblem,
  webUrlProblem,
  type FrameInput,
} from "../src/lib/sites/frame";
import {
  guessNetwork,
  isSafeHref,
  isWebUrl,
  LINK_HINT,
  LINK_RULE,
  socialLabel,
  WEB_URL_HINT,
} from "../src/lib/sites/links";
import {
  CtaSchema,
  EMPTY_SETTINGS,
  readSiteSettings,
  SectionSchema,
  SiteSettingsSchema,
  SocialLinkSchema,
} from "../src/lib/sites/schema";

const blank: FrameInput = {
  announcement: { text: "", href: "", shown: false },
  headerButton: { label: "", href: "" },
  social: [],
  footerColumns: [],
  footerNote: "",
};

describe("a link an owner types", () => {
  it("is one of four shapes and nothing else", () => {
    for (const ok of [
      "/",
      "/contact",
      "/about/team",
      "https://example.com/x?y=1",
      "http://example.com",
      "HTTPS://EXAMPLE.COM",
      "mailto:hi@example.com",
      "tel:+15555550100",
    ]) {
      expect(isSafeHref(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "   ",
      "contact",
      "www.example.com",
      "//evil.example",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,hi",
      "ftp://files.example",
    ]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
  });

  it("is refused by the content model, on a button and on a card, in the rule's own words", () => {
    expect(CtaSchema.safeParse({ label: "Go", href: "javascript:alert(1)" }).success).toBe(false);
    expect(CtaSchema.safeParse({ label: "Go", href: "/contact" }).success).toBe(true);
    const bad = SectionSchema.safeParse({
      type: "columns",
      heading: "",
      cards: [{ id: "card01", heading: "x", cta: { label: "Go", href: "//evil.example" } }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe(LINK_RULE);
  });

  it("is named under the field as it is typed, and only when something is wrong", () => {
    expect(linkProblem("")).toBeNull();
    expect(linkProblem("/contact")).toBeNull();
    expect(linkProblem("www.example.com")).toBe(LINK_HINT);
    expect(webUrlProblem("")).toBeNull();
    expect(webUrlProblem("https://www.facebook.com/oakrow")).toBeNull();
    expect(webUrlProblem("facebook.com/oakrow")).toBe(WEB_URL_HINT);
  });
});

describe("a profile elsewhere", () => {
  it("is a web address on a real host", () => {
    expect(isWebUrl("https://www.instagram.com/oakrow")).toBe(true);
    expect(isWebUrl("http://x.com/oakrow")).toBe(true);
    expect(isWebUrl(" https://x.com/oakrow ")).toBe(true);
    expect(isWebUrl("https://localhost/x")).toBe(false);
    expect(isWebUrl("mailto:hi@example.com")).toBe(false);
    expect(isWebUrl("https://")).toBe(false);
    expect(SocialLinkSchema.safeParse({ network: "facebook", url: "ftp://x.example.com" }).success).toBe(false);
    expect(SocialLinkSchema.safeParse({ network: "myspace", url: "https://myspace.com/x" }).success).toBe(false);
    expect(SocialLinkSchema.parse({ network: "facebook", url: "https://fb.com/x" })).toEqual({
      network: "facebook",
      url: "https://fb.com/x",
      label: "",
    });
  });

  it("knows its network from the address", () => {
    expect(guessNetwork("https://www.facebook.com/oakrow")).toBe("facebook");
    expect(guessNetwork("https://fb.me/oakrow")).toBe("facebook");
    expect(guessNetwork("https://youtu.be/abc")).toBe("youtube");
    expect(guessNetwork("https://twitter.com/oakrow")).toBe("x");
    expect(guessNetwork("https://www.linkedin.com/company/oakrow")).toBe("linkedin");
    expect(guessNetwork("https://www.etsy.com/shop/oakrow")).toBeNull();
    expect(guessNetwork("https://notfacebook.com/x")).toBeNull();
    expect(guessNetwork("notaurl")).toBeNull();
  });

  it("is called by its network's name, or by the owner's own", () => {
    expect(socialLabel({ network: "youtube", label: "ignored" })).toBe("YouTube");
    expect(socialLabel({ network: "other", label: "Etsy shop" })).toBe("Etsy shop");
    expect(socialLabel({ network: "other", label: "  " })).toBe("Website");
  });
});

describe("the frame around every page", () => {
  it("is empty on a site saved before it existed, and the details still read", () => {
    expect(readSiteSettings({ phone: "555", hoursLines: ["Sat 8-12"] })).toEqual({
      ...EMPTY_SETTINGS,
      phone: "555",
      hoursLines: ["Sat 8-12"],
    });
    expect(SiteSettingsSchema.parse({}).announcement).toEqual({ text: "", href: "", shown: false });
    expect(
      SiteSettingsSchema.safeParse({ social: new Array(9).fill({ network: "x", url: "https://x.com/a" }) }).success,
    ).toBe(false);
    expect(
      SiteSettingsSchema.safeParse({ footerColumns: [{ links: new Array(7).fill({ label: "a", href: "/" }) }] })
        .success,
    ).toBe(false);
    expect(SiteSettingsSchema.safeParse({ footerColumns: new Array(4).fill({}) }).success).toBe(false);
  });

  it("round-trips through the form", () => {
    const settings = SiteSettingsSchema.parse({
      headerButton: { label: "Book", href: "/contact" },
      social: [{ network: "other", url: "https://etsy.com/shop/x", label: "Etsy shop" }],
      footerColumns: [{ heading: "Visit", text: "Sat", links: [{ label: "Map", href: "https://maps.example.com/x" }] }],
      footerNote: "Since 1978",
    });
    const input = frameInputFrom(settings);
    expect(input.headerButton).toEqual({ label: "Book", href: "/contact" });
    expect(frameFromInput(input)).toEqual({
      ok: true,
      frame: {
        announcement: settings.announcement,
        headerButton: settings.headerButton,
        social: settings.social,
        footerColumns: settings.footerColumns,
        footerNote: "Since 1978",
      },
    });
    expect(frameInputFrom(EMPTY_SETTINGS).headerButton).toEqual({ label: "", href: "" });
  });

  it("drops the blank rows and keeps the words of a bar that is switched off", () => {
    const check = frameFromInput({
      ...blank,
      announcement: { text: " Closed Monday ", href: "", shown: false },
      social: [
        { network: "facebook", url: "", label: "" },
        { network: "instagram", url: " https://instagram.com/x ", label: "not for a known network" },
      ],
      footerColumns: [
        { heading: "", text: "", links: [{ label: "", href: "" }] },
        { heading: "Visit", text: "", links: [{ label: " Map ", href: " /contact " }, { label: "", href: "" }] },
      ],
      footerNote: " ",
    });
    expect(check).toEqual({
      ok: true,
      frame: {
        announcement: { text: "Closed Monday", href: "", shown: false },
        headerButton: null,
        social: [{ network: "instagram", url: "https://instagram.com/x", label: "" }],
        footerColumns: [{ heading: "Visit", text: "", links: [{ label: "Map", href: "/contact" }] }],
        footerNote: "",
      },
    });
  });

  it("names what is wrong, one thing at a time", () => {
    const message = (input: Partial<FrameInput>) => {
      const check = frameFromInput({ ...blank, ...input });
      return check.ok ? null : check.message;
    };
    const shapes = "needs to be a page on this site such as /contact, a full https:// address, or a mailto: or tel: link.";
    expect(message({ announcement: { text: "Hi", href: "www.x.com", shown: true } })).toBe(
      `The announcement bar's link ${shapes}`,
    );
    expect(message({ headerButton: { label: "Book", href: "" } })).toBe("The header button needs a link.");
    expect(message({ headerButton: { label: "", href: "/contact" } })).toBe("The header button needs a label.");
    expect(message({ headerButton: { label: "Book", href: "javascript:alert(1)" } })).toBe(
      `The header button's link ${shapes}`,
    );
    expect(message({ social: [{ network: "facebook", url: "facebook.com/x", label: "" }] })).toBe(
      "Every social link needs a full address that starts with https://.",
    );
    const column = (links: Array<{ label: string; href: string }>) => ({
      footerColumns: [{ heading: "", text: "", links }],
    });
    expect(message(column([{ label: "Map", href: "" }]))).toBe('The footer link "Map" needs a link.');
    expect(message(column([{ label: "", href: "/about" }]))).toBe("The footer link to /about needs a label.");
    expect(message(column([{ label: "Map", href: "maps.example.com" }]))).toBe(`The footer link "Map" ${shapes}`);
  });
});
