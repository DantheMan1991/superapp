import { isSafeHref, isWebUrl, LINK_HINT, WEB_URL_HINT, type SocialNetwork } from "./links";
import type { SiteSettings } from "./schema";

/**
 * The frame around every page — announcement bar, header button, profiles
 * elsewhere, footer columns and note — between the form an owner fills in
 * and the settings the renderer reads. Pure.
 *
 * The form holds every row as typed, blanks included, so an owner can add a
 * row and think. Saving is where the blanks go and the rules apply, and
 * every refusal names the row it is about.
 */
export interface FrameInput {
  announcement: { text: string; href: string; shown: boolean };
  headerButton: { label: string; href: string };
  social: Array<{ network: SocialNetwork; url: string; label: string }>;
  footerColumns: Array<{
    heading: string;
    text: string;
    links: Array<{ label: string; href: string }>;
  }>;
  footerNote: string;
}

export type Frame = Pick<
  SiteSettings,
  "announcement" | "headerButton" | "social" | "footerColumns" | "footerNote"
>;

export type FrameCheck = { ok: true; frame: Frame } | { ok: false; message: string };

/** The settings as the form starts: a missing button is an empty row. */
export function frameInputFrom(settings: SiteSettings): FrameInput {
  return {
    announcement: { ...settings.announcement },
    headerButton: settings.headerButton
      ? { label: settings.headerButton.label, href: settings.headerButton.href }
      : { label: "", href: "" },
    social: settings.social.map((s) => ({ network: s.network, url: s.url, label: s.label })),
    footerColumns: settings.footerColumns.map((c) => ({
      heading: c.heading,
      text: c.text,
      links: c.links.map((l) => ({ label: l.label, href: l.href })),
    })),
    footerNote: settings.footerNote,
  };
}

function linkMessage(where: string): string {
  return `${where} needs to be a page on this site such as /contact, a full https:// address, or a mailto: or tel: link.`;
}

/** What is wrong with one link as typed, or nothing. Shared by the form (inline) and the save (refusal). */
export function linkProblem(href: string): string | null {
  return href.trim() === "" || isSafeHref(href) ? null : LINK_HINT;
}

export function webUrlProblem(url: string): string | null {
  return url.trim() === "" || isWebUrl(url) ? null : WEB_URL_HINT;
}

/** The form, checked and trimmed of blanks, or the first thing wrong with it. */
export function frameFromInput(input: FrameInput): FrameCheck {
  const announcement = {
    text: input.announcement.text.trim(),
    href: input.announcement.href.trim(),
    shown: input.announcement.shown,
  };
  if (announcement.href && !isSafeHref(announcement.href)) {
    return { ok: false, message: linkMessage("The announcement bar's link") };
  }

  const button = { label: input.headerButton.label.trim(), href: input.headerButton.href.trim() };
  if (button.label && !button.href) return { ok: false, message: "The header button needs a link." };
  if (button.href && !button.label) return { ok: false, message: "The header button needs a label." };
  if (button.href && !isSafeHref(button.href)) {
    return { ok: false, message: linkMessage("The header button's link") };
  }

  const social: Frame["social"] = [];
  for (const row of input.social) {
    const url = row.url.trim();
    if (!url) continue;
    if (!isWebUrl(url)) {
      return { ok: false, message: "Every social link needs a full address that starts with https://." };
    }
    social.push({ network: row.network, url, label: row.network === "other" ? row.label.trim() : "" });
  }

  const footerColumns: Frame["footerColumns"] = [];
  for (const column of input.footerColumns) {
    const links: Frame["footerColumns"][number]["links"] = [];
    for (const link of column.links) {
      const label = link.label.trim();
      const href = link.href.trim();
      if (!label && !href) continue;
      if (!href) return { ok: false, message: `The footer link "${label}" needs a link.` };
      if (!label) return { ok: false, message: `The footer link to ${href} needs a label.` };
      if (!isSafeHref(href)) return { ok: false, message: linkMessage(`The footer link "${label}"`) };
      links.push({ label, href });
    }
    const heading = column.heading.trim();
    const text = column.text.trim();
    if (!heading && !text && links.length === 0) continue;
    footerColumns.push({ heading, text, links });
  }

  return {
    ok: true,
    frame: {
      announcement,
      headerButton: button.label ? button : null,
      social,
      footerColumns,
      footerNote: input.footerNote.trim(),
    },
  };
}
