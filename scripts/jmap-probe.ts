import "dotenv/config";

/**
 * Read-only probe of a JMAP mail server.
 *
 * The sibling of scripts/migadu-probe.ts, and it exists for the same reason
 * that one earned itself twice over: response shapes are only real once a live
 * call proves them. The JMAP client was written against RFC 8620/8621, which is
 * a far better contract than a vendor's docs — but "implements the spec" and
 * "behaves exactly as you assumed" are different claims.
 *
 *   npm run jmap:probe
 *
 * STRICTLY READ-ONLY. Session discovery, Mailbox/get, Email/query, Email/get,
 * Identity/get and a GET against downloadUrl — all gets and queries. Nothing is
 * created, changed, flagged or deleted.
 *
 * Credentials come from the environment and are never printed:
 *
 *   STALWART_JMAP_URL   http://localhost:8080/.well-known/jmap
 *   STALWART_USER       admin@yosher.test
 *   STALWART_PASS       the password the setup wizard generated
 *
 * Basic auth is used here rather than OAuth deliberately — this probe has to
 * work BEFORE the OAuth client exists, since finding out how the server
 * actually behaves is what unblocks building that flow.
 */

const sessionUrl =
  process.env.STALWART_JMAP_URL ?? "http://localhost:8080/.well-known/jmap";
const user = process.env.STALWART_USER;
const pass = process.env.STALWART_PASS;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!user || !pass) {
  fail(
    "STALWART_USER and STALWART_PASS must be set in .env.\n" +
      "  For the local dev server these are the credentials the setup wizard\n" +
      "  generated — admin@<your-domain> and its password.",
  );
}

const auth = Buffer.from(`${user}:${pass}`).toString("base64");

