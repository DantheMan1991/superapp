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
 * STRICTLY READ-ONLY. Session discovery plus Mailbox/get and Email/query, which
 * are gets and queries. Nothing is created, changed, flagged or deleted.
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

  console.log(
    "\nWhat to check against src/lib/email/jmap/parse.ts:\n" +
      "  • session      — does accounts/primaryAccounts match parseSession()?\n" +
      "  • Mailbox/get  — is myRights shaped as parseMailbox() expects?\n" +
      "  • Email/get    — do keywords, from and receivedAt match parseEmail()?\n" +
      "  • the batch    — did the #ids back-reference work in one request?\n",
  );
}

void main();
