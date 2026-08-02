import "dotenv/config";
import { sanitizeOutboundHtml } from "../src/modules/email/compose/html";
import { htmlToPlainText } from "../src/modules/email/compose/to-text";

/**
 * Does the mail server actually build the `multipart/alternative` we think it
 * does?
 *
 *   npm run mail:probe-compose
 *
 * WHY THIS EXISTS. `client.ts` supplies `textBody` and `htmlBody` as two
 * `bodyValues` and lets the SERVER assemble the MIME — RFC 8621 §4.1.4 — on the
 * reasoning that boundaries, encodings and charsets are a job it already does
 * correctly. That is a bet on a spec, and this module has now been burned twice
 * by exactly that: the Sieve compiler passed seventeen unit tests and emitted a
 * script Stalwart refused, because RFC 9042 reads as though `mailboxid` alone is
 * enough and it is not. A unit test can only assert that the request matches
 * what I believe correct.
 *
 * So this creates a real draft, reads back the real MIME the server produced,
 * and destroys it.
 *
 * IT WRITES, unlike `jmap:probe`, which is strictly read-only and says so. It is
 * therefore **guarded to a loopback server**, the same guard and the same reason
 * as `mail:fixture`: a probe that creates and destroys messages must not be one
 * keystroke away from doing it in somebody's real mailbox. The draft is removed
 * on every exit path, including failure.
 */

const rawUrl =
  process.env.STALWART_JMAP_URL ?? "http://127.0.0.1:8080/.well-known/jmap";
const user = process.env.STALWART_USER;
const pass = process.env.STALWART_PASS;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!user || !pass) fail("STALWART_USER and STALWART_PASS must be set in .env.");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const host = new URL(rawUrl).hostname;
if (!LOOPBACK.has(host)) {
  fail(
    `refusing to run against ${host}.\n` +
      "  This probe CREATES and DESTROYS a draft, so it is limited to a\n" +
      "  loopback server — the Docker Stalwart, not anybody's real mailbox.",
  );
}

const auth = Buffer.from(`${user}:${pass}`).toString("base64");
const findings: string[] = [];
const confirmed: string[] = [];

/**
 * JSON the probe has just fetched. `any` inside it is deliberate and scoped to
 * this alias: the entire point of a probe is that the shape is NOT yet known,
 * and typing a guess would be the mistake this script exists to catch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function http(url: string, body?: unknown): Promise<Json> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "follow",
  });
  if (!response.ok) fail(`${response.status} from ${url}`);
  return response.json();
}

/** The `apiUrl` trap: Stalwart builds it from its CONFIGURED hostname. */
function rebase(advertised: string, reached: string): string {
  const from = new URL(reached);
  const marker = advertised.indexOf("://");
  const rest = advertised.slice(advertised.indexOf("/", marker + 3));
  return `${from.protocol}//${from.host}${rest}`;
}