function show(label: string, value: unknown): void {
  console.log(`\n─── ${label}`);
  console.log(
    JSON.stringify(value, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
}

async function http(
  url: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    /* leave as text */
  }
  return { status: response.status, body };
}

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";
const VACATION = "urn:ietf:params:jmap:vacationresponse";

/** Findings worth acting on, collected as we go and printed together at the end. */
const findings: string[] = [];
function note(line: string): void {
  findings.push(line);
}

/** Pull one method response out of a JMAP batch by call id. */
function taken(body: unknown, callId: string): Record<string, unknown> | null {
  const responses = (body as { methodResponses?: unknown })?.methodResponses;
  if (!Array.isArray(responses)) return null;
  for (const entry of responses) {
    if (Array.isArray(entry) && entry.length >= 3 && entry[2] === callId) {
      return { name: entry[0], payload: entry[1] };
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`\nProbing ${sessionUrl} as ${user}`);
  console.log("Read-only — no writes.\n");

  const session = await http(sessionUrl, { method: "GET" });
  console.log(`session: HTTP ${session.status}`);
  if (session.status !== 200) {
    show("session (failed)", session.body);
    fail("Could not read the session. Check the credentials and the URL.");
  }

  const s = session.body as Record<string, unknown>;
  const accounts = (s.accounts ?? {}) as Record<string, unknown>;
  const primary = (s.primaryAccounts ?? {}) as Record<string, string>;
  const accountId = primary[MAIL] ?? Object.keys(accounts)[0];

  show("session (trimmed)", {
    apiUrl: s.apiUrl,
    downloadUrl: s.downloadUrl,
    uploadUrl: s.uploadUrl,
    eventSourceUrl: s.eventSourceUrl,
    username: s.username,
    state: s.state,
    accounts,
    primaryAccounts: primary,
    capabilities: Object.keys((s.capabilities ?? {}) as object),
  });

  if (!accountId) {
    fail(
      "No mail account in the session. Authentication may have failed, or this\n" +
        "  account has no mailbox yet.",
    );
  }
  console.log(`\n✓ mail account: ${accountId}`);

  // The advertised apiUrl is built from the server's configured hostname,
  // which on a local instance does not resolve. Rebase onto the URL we
  // actually reached, so the probe works before DNS or a hosts entry exists.
  const advertised = String(s.apiUrl ?? "");
  const base = new URL(sessionUrl);
  let apiUrl = advertised;
  try {
    const parsed = new URL(advertised);
    if (parsed.host !== base.host) {
      apiUrl = `${base.protocol}//${base.host}${parsed.pathname}`;
      console.log(
        `  (rebased apiUrl ${parsed.host} → ${base.host}; the server advertises\n` +
          `   its configured hostname, which is the thing to watch in production)`,
      );
    }
  } catch {
    apiUrl = `${base.protocol}//${base.host}/jmap/`;
  }

  const mailboxes = await http(apiUrl, {
    method: "POST",
    body: {
      using: [CORE, MAIL],
      methodCalls: [["Mailbox/get", { accountId, ids: null }, "m"]],
    },
  });
  console.log(`\nMailbox/get: HTTP ${mailboxes.status}`);
  show("Mailbox/get", mailboxes.body);

  const emails = await http(apiUrl, {
    method: "POST",
    body: {
      using: [CORE, MAIL],
      methodCalls: [
        [
          "Email/query",
          {
            accountId,
            sort: [{ property: "receivedAt", isAscending: false }],
            limit: 3,
            calculateTotal: true,
          },
          "q",
        ],
        [
          "Email/get",
          {
            accountId,
            "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
            properties: [
              "id",
              "threadId",
              "mailboxIds",
              "keywords",
              "from",
              "subject",
              "receivedAt",
              "preview",
              "hasAttachment",
            ],
          },
          "g",
        ],
      ],
    },
  });
  console.log(`\nEmail/query + Email/get (one round trip): HTTP ${emails.status}`);
  show("Email/query + Email/get", emails.body);

  // ── Capabilities and server limits ────────────────────────────────────────
  //
  // The scopes granted today are mail + offline_access. Sending needs the
  // submission capability, and finding out AFTER somebody has typed a message
  // is the worst possible moment.
  const caps = (s.capabilities ?? {}) as Record<string, Record<string, unknown>>;
  const core = caps[CORE] ?? {};
  show("core limits", {
    maxObjectsInGet: core.maxObjectsInGet,
    maxObjectsInSet: core.maxObjectsInSet,
    maxSizeUpload: core.maxSizeUpload,
    maxSizeRequest: core.maxSizeRequest,
    maxCallsInRequest: core.maxCallsInRequest,
    maxConcurrentUpload: core.maxConcurrentUpload,
  });
  if (typeof core.maxObjectsInGet === "number" && core.maxObjectsInGet !== 500) {
    note(
      `MAX_OBJECTS_IN_GET in client.ts is hardcoded to 500; this server says ${core.maxObjectsInGet}.`,
    );
  }
  for (const [label, urn] of [
    ["submission (compose/send)", SUBMISSION],
    ["vacationresponse (out-of-office)", VACATION],
  ] as const) {
    const present = Object.prototype.hasOwnProperty.call(caps, urn);
    console.log(`  ${present ? "✓" : "✗"} ${label}`);
    if (!present) note(`Capability NOT advertised to this token: ${urn}`);
  }

  // ── The cheap poll: does Email/get with an empty ids array work? ──────────
  //
  // currentState() is the whole basis of "has anything changed?", and it asks
  // for zero objects expecting just the state string back. The RFC implies it;
  // this proves it.
  const emptyGet = await http(apiUrl, {
    method: "POST",
    body: {
      using: [CORE, MAIL],
      methodCalls: [["Email/get", { accountId, ids: [], properties: ["id"] }, "s"]],
    },
  });
  const emptyPayload = taken(emptyGet.body, "s");
  console.log(`\nEmail/get {ids: []} (the cheap poll): HTTP ${emptyGet.status}`);
  show("Email/get {ids: []}", emptyGet.body);
  if (emptyPayload?.name === "error") {
    note(
      "Email/get with ids:[] is REFUSED — currentState() must fall back to " +
        "Mailbox/get on the inbox with properties:['unreadThreads'].",
    );
  }

  // ── A full message: bodies, threading headers, attachments ───────────────
  const queryPayload = taken(emails.body, "q")?.payload as
    | { ids?: string[] }
    | undefined;
  const firstId = queryPayload?.ids?.[0];

  if (!firstId) {
    note(
      "No messages in this mailbox, so body/attachment/cid shapes were NOT " +
        "probed. Send this account a message with an inline image and an " +
        "attachment, then re-run.",
    );
  } else {
    const detail = await http(apiUrl, {
      method: "POST",
      body: {
        using: [CORE, MAIL],
        methodCalls: [
          [
            "Email/get",
            {
              accountId,
              ids: [firstId],
              properties: [
                "id",
                "blobId",
                "threadId",
                "messageId",
                "inReplyTo",
                "references",
                "subject",
                "from",
                "to",
                "textBody",
                "htmlBody",
                "bodyValues",
                "attachments",
                "hasAttachment",
              ],
              fetchTextBodyValues: true,
              fetchHTMLBodyValues: true,
              // Deliberately small, to force isTruncated to show itself.
              maxBodyValueBytes: 2048,
            },
            "d",
          ],
        ],
      },
    });
    console.log(`\nEmail/get (full detail): HTTP ${detail.status}`);
    const message = (
      (taken(detail.body, "d")?.payload as { list?: unknown[] })?.list ?? []
    )[0] as Record<string, unknown> | undefined;

    show("Email/get (full detail)", taken(detail.body, "d")?.payload);

    if (message) {
      // messageId / inReplyTo / references are what a References chain is built
      // from, and parseEmail does not read any of them today.
      show("threading headers", {
        messageId: message.messageId,
        inReplyTo: message.inReplyTo,
        references: message.references,
      });
      if (message.messageId === undefined) {
        note(
          "messageId came back undefined — confirm it is a requestable property " +
            "on this server before building reply threading on it.",
        );
      }

      const bodyValues = (message.bodyValues ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      show(
        "bodyValues (truncation + charset)",
        Object.fromEntries(
          Object.entries(bodyValues).map(([k, v]) => [
            k,
            {
              isTruncated: v.isTruncated,
              isEncodingProblem: v.isEncodingProblem,
              valueLength: typeof v.value === "string" ? v.value.length : null,
              valueHead:
                typeof v.value === "string" ? v.value.slice(0, 120) : null,
            },
          ]),
        ),
      );
      if (Object.values(bodyValues).some((v) => v.isTruncated === true)) {
        note(
          "isTruncated came back TRUE at maxBodyValueBytes:2048 — resolveBody() " +
            "in parse.ts ignores this flag, so a long message is silently cut " +
            "mid-tag today.",
        );
      }

      const attachments = (message.attachments ?? []) as Record<
        string,
        unknown
      >[];
      show(
        "attachments (cid / name encoding)",
        attachments.map((a) => ({
          partId: a.partId,
          blobId: a.blobId,
          name: a.name,
          type: a.type,
          charset: a.charset,
          disposition: a.disposition,
          cid: a.cid,
          size: a.size,
        })),
      );
      for (const a of attachments) {
        if (typeof a.name === "string" && a.name.includes("=?")) {
          note(
            `Attachment name arrives RFC 2047 ENCODED (${a.name}) — it needs ` +
              "decoding before display and before Content-Disposition.",
          );
        }
      }
      if (attachments.length === 0) {
        note(
          "This message had no attachments, so cid/name shapes are unproven. " +
            "Send one with an inline image and re-run.",
        );
      }

      // ── downloadUrl: the most likely production landmine ──────────────────
      //
      // Stalwart builds apiUrl from its CONFIGURED HOSTNAME rather than the
      // request's Host header (found on the first probe). If downloadUrl does
      // the same, every attachment 404s in production and reproduces nowhere
      // locally, because the client fetches it server-side.
      const blobId = String(
        (attachments[0]?.blobId as string | undefined) ?? message.blobId ?? "",
      );
      const downloadTemplate = String(s.downloadUrl ?? "");
      if (downloadTemplate && blobId) {
        const templateHost = (() => {
          try {
            return new URL(downloadTemplate.replace(/\{[^}]+\}/g, "x")).host;
          } catch {
            return "";
          }
        })();
        if (templateHost && templateHost !== base.host) {
          note(
            `downloadUrl advertises host "${templateHost}" but we reached ` +
              `"${base.host}". downloadUrlFor() in client.ts uses the advertised ` +
              "value verbatim — rebase it onto the host from the stored " +
              "jmapSessionUrl, or attachments break wherever that name does not resolve.",
          );
        }

        const filled = downloadTemplate
          .replace("{accountId}", encodeURIComponent(accountId))
          .replace("{blobId}", encodeURIComponent(blobId))
          .replace("{name}", encodeURIComponent("probe.bin"))
          .replace("{type}", encodeURIComponent("application/octet-stream"));
        const rebased = (() => {
          try {
            const u = new URL(filled);
            return `${base.protocol}//${base.host}${u.pathname}${u.search}`;
          } catch {
            return filled;
          }
        })();

        const blob = await fetch(rebased, {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(20_000),
        });
        console.log(`\nGET downloadUrl (rebased): HTTP ${blob.status}`);
        show("download response headers", {
          status: blob.status,
          contentType: blob.headers.get("content-type"),
          contentLength: blob.headers.get("content-length"),
          contentDisposition: blob.headers.get("content-disposition"),
        });
        if (blob.ok && blob.headers.get("content-length") === null) {
          note(
            "The blob download returns NO Content-Length — the attachment " +
              "proxy cannot reject an oversized attachment before streaming it, " +
              "so the counting-stream cap is the only backstop.",
          );
        }
        // Read and discard, so the socket closes cleanly.
        await blob.arrayBuffer().catch(() => undefined);
      }
    }
  }

  // ── Identities: who this account may send as ──────────────────────────────
  //
  // Sent as its own request: an unsupported capability in `using` fails the
  // WHOLE batch, so asking here must not be able to break anything above.
  const identities = await http(apiUrl, {
    method: "POST",
    body: {
      using: [CORE, SUBMISSION],
      methodCalls: [["Identity/get", { accountId, ids: null }, "i"]],
    },
  });
  console.log(`\nIdentity/get: HTTP ${identities.status}`);
  show("Identity/get", identities.body);
  if (identities.status !== 200 || taken(identities.body, "i")?.name === "error") {
    note(
      "Identity/get FAILED — compose/send cannot resolve a From address yet. " +
        "Check whether the granted scope covers the submission capability.",
    );
  }

  console.log(
    "\nWhat to check against src/lib/email/jmap/parse.ts:\n" +
      "  • session      — does accounts/primaryAccounts match parseSession()?\n" +
      "  • Mailbox/get  — is myRights shaped as parseMailbox() expects?\n" +
      "  • Email/get    — do keywords, from and receivedAt match parseEmail()?\n" +
      "  • the batch    — did the #ids back-reference work in one request?\n" +
      "  • bodyValues   — isTruncated, and is the text already decoded UTF-8?\n" +
      "  • attachments  — cid with or without <>, and is name RFC 2047 decoded?\n" +
      "  • downloadUrl  — does its host match the one you actually reached?\n",
  );

  if (findings.length > 0) {
    console.log("─── FINDINGS (things the code assumes that this server disagrees with)");
    for (const line of findings) console.log(`  ⚠ ${line}`);
    console.log("");
  } else {
    console.log("─── No disagreements found between the code's assumptions and this server.\n");
  }
}

void main();
