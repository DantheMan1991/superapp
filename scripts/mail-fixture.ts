import "dotenv/config";
import net from "node:net";

/**
 * Deliver a deliberately awkward message to the LOCAL dev mail server.
 *
 *   npm run mail:fixture
 *
 * Why this exists: `npm run jmap:probe` cannot certify the shapes that matter
 * most — bodies, `cid`, attachment names, truncation — against an empty
 * mailbox, and it says so rather than passing silently. This is what fills it.
 *
 * The message is built to be hostile on purpose, because the reading pane's
 * whole security model is about surviving exactly this:
 *
 *   • multipart/mixed → multipart/related → multipart/alternative, which is the
 *     real shape of business mail and the one naive parsers get wrong
 *   • an inline image referenced by `cid:`, which must render even while remote
 *     images are blocked
 *   • a REMOTE image, which must NOT load until somebody asks for it
 *   • a <script>, an onerror handler, a javascript: link and a data: URL
 *   • an attachment whose filename is RFC 2047 encoded and contains characters
 *     that are illegal in a Content-Disposition header
 *   • a non-ASCII subject, to prove charset decoding
 *
 * STRICTLY LOCAL. Refuses any host that is not loopback: this sends real SMTP,
 * and pointing it at a real server would mail a real person.
 *
 * EXPECT IT IN JUNK, NOT THE INBOX. Verified against Stalwart 0.16.15: the
 * message arrives from a domain that does not exist, with no SPF and no DKIM,
 * over an unauthenticated local SMTP connection — so the spam filter files it
 * under Junk Mail, which is the filter working rather than the fixture failing.
 * Query without a mailbox filter, or look in Junk, when hunting for it.
 */

const HOST = process.env.STALWART_SMTP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.STALWART_SMTP_PORT ?? 2525);
const TO = process.env.STALWART_USER ?? "admin@yosher.test";
const FROM = "billing@supplier-test.example";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
if (!LOOPBACK.has(HOST)) {
  console.error(
    `\n✗ Refusing to send to "${HOST}".\n` +
      "  This script sends real SMTP and is for the local dev container only.\n",
  );
  process.exit(1);
}

/** A 1×1 transparent PNG — enough to prove an inline part round-trips. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function minimalPdf(): string {
  const pdf = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");
  return Buffer.from(pdf, "latin1").toString("base64");
}

function wrap(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

const CID = "logo-part-1@yosher.test";

/**
 * An RFC 2047 encoded-word filename. Real mail is full of these, and the
 * question the probe must answer is whether the server hands it back decoded or
 * raw — the answer decides whether we need a decoder before Content-Disposition.
 */
const ENCODED_NAME = "=?utf-8?B?" + Buffer.from("Facturación año.pdf", "utf8").toString("base64") + "?=";

const HTML = `<html><head>
<style>body{font-family:sans-serif} .x{background:url(cid:${CID})}</style>
</head><body>
<h1>Invoice 4471</h1>
<p>Hello — the invoice is attached. Our logo: <img src="cid:${CID}" alt="logo" width="1" height="1"></p>
<p>Tracking pixel that must NOT load: <img src="https://tracker.invalid/open.gif?id=abc" width="1" height="1"></p>
<p>SSRF payloads — the proxy must refuse every one of these even once images are unblocked:</p>
<img src="http://169.254.169.254/latest/meta-data/iam/security-credentials/" alt="cloud metadata">
<img src="http://127.0.0.1:8080/jmap/" alt="loopback admin">
<img src="http://[::ffff:127.0.0.1]/x.png" alt="ipv4-mapped loopback">
<img src="http://2130706433/x.png" alt="integer-encoded loopback">
<img src="http://10.0.0.1/x.png" alt="private range">
<img src="http://example.com:5432/x.png" alt="database port">
<p><img srcset="https://tracker.invalid/2x.gif 2x" src="https://tracker.invalid/1x.gif" alt="srcset case"></p>
<p>Links: <a href="https://example.com/real">a real one</a>,
<a href="javascript:alert(1)">a javascript one</a>,
<a href="https://evil.invalid/phish">https://yourbank.example</a></p>
<script>alert('this must never run')</script>
<img src="x" onerror="alert('nor this')">
<iframe src="https://evil.invalid"></iframe>
<div class="x">css cid background</div>
<p>Non-ASCII: façade — “curly quotes” — ünïcöde</p>
</body></html>`;

