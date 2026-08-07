import type { AttentionItem } from "@/lib/attention-sources/types";
import type { PersonDigest } from "./digest";

/**
 * Rendering the morning email.
 *
 * NOT "server-only" and importing no database: this is a pure function of a
 * digest, so it can be unit-tested against a fixture and — more importantly —
 * the in-app page and the email can be rendered from the SAME digest object in
 * a test that asserts they report the same number.
 *
 * Four rules, all from the design, all load-bearing:
 *
 *  1. **Lead with the delta.** "2 new since yesterday, 3 still waiting", not an
 *     identical list every morning. A mail that looks the same on day 5 as on
 *     day 1 has taught the reader it contains nothing.
 *  2. **Actionable without clicking.** Every item's title and due state is in
 *     the body. The link is for acting, not for finding out what this is about
 *     — somebody reading on a phone between jobs should be able to decide
 *     whether it can wait without opening anything.
 *  3. **"Nothing needs you today" is a message, not silence.** Silence is
 *     ambiguous: the reader cannot tell a quiet day from a broken cron. Send
 *     the all-clear.
 *  4. **One number everywhere.** The count here and the count on
 *     /dashboard/today come from the same items, and when a source could not be
 *     asked BOTH say so rather than quietly reporting a floor as a total.
 */

/** Where links point. Falls back to the production host. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://yosherapp.com";
}

function absolute(href: string): string {
  return `${appUrl().replace(/\/$/, "")}${href}`;
}

/**
 * The subject line — the only part most people read.
 *
 * Leads with the number, because "3 things need you" survives a notification
 * shade and "Your daily summary" does not. The all-clear is phrased as a
 * statement rather than a count so it cannot be mistaken for zero-as-an-error.
 */
export function digestSubject(digest: PersonDigest): string {
  const n = digest.items.length;
  if (n === 0) {
    return digest.complete
      ? "Nothing needs you today"
      : "Your daily summary (incomplete)";
  }
  const noun = n === 1 ? "thing needs" : "things need";
  const newCount = digest.delta.first ? 0 : digest.delta.newKeys.length;
  return newCount > 0
    ? `${n} ${noun} you (${newCount} new)`
    : `${n} ${noun} you`;
}

/**
 * The one-line summary under the greeting. This is the delta rule, and it is
 * the difference between a digest and a recurring list.
 */
export function deltaSentence(digest: PersonDigest): string {
  const { newKeys, carriedKeys, first } = digest.delta;
  const total = digest.items.length;
  if (total === 0) return "Nothing is outstanding.";
  if (first) {
    return total === 1
      ? "One thing is outstanding."
      : `${total} things are outstanding.`;
  }
  if (newKeys.length === 0) {
    return carriedKeys.length === 1
      ? "Nothing new since last time — 1 still waiting."
      : `Nothing new since last time — ${carriedKeys.length} still waiting.`;
  }
  if (carriedKeys.length === 0) {
    return newKeys.length === 1
      ? "1 new since last time."
      : `${newKeys.length} new since last time.`;
  }
  return `${newKeys.length} new since last time, ${carriedKeys.length} still waiting.`;
}

/** The "we could not ask X" line, or null when everything answered. */
export function incompleteSentence(digest: PersonDigest): string | null {
  if (digest.failed.length === 0) return null;
  const labels = digest.failed.map((f) => f.label);
  const joined =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `We could not check ${joined} this morning, so this list may be short.`;
}

function itemLine(item: AttentionItem, isNew: boolean): string {
  const marker = isNew ? "NEW  " : "     ";
  const detail = item.detail ? ` — ${item.detail}` : "";
  return `${marker}${item.title}${detail}\n       ${absolute(item.href)}`;
}

/** Plain text. The version that always arrives intact. */
export function renderDigestText(digest: PersonDigest): string {
  const greeting = digest.name ? `Morning, ${digest.name.split(" ")[0]}.` : "Morning.";
  const lines: string[] = [greeting, "", deltaSentence(digest)];

  const incomplete = incompleteSentence(digest);
  if (incomplete) lines.push("", incomplete);

  if (digest.items.length > 0) {
    const isNew = new Set(digest.delta.newKeys);
    const mine = digest.items.filter((i) => !i.unassigned);
    const unassigned = digest.items.filter((i) => i.unassigned);

    if (mine.length > 0) {
      lines.push("", "—".repeat(40), "");
      for (const item of mine) lines.push(itemLine(item, isNew.has(item.key)), "");
    }
    if (unassigned.length > 0) {
      lines.push("", "NOT ASSIGNED TO ANYONE", "");
      for (const item of unassigned) {
        lines.push(itemLine(item, isNew.has(item.key)), "");
      }
    }
  } else if (digest.complete) {
    lines.push("", "No follow-ups due and nothing waiting on you.");
  }

  lines.push(
    "",
    "—".repeat(40),
    `See everything: ${absolute("/dashboard/today")}`,
    `Stop these emails: ${absolute("/dashboard/today")}`,
  );
  return lines.join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML. Table-free, inline-styled, and deliberately plain — this is read on
 * phones in vans, and every clever layout is a thing that renders wrong in
 * somebody's client.
 */
export function renderDigestHtml(digest: PersonDigest): string {
  const isNew = new Set(digest.delta.newKeys);
  const mine = digest.items.filter((i) => !i.unassigned);
  const unassigned = digest.items.filter((i) => i.unassigned);
  const incomplete = incompleteSentence(digest);

  const renderItem = (item: AttentionItem) => {
    const badge = isNew.has(item.key)
      ? `<span style="background:#1d4ed8;color:#fff;font-size:11px;padding:2px 6px;border-radius:4px;margin-right:8px;">NEW</span>`
      : "";
    const detail = item.detail
      ? `<div style="color:#6b7280;font-size:13px;margin-top:2px;">${esc(item.detail)}</div>`
      : "";
    return `
      <div style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
        ${badge}<a href="${esc(absolute(item.href))}" style="color:#111827;font-weight:600;text-decoration:none;font-size:15px;">${esc(item.title)}</a>
        ${detail}
      </div>`;
  };

  const sections: string[] = [];
  if (mine.length > 0) sections.push(mine.map(renderItem).join(""));
  if (unassigned.length > 0) {
    sections.push(`
      <div style="margin-top:28px;">
        <div style="font-size:13px;font-weight:600;color:#111827;">Not assigned to anyone</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">
          Nobody has picked these up. You see them because you own the business.
        </div>
        ${unassigned.map(renderItem).join("")}
      </div>`);
  }
  if (digest.items.length === 0 && digest.complete) {
    sections.push(
      `<p style="color:#6b7280;font-size:15px;">No follow-ups due and nothing waiting on you.</p>`,
    );
  }

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
  <p style="font-size:16px;margin:0 0 4px;">${digest.name ? `Morning, ${esc(digest.name.split(" ")[0])}.` : "Morning."}</p>
  <p style="font-size:15px;color:#374151;margin:0 0 20px;">${esc(deltaSentence(digest))}</p>
  ${
    incomplete
      ? `<p style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 12px;font-size:13px;color:#92400e;margin:0 0 20px;">${esc(incomplete)}</p>`
      : ""
  }
  ${sections.join("")}
  <p style="margin-top:28px;font-size:13px;">
    <a href="${esc(absolute("/dashboard/today"))}" style="color:#1d4ed8;">See everything in Yosher</a>
  </p>
  <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
    You get this because you have outstanding work in Yosher.
    <a href="${esc(absolute("/dashboard/today"))}" style="color:#6b7280;">Turn these emails off</a>.
  </p>
</div>`.trim();
}
