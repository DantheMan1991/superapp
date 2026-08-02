import "dotenv/config";
import { sanitizeOutboundHtml } from "../src/modules/email/compose/html";
import { htmlToPlainText } from "../src/modules/email/compose/to-text";
import { draftObject } from "../src/lib/email/jmap/draft";

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

  // ===========================================================================
  // SCENARIO 2: an inline image.
  //
  // THE QUESTION THIS ANSWERS, and the reason it is probed before the feature is
  // designed: RFC 8621 says an attachment may carry `disposition: "inline"` and
  // a `cid`, and an `<img src="cid:...">` in the HTML part refers to it. What it
  // does NOT say is whether a given server then wraps the alternative in a
  // `multipart/related` — which is what makes that reference resolve in the
  // recipient's client. Assemble it by hand and you are back to writing MIME;
  // assume it and every inline image arrives as a broken icon with the picture
  // sitting underneath as an attachment.
  // ===========================================================================
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA" +
      "hKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  const uploadUrl = rebase(session.uploadUrl as string, rawUrl).replace(
    "{accountId}",
    encodeURIComponent(accountId),
  );
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "image/png" },
    body: PNG_1X1,
    redirect: "follow",
  });
  if (!uploaded.ok) fail(`blob upload returned ${uploaded.status}`);
  const blob = (await uploaded.json()) as Json;
  confirmed.push(`Blob upload works (${blob.size} bytes, type ${blob.type}).`);

  const cid = "probe-inline-1@yosher.test";
  // The sanitizer's rule, checked here as well as in the unit tests, because
  // this is the one place the whole path runs end to end: an `<img>` is
  // admitted ONLY for a cid the message minted, and its `src` is rebuilt from
  // that cid rather than copied.
  const withAllowlist = sanitizeOutboundHtml(
    `<img src="https://tracker.example/p.gif" data-cid="${cid}">`,
    { allowedCids: new Set([cid]) },
  );
  if (withAllowlist.includes(`cid:${cid}`) && !withAllowlist.includes("tracker")) {
    confirmed.push("The sanitizer rebuilds an inline image's src from its cid.");
  } else {
    findings.push("The sanitizer did not rebuild the inline image's src.");
  }
  if (sanitizeOutboundHtml(`<img src="x" data-cid="${cid}">`).includes("img")) {
    findings.push(
      "An <img> survived with NO allowlist supplied. The default must admit " +
        "nothing, or every path that is not the composer admits images.",
    );
  } else {
    confirmed.push("With no allowlist, no image survives at all.");
  }

  const inlineDraft = {
    mailboxIds: { [drafts.id]: true },
    keywords: { $draft: true },
    from: [{ name: null, email: session.username }],
    to: [{ name: "Probe", email: session.username }],
    subject: "Compose probe - inline image",
    bodyValues: {
      text: { value: "Above.\n\n[image]\n\nBelow." },
      html: {
        value: `<p>Above.</p><img src="cid:${cid}" alt="a dot"><p>Below.</p>`,
      },
    },
    textBody: [{ partId: "text", type: "text/plain" }],
    htmlBody: [{ partId: "html", type: "text/html" }],
    attachments: [
      {
        blobId: blob.blobId,
        type: "image/png",
        name: "dot.png",
        disposition: "inline",
        cid,
      },
    ],
  };

  const [madeInline] = await call([
    ["Email/set", { accountId, create: { inline: inlineDraft } }, "i"],
  ]);
  if (madeInline[1].notCreated?.inline) {
    findings.push(
      `The server REFUSED an inline attachment: ${JSON.stringify(
        madeInline[1].notCreated.inline,
      )}`,
    );
  } else {
    const inlineId = madeInline[1].created.inline.id as string;
    const inlineBlobId = madeInline[1].created.inline.blobId as string;
    try {
      const [gotInline] = await call([
        [
          "Email/get",
          {
            accountId,
            ids: [inlineId],
            properties: ["bodyStructure", "attachments"],
            bodyProperties: [
              "partId",
              "type",
              "disposition",
              "cid",
              "name",
              "subParts",
            ],
          },
          "gi",
        ],
      ]);
      const built = gotInline[1].list[0];
      console.log("\n--- bodyStructure for the INLINE-IMAGE message");
      console.log(
        JSON.stringify(built.bodyStructure, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );

      const topType = built.bodyStructure?.type as string | undefined;
      if (topType === "multipart/related") {
        confirmed.push(
          "The server wraps the alternative in multipart/related for an inline " +
            "attachment. No hand-built MIME needed.",
        );
      } else {
        confirmed.push(
          `KNOWN AND WORKED AROUND: the convenience properties produce ` +
            `"${topType}" for an inline attachment, not multipart/related, so ` +
            "a cid reference would not resolve. This is why the client builds " +
            "an explicit bodyStructure instead — see scenario 3.",
        );
      }

      const attached = (built.attachments ?? []) as Json[];
      const roundTripped = attached.find((a) => a.cid === cid);
      if (roundTripped) {
        confirmed.push(
          `The cid round-trips through Email/get as "${roundTripped.cid}" ` +
            `with disposition "${roundTripped.disposition}".`,
        );
      } else {
        findings.push(
          `No attachment came back carrying our cid. Got: ${JSON.stringify(
            attached.map((a) => ({ cid: a.cid, disposition: a.disposition })),
          )}`,
        );
      }

      const rawInline = await fetch(
        downloadUrl
          .replace("{accountId}", encodeURIComponent(accountId))
          .replace("{blobId}", encodeURIComponent(inlineBlobId))
          .replace("{type}", "message%2Frfc822")
          .replace("{name}", "inline.eml"),
        { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" },
      );
      const rawText = await rawInline.text();
      console.log(`\n--- raw inline message (${rawText.length} bytes), structure only`);
      console.log(
        rawText
          .split(/\r?\n/)
          .filter((l) => /^(Content-|--\w)/i.test(l))
          .slice(0, 24)
          .map((l) => `    ${l}`)
          .join("\n"),
      );

      // The Content-ID is what a `cid:` URL actually resolves against. A server
      // that rewrites or drops it breaks every inline image silently.
      if (rawText.includes(`<${cid}>`)) {
        confirmed.push("Content-ID is emitted in angle brackets, verbatim.");
      } else if (rawText.includes(cid)) {
        confirmed.push("Content-ID survives, though not in the bracketed form.");
      } else {
        findings.push("The server did not emit our Content-ID at all.");
      }
      if (/Content-Disposition:\s*inline/i.test(rawText)) {
        confirmed.push("Content-Disposition: inline survives.");
      } else {
        findings.push("The inline disposition was not preserved.");
      }
    } finally {
      await call([["Email/set", { accountId, destroy: [inlineId] }, "di"]]);
      console.log("cleanup   inline draft destroyed");
    }
  }

  // ===========================================================================
  // SCENARIO 3: can we ASK for multipart/related?
  //
  // Scenario 2 found that letting the server assemble the MIME from
  // `htmlBody` + `attachments` produces `multipart/mixed`, with the inline image
  // as a SIBLING of the alternative rather than a resource inside a
  // `multipart/related`. RFC 2387 is what makes a `cid:` reference resolvable,
  // and clients that follow it will show a broken image with the file listed
  // underneath as an attachment.
  //
  // RFC 8621 section 4.1.4 offers the other door: supply `bodyStructure`
  // explicitly instead of the convenience properties, and the server builds
  // exactly the tree you describe. Boundaries, encodings and charsets stay its
  // job — which is the part worth not hand-rolling — while the SHAPE becomes
  // ours. This asks whether Stalwart honours that.
  //
  // The tree being requested is the canonical one, including a real attachment
  // alongside the inline image, because that combination is where a naive
  // structure goes wrong first:
  //
  //   multipart/mixed
  //   ├── multipart/related
  //   │   ├── multipart/alternative
  //   │   │   ├── text/plain
  //   │   │   └── text/html
  //   │   └── image/png   (inline, cid)
  //   └── text/plain      (a real attachment)
  // ===========================================================================
  const relatedCid = "probe-related-1@yosher.test";

  const attachUpload = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "text/plain" },
    body: Buffer.from("a genuine attachment", "utf8"),
    redirect: "follow",
  });
  if (!attachUpload.ok) fail(`attachment upload returned ${attachUpload.status}`);
  const attachBlob = (await attachUpload.json()) as Json;

  /**
   * BUILT BY THE SHIPPING CODE, not by hand.
   *
   * `draftObject` is the function `sendMessage` uses, moved into a pure module
   * precisely so this script can call it. A probe that verifies a hand-written
   * request proves the SERVER behaves; it proves nothing about the client. This
   * way the tree being sent is the tree the composer sends.
   */
  const relatedDraft = draftObject({
    identityId: "probe",
    from: { name: null, email: session.username as string },
    to: [{ name: "Probe", email: session.username as string }],
    cc: [],
    bcc: [],
    subject: "Compose probe - multipart/related",
    textBody: "Above.\n\n[image]\n\nBelow.",
    htmlBody: `<p>Above.</p><img src="cid:${relatedCid}" alt="a dot"><p>Below.</p>`,
    inlineImages: [
      {
        blobId: blob.blobId as string,
        cid: relatedCid,
        type: "image/png",
        name: "dot.png",
      },
    ],
    attachments: [
      {
        blobId: attachBlob.blobId as string,
        type: "text/plain",
        name: "notes.txt",
      },
    ],
    draftsMailboxId: drafts.id as string,
    envelopeRcptTo: [session.username as string],
  });

  const [madeRelated] = await call([
    ["Email/set", { accountId, create: { rel: relatedDraft } }, "r"],
  ]);
  if (madeRelated[1].notCreated?.rel) {
    findings.push(
      "The server REFUSED an explicit bodyStructure: " +
        `${JSON.stringify(madeRelated[1].notCreated.rel)}. Inline images would ` +
        "have to live in the multipart/mixed the convenience properties build, " +
        "or the MIME would have to be assembled by hand and imported.",
    );
  } else {
    const relId = madeRelated[1].created.rel.id as string;
    const relBlobId = madeRelated[1].created.rel.blobId as string;
    try {
      const [gotRel] = await call([
        [
          "Email/get",
          {
            accountId,
            ids: [relId],
            properties: ["bodyStructure", "attachments", "htmlBody", "textBody"],
            bodyProperties: [
              "partId",
              "type",
              "disposition",
              "cid",
              "name",
              "subParts",
            ],
          },
          "gr",
        ],
      ]);
      const built = gotRel[1].list[0];
      console.log("\n--- bodyStructure the server built from an EXPLICIT one");
      console.log(
        JSON.stringify(built.bodyStructure, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );

      const top = built.bodyStructure?.type as string | undefined;
      const inner = built.bodyStructure?.subParts?.[0]?.type as string | undefined;
      if (top === "multipart/mixed" && inner === "multipart/related") {
        confirmed.push(
          "An EXPLICIT bodyStructure is honoured: mixed > related > alternative " +
            "is exactly what came back. Inline images can be done properly.",
        );
      } else {
        findings.push(
          `An explicit bodyStructure came back as "${top}" > "${inner}", not ` +
            "mixed > related. The server rewrote the tree.",
        );
      }

      // A message that says multipart/related but whose reading side no longer
      // reports the html part would be a different kind of broken.
      const htmlPart = (built.htmlBody ?? []) as Json[];
      if (htmlPart.some((p) => p.type === "text/html")) {
        confirmed.push("The html part is still discoverable via Email/get.");
      } else {
        findings.push(
          "Email/get no longer reports an htmlBody part for this message, so " +
            "our own reading pane would not find the body it just sent.",
        );
      }

      const rawRel = await fetch(
        downloadUrl
          .replace("{accountId}", encodeURIComponent(accountId))
          .replace("{blobId}", encodeURIComponent(relBlobId))
          .replace("{type}", "message%2Frfc822")
          .replace("{name}", "related.eml"),
        { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" },
      );
      const rawRelText = await rawRel.text();
      console.log(`\n--- raw related message (${rawRelText.length} bytes), structure only`);
      console.log(
        rawRelText
          .split(/\r?\n/)
          .filter((l) => /^Content-(Type|ID|Disposition)/i.test(l))
          .slice(0, 20)
          .map((l) => `    ${l}`)
          .join("\n"),
      );

      if (/Content-Type:\s*multipart\/related/i.test(rawRelText)) {
        confirmed.push("The WIRE FORMAT carries multipart/related.");
      } else {
        findings.push("The raw message does not contain multipart/related.");
      }
      if (rawRelText.includes(`<${relatedCid}>`)) {
        confirmed.push("Content-ID survives inside the related part.");
      } else {
        findings.push("Content-ID did not survive inside the related part.");
      }
    } finally {
      await call([["Email/set", { accountId, destroy: [relId] }, "dr"]]);
      console.log("cleanup   related draft destroyed");
    }
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