const TEXT = `Invoice 4471

Hello - the invoice is attached.

See https://example.com/real for details, or mail us at billing@supplier-test.example.

> This is a quoted line
> and a second one
>> and a nested one

--
Supplier Test Ltd
`;

function buildMessage(): string {
  const MIXED = "b0-mixed-yosher";
  const RELATED = "b1-related-yosher";
  const ALT = "b2-alt-yosher";
  const subject =
    "=?utf-8?B?" + Buffer.from("Invoice 4471 — façade works", "utf8").toString("base64") + "?=";

  return [
    `From: "Supplier Test" <${FROM}>`,
    `To: <${TO}>`,
    `Subject: ${subject}`,
    `Message-ID: <fixture-${Date.now()}@yosher.test>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${MIXED}"`,
    "",
    `--${MIXED}`,
    `Content-Type: multipart/related; boundary="${RELATED}"`,
    "",
    `--${RELATED}`,
    `Content-Type: multipart/alternative; boundary="${ALT}"`,
    "",
    `--${ALT}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(TEXT, "utf8").toString("base64")),
    "",
    `--${ALT}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(HTML, "utf8").toString("base64")),
    "",
    `--${ALT}--`,
    "",
    `--${RELATED}`,
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${CID}>`,
    'Content-Disposition: inline; filename="logo.png"',
    "",
    wrap(PNG_B64),
    "",
    `--${RELATED}--`,
    "",
    `--${MIXED}`,
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${ENCODED_NAME}"`,
    "",
    wrap(minimalPdf()),
    "",
    `--${MIXED}`,
    'Content-Type: text/plain; charset=utf-8; name="notes.txt"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="notes.txt"',
    "",
    wrap(Buffer.from("A second, boring attachment.\n", "utf8").toString("base64")),
    "",
    `--${MIXED}--`,
    "",
  ].join("\r\n");
}

/** SMTP requires a line consisting of a single dot to be doubled. */
function dotStuff(body: string): string {
  return body.replace(/\r\n\./g, "\r\n..");
}

async function smtpSend(message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: HOST, port: PORT });
    socket.setTimeout(15_000);

    const steps = [
      "EHLO yosher-fixture.test",
      `MAIL FROM:<${FROM}>`,
      `RCPT TO:<${TO}>`,
      "DATA",
      dotStuff(message) + "\r\n.",
      "QUIT",
    ];
    let step = -1;
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // A reply is complete when the last line's 4th character is a space
      // ("250 ok") rather than a hyphen ("250-EHLO continues").
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || last[3] === "-") return;

      const code = Number(last.slice(0, 3));
      if (code >= 400) {
        socket.destroy();
        reject(new Error(`SMTP refused at step ${step}: ${last}`));
        return;
      }
      buffer = "";
      step += 1;
      if (step >= steps.length) {
        socket.end();
        resolve();
        return;
      }
      const label = step === 4 ? "<message body>" : steps[step];
      console.log(`  → ${label.length > 60 ? label.slice(0, 60) + "…" : label}`);
      socket.write(steps[step] + "\r\n");
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP timed out."));
    });
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

async function main(): Promise<void> {
  console.log(`\nDelivering fixture message to ${TO} via ${HOST}:${PORT}\n`);
  await smtpSend(buildMessage());
  console.log(
    "\n✓ Delivered.\n\n" +
      "Now run `npm run jmap:probe` and read the FINDINGS block. The questions it\n" +
      "can finally answer:\n" +
      "  • does `cid` come back with or without angle brackets?\n" +
      "  • is the attachment name RFC 2047 decoded, or still =?utf-8?B?…?=\n" +
      "  • is htmlBody already decoded UTF-8, or does it need an iconv step?\n" +
      "  • does bodyValues report isTruncated at a small maxBodyValueBytes?\n" +
      "  • does the blob download return Content-Length?\n",
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