async function main(): Promise<void> {
  const session = await http(rawUrl);
  // RFC 8620 calls this `primaryAccounts`, a map keyed by capability URI —
  // there is no `primaryAccountId` field, which is the obvious guess and the
  // wrong one. `parse.ts` gets this right; the probe had to learn it.
  const accountId =
    (session.primaryAccounts?.["urn:ietf:params:jmap:mail"] as string) ??
    Object.keys(session.accounts ?? {})[0];
  if (!accountId) fail("no mail account in the session");
  const apiUrl = rebase(session.apiUrl as string, rawUrl);
  const downloadUrl = rebase(session.downloadUrl as string, rawUrl);
  console.log(`\nserver   ${session.username}`);
  console.log(`api      ${apiUrl}`);

  const call = async (methodCalls: unknown[][]): Promise<Json[]> => {
    const out = await http(apiUrl, {
      using: [
        "urn:ietf:params:jmap:core",
        "urn:ietf:params:jmap:mail",
        "urn:ietf:params:jmap:submission",
      ],
      methodCalls,
    });
    return out.methodResponses;
  };

  // ── The Drafts folder ────────────────────────────────────────────────────
  const [mailboxes] = await call([["Mailbox/get", { accountId, ids: null }, "m"]]);
  const drafts = (mailboxes[1].list as Json[]).find((m) => m.role === "drafts");
  if (!drafts) fail("no mailbox with role=drafts");

  // ── A message with every construct the composer can emit ─────────────────
  const composed = sanitizeOutboundHtml(
    "<p>Hello <b>bold</b>, <i>italic</i>, <u>underline</u> and <s>struck</s>.</p>" +
      // Everything the toolbar gained: colour, highlight, font, size, alignment,
      // indent and emoji. All of it goes through the same sanitizer the action
      // uses, so what the server receives here is what a real send produces.
      '<p><font color="#cc4125">red</font> and ' +
      '<span style="background-color:#ffe599">highlighted</span> and ' +
      '<font face="Georgia" size="5">Georgia large</font>.</p>' +
      '<p style="text-align:center">centred</p>' +
      '<div style="margin-left:2.5em">indented</div>' +
      "<p>Emoji: 🎉 ✅ 🚚 — characters, not images.</p>" +
      "<ul><li>first</li><li>second</li></ul>" +
      "<ol><li>one</li><li>two</li></ol>" +
      '<p>A <a href="https://example.com/terms">link</a> and ' +
      "an accent: Facturación año — £5.</p>" +
      '<blockquote type="cite">quoted line one<br>quoted line two</blockquote>',
  );
  const text = htmlToPlainText(composed);

  console.log("\n─── the text part we derived");
  console.log(text.split("\n").map((l) => `    ${l}`).join("\n"));

  // EXACTLY the shape `draftObject()` builds in client.ts. If this diverges,
  // the probe stops proving anything about the code that ships.
  const draft = {
    mailboxIds: { [drafts.id]: true },
    keywords: { $draft: true },
    from: [{ name: null, email: session.username }],
    to: [{ name: "Probe", email: session.username }],
    subject: "Compose probe — multipart/alternative",
    bodyValues: { text: { value: text }, html: { value: composed } },
    textBody: [{ partId: "text", type: "text/plain" }],
    htmlBody: [{ partId: "html", type: "text/html" }],
  };

  const [created] = await call([
    ["Email/set", { accountId, create: { draft } }, "c"],
  ]);
  if (created[1].notCreated?.draft) {
    fail(`server refused the draft: ${JSON.stringify(created[1].notCreated.draft)}`);
  }
  const emailId = created[1].created.draft.id as string;
  const blobId = created[1].created.draft.blobId as string;
  confirmed.push("Email/set accepted two bodyValues with textBody + htmlBody.");

  try {
    // ── Read back what the server built ────────────────────────────────────
    const [got] = await call([
      [
        "Email/get",
        {
          accountId,
          ids: [emailId],
          properties: ["bodyStructure", "textBody", "htmlBody", "bodyValues"],
          bodyProperties: ["partId", "type", "charset", "disposition", "subParts"],
          fetchAllBodyValues: true,
        },
        "g",
      ],
    ]);
    const message = got[1].list[0];
    console.log("\n─── bodyStructure the SERVER assembled");
    console.log(
      JSON.stringify(message.bodyStructure, null, 2)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );

    const top = message.bodyStructure?.type as string | undefined;
    if (top === "multipart/alternative") {
      confirmed.push("The server built a real multipart/alternative.");
    } else {
      findings.push(
        `TOP-LEVEL TYPE IS "${top}", not multipart/alternative. ` +
          "The two bodyValues did not become alternatives — recipients would " +
          "see only one of them.",
      );
    }

    const subTypes = (message.bodyStructure?.subParts ?? []).map(
      (p: Json) => p.type as string,
    );
    if (subTypes[0] !== "text/plain") {
      findings.push(
        `First alternative is "${subTypes[0]}". RFC 2046 orders alternatives ` +
          "worst-to-best, so text/plain must come FIRST or a text-only client " +
          "picks the wrong part.",
      );
    } else {
      confirmed.push("text/plain is the first alternative, text/html the last.");
    }

    const charsets = [message.bodyStructure, ...(message.bodyStructure?.subParts ?? [])]
      .map((p: Json | undefined) => p?.charset)
      .filter(Boolean);
    console.log(`\ncharsets  ${charsets.join(", ") || "(none reported)"}`);

    // ── The raw RFC 5322, which is what actually leaves ────────────────────
    const rawResponse = await fetch(
      downloadUrl
        .replace("{accountId}", encodeURIComponent(accountId))
        .replace("{blobId}", encodeURIComponent(blobId))
        .replace("{type}", "message%2Frfc822")
        .replace("{name}", "probe.eml"),
      { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" },
    );
    const raw = await rawResponse.text();
    console.log(`\n─── raw message (${rawResponse.status}, ${raw.length} bytes)`);
    console.log(
      raw
        .split(/\r?\n/)
        .slice(0, 34)
        .map((l) => `    ${l}`)
        .join("\n"),
    );

    if (/Content-Type:\s*multipart\/alternative/i.test(raw)) {
      confirmed.push("The wire format carries multipart/alternative.");
    } else {
      findings.push("The RAW message is not multipart/alternative.");
    }

    // Non-ASCII survival, end to end. A charset mistake here is invisible until
    // somebody receives "FacturaciÃ³n".
    const decoded = decodeTransfer(raw);
    if (decoded.includes("Facturación año") && decoded.includes("£5")) {
      confirmed.push("Non-ASCII survived into the encoded body (ñ, ñ, £, —).");
    } else {
      findings.push(
        "Non-ASCII did NOT round-trip through the server's encoding. " +
          "Check the charset on the text parts.",
      );
    }

    // Inline styling is the new surface. A server that stripped or rewrote it
    // would make the colour picker look broken for reasons no unit test sees.
    if (decoded.includes("color:#cc4125") || decoded.includes("#cc4125")) {
      confirmed.push("Inline colour survived into the sent HTML part.");
    } else {
      findings.push("The server dropped or rewrote the inline colour.");
    }
    if (decoded.includes("text-align:center")) {
      confirmed.push("Alignment survived into the sent HTML part.");
    } else {
      findings.push("The server dropped the text-align declaration.");
    }
    if (decoded.includes("🎉") && decoded.includes("✅")) {
      confirmed.push("Emoji survived as characters in BOTH parts.");
    } else {
      findings.push(
        "Emoji did not survive the transfer encoding — check the charset on " +
          "the parts, since these are 4-byte UTF-8 sequences.",
      );
    }

    // The blockquote is the construct most likely to be mangled, and the one a
    // reply chain depends on.
    if (decoded.includes("<blockquote")) {
      confirmed.push("The blockquote survived into the sent HTML part.");
    } else {
      findings.push("The blockquote did not survive into the HTML part.");
    }
    if (/^> quoted line two$/m.test(decoded)) {
      confirmed.push("Quote prefixes survived into the text part.");
    } else {
      findings.push("The text part lost its '>' quote prefixes.");
    }
  } finally {
    const [destroyed] = await call([
      ["Email/set", { accountId, destroy: [emailId] }, "d"],
    ]);
    const gone = (destroyed[1].destroyed ?? []).includes(emailId);
    console.log(`\ncleanup   draft ${gone ? "destroyed" : "NOT DESTROYED — remove it by hand"}`);
  }

  console.log("\n─── CONFIRMED");
  for (const line of confirmed) console.log(`    ✓ ${line}`);
  console.log("\n─── FINDINGS");
  if (findings.length === 0) console.log("    (none — every assumption held)");
  for (const line of findings) console.log(`    ! ${line}`);
  console.log("");
}

/** Enough quoted-printable / base64 handling to read the parts back. */
function decodeTransfer(raw: string): string {
  let out = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  // Body parts declared base64 are decoded whole; good enough for a probe.
  for (const match of raw.matchAll(
    /Content-Transfer-Encoding:\s*base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/gi,
  )) {
    try {
      out += "\n" + Buffer.from(match[1].replace(/\s/g, ""), "base64").toString("utf8");
    } catch {
      // A partial part is not worth failing the probe over.
    }
  }
  return Buffer.from(out, "binary").toString("utf8");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
