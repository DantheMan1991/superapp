import "dotenv/config";

/**
 * What can this mail server actually use as a label?
 *
 *   npm run mail:probe-labels
 *
 * WHY THIS DECIDES THE MODEL. A label differs from a folder in exactly one way:
 * a message can carry several at once and keeping one does not mean leaving
 * another. JMAP offers two mechanisms that could express that, and they lead to
 * completely different code:
 *
 *   • **Multi-mailbox membership.** `Email.mailboxIds` is a MAP, not a value, so
 *     the protocol already allows a message to be in several mailboxes. If a
 *     server honours that, a label IS a mailbox and the only difference between
 *     "move" and "label" is whether the old id is removed — no new storage, no
 *     new concept, and folders and labels share every existing query.
 *   • **Custom keywords.** `Email.keywords` is an open set; `$seen` and
 *     `$flagged` are standard but a client may add its own. Labels as keywords
 *     would be cheap to set but need `hasKeyword` filtering to be usable, and
 *     they are invisible as folders to every other mail client.
 *
 * Servers backed by a maildir often enforce ONE mailbox per message, which would
 * rule the first out entirely. Guessing wrong means either a label feature that
 * silently moves mail instead of tagging it, or a schema for something the
 * protocol already models.
 *
 * IT WRITES — a throwaway mailbox and a throwaway message — so it is
 * LOOPBACK-ONLY and cleans up after itself on every exit path.
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
if (!LOOPBACK.has(new URL(rawUrl).hostname)) {
  fail("This probe creates and destroys mail. It is limited to a loopback server.");
}

const auth = Buffer.from(`${user}:${pass}`).toString("base64");
const findings: string[] = [];
const confirmed: string[] = [];

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

function rebase(advertised: string, reached: string): string {
  const from = new URL(reached);
  const marker = advertised.indexOf("://");
  return `${from.protocol}//${from.host}${advertised.slice(advertised.indexOf("/", marker + 3))}`;
}

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";

async function main(): Promise<void> {
  const session = await http(rawUrl);
  const accountId =
    (session.primaryAccounts?.[MAIL] as string) ??
    Object.keys(session.accounts ?? {})[0];
  const apiUrl = rebase(session.apiUrl as string, rawUrl);
  console.log(`\nserver   ${session.username}`);

  const call = async (methodCalls: unknown[][]): Promise<Json[]> => {
    const out = await http(apiUrl, { using: [CORE, MAIL], methodCalls });
    return out.methodResponses;
  };
  const byId = (rs: Json[], id: string): Json =>
    (rs.find((r) => r[2] === id)?.[1] as Json) ?? {};

  const boxes = byId(await call([["Mailbox/get", { accountId, ids: null }, "m"]]), "m");
  const folders = (boxes.list ?? []) as Json[];
  const inbox = folders.find((f) => f.role === "inbox");
  if (!inbox) fail("no inbox");

  // ── A throwaway label mailbox and a throwaway message ─────────────────────
  const stamp = String(Date.now()).slice(-8);
  const made = byId(
    await call([
      [
        "Mailbox/set",
        { accountId, create: { l: { name: `probe-label-${stamp}`, parentId: null } } },
        "n",
      ],
    ]),
    "n",
  );
  if (made.notCreated?.l) fail(`could not create a mailbox: ${JSON.stringify(made.notCreated.l)}`);
  const labelId = made.created.l.id as string;
  console.log(`\n--- created mailbox ${labelId}`);
  if (typeof made.created.l.sortOrder === "number") {
    confirmed.push("Mailbox/set create works, so a label can be an ordinary mailbox.");
  }

  const msg = byId(
    await call([
      [
        "Email/set",
        {
          accountId,
          create: {
            e: {
              mailboxIds: { [inbox.id]: true },
              keywords: { $seen: true },
              from: [{ name: null, email: session.username }],
              to: [{ name: null, email: session.username }],
              subject: `Label probe ${stamp}`,
              bodyValues: { t: { value: "probe" } },
              textBody: [{ partId: "t", type: "text/plain" }],
            },
          },
        },
        "c",
      ],
    ]),
    "c",
  );
  if (msg.notCreated?.e) fail(`could not create a message: ${JSON.stringify(msg.notCreated.e)}`);
  const emailId = msg.created.e.id as string;

  try {
    // ── MECHANISM 1: two mailboxes at once ──────────────────────────────────
    const added = byId(
      await call([
        [
          "Email/set",
          { accountId, update: { [emailId]: { [`mailboxIds/${labelId}`]: true } } },
          "u",
        ],
      ]),
      "u",
    );
    if (added.notUpdated?.[emailId]) {
      findings.push(
        "The server REFUSED to put a message in a second mailbox: " +
          `${JSON.stringify(added.notUpdated[emailId])}. Labels cannot be ` +
          "mailboxes here; they would have to be keywords.",
      );
    } else {
      const read = byId(
        await call([
          ["Email/get", { accountId, ids: [emailId], properties: ["mailboxIds", "keywords"] }, "g"],
        ]),
        "g",
      );
      const stored = (read.list ?? [])[0] as Json;
      const ids = Object.keys(stored?.mailboxIds ?? {});
      console.log(`\n--- mailboxIds after labelling: ${JSON.stringify(ids)}`);
      if (ids.includes(inbox.id) && ids.includes(labelId)) {
        confirmed.push(
          "A message can be in TWO mailboxes at once, and the inbox membership " +
            "survived — so a label IS a mailbox and the only difference from a " +
            "move is whether the old id is removed.",
        );
      } else {
        findings.push(
          `After adding a second mailbox the message is in ${JSON.stringify(ids)}. ` +
            "The server MOVED it rather than adding — labelling would silently " +
            "take mail out of the inbox.",
        );
      }

      // Does a folder query find it from BOTH sides?
      for (const [where, id] of [["the label", labelId], ["the inbox", inbox.id]] as const) {
        const found = byId(
          await call([
            ["Email/query", { accountId, filter: { inMailbox: id }, limit: 50 }, "q"],
          ]),
          "q",
        );
        if (((found.ids ?? []) as string[]).includes(emailId)) {
          confirmed.push(`Email/query finds the message under ${where}.`);
        } else {
          findings.push(`Email/query does NOT find the message under ${where}.`);
        }
      }

      // Removing the label must leave the message in the inbox.
      await call([
        [
          "Email/set",
          { accountId, update: { [emailId]: { [`mailboxIds/${labelId}`]: null } } },
          "r",
        ],
      ]);
      const afterRemove = byId(
        await call([["Email/get", { accountId, ids: [emailId], properties: ["mailboxIds"] }, "g2"]]),
        "g2",
      );
      const left = Object.keys(((afterRemove.list ?? [])[0] as Json)?.mailboxIds ?? {});
      if (left.includes(inbox.id) && !left.includes(labelId)) {
        confirmed.push("Removing a label leaves the message where it was.");
      } else {
        findings.push(`After removing the label the message is in ${JSON.stringify(left)}.`);
      }
    }

    // ── MECHANISM 2: custom keywords, the alternative ───────────────────────
    const keyworded = byId(
      await call([
        [
          "Email/set",
          { accountId, update: { [emailId]: { "keywords/probe_label": true } } },
          "k",
        ],
      ]),
      "k",
    );
    if (keyworded.notUpdated?.[emailId]) {
      findings.push(
        "Custom keywords are REFUSED: " +
          `${JSON.stringify(keyworded.notUpdated[emailId])}. Worth knowing, ` +
          "since keywords are the fallback if multi-mailbox membership fails.",
      );
    } else {
      const read = byId(
        await call([["Email/get", { accountId, ids: [emailId], properties: ["keywords"] }, "gk"]]),
        "gk",
      );
      const kw = Object.keys(((read.list ?? [])[0] as Json)?.keywords ?? {});
      if (kw.includes("probe_label")) {
        confirmed.push(
          "Custom keywords round-trip, so they remain a viable alternative — " +
            "but they are invisible as folders to every other mail client.",
        );
      } else {
        findings.push(`A custom keyword did not survive; keywords came back ${JSON.stringify(kw)}.`);
      }

      const byKeyword = byId(
        await call([
          ["Email/query", { accountId, filter: { hasKeyword: "probe_label" }, limit: 5 }, "qk"],
        ]),
        "qk",
      );
      if (((byKeyword.ids ?? []) as string[]).includes(emailId)) {
        confirmed.push("Email/query can filter on a custom keyword.");
      } else {
        findings.push("Email/query cannot filter on a custom keyword.");
      }
    }
  } finally {
    await call([["Email/set", { accountId, destroy: [emailId] }, "de"]]);
    await call([["Mailbox/set", { accountId, destroy: [labelId] }, "dm"]]);
    console.log("\ncleanup   probe message and mailbox destroyed");
  }

  console.log("\n─── CONFIRMED");
  for (const line of confirmed) console.log(`    ✓ ${line}`);
  console.log("\n─── FINDINGS");
  if (findings.length === 0) console.log("    (none — every assumption held)");
  for (const line of findings) console.log(`    ! ${line}`);
  console.log("");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
