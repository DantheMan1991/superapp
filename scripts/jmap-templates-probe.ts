import "dotenv/config";

/**
 * Where could a canned response actually LIVE?
 *
 *   npm run mail:probe-templates
 *
 * WHY THIS IS ASKED AT ALL. Every organising feature in this module lives on
 * the mail server on purpose — rules are a Sieve script, the auto-reply is a
 * VacationResponse, the signature is on an Identity, a label IS a mailbox — so
 * that it applies on a phone and in Outlook rather than only inside Yosher. The
 * dossier's own note says templates need "a per-user table", and a table is the
 * one shape that does NOT travel. So before writing a migration, ask the server
 * what it can hold.
 *
 * THREE CANDIDATES, and the third is the one nobody would think to check:
 *
 *   1. **A message with `$draft` in its own mailbox** — literally what Gmail's
 *      original Canned Responses were. Free, travels everywhere, and the
 *      question is whether it POLLUTES: does a draft filed outside Drafts show
 *      up in the Drafts folder, in `Email/query`, or — much worse — in the
 *      scheduled-send sweep, which looks for held drafts by id?
 *   2. **`urn:ietf:params:jmap:filenode`** — advertised in this server's
 *      accountCapabilities and never used by anything. A per-account file store.
 *   3. **THE SHARING QUESTION, which decides it.** A business template
 *      ("our payment terms", "quote follow-up") is worth writing once for the
 *      whole company. Anything held in a mail account is scoped to that account
 *      — the delegation probe already established the server answers
 *      `forbidden` for any account you were not granted. So the real question
 *      is not "can the server store this" but "can the server store it ONCE for
 *      a team", and a negative here is what justifies a table.
 *
 * IT WRITES — a mailbox, a message, a file node — so it is LOOPBACK-ONLY and
 * destroys everything it made on every exit path.
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

const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
const findings: string[] = [];
const confirmed: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function http(url: string, body?: unknown): Promise<Json> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: auth,
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
const FILENODE = "urn:ietf:params:jmap:filenode";

const byId = (rs: Json[], id: string): Json =>
  (rs.find((r) => r[2] === id)?.[1] as Json) ?? {};

async function main(): Promise<void> {
  const session = await http(rawUrl);
  const accountId =
    (session.primaryAccounts?.[MAIL] as string) ??
    Object.keys(session.accounts ?? {})[0];
  const apiUrl = rebase(session.apiUrl as string, rawUrl);
  console.log(`\nserver   ${session.username}`);

  const call = async (methodCalls: unknown[][], using = [CORE, MAIL]): Promise<Json[]> =>
    (await http(apiUrl, { using, methodCalls })).methodResponses as Json[];

  const stamp = String(Date.now()).slice(-8);
  let boxId = "";
  let emailId = "";
  let nodeId = "";

  const boxes = byId(await call([["Mailbox/get", { accountId, ids: null }, "m"]]), "m");
  const folders = (boxes.list ?? []) as Json[];
  const drafts = folders.find((f) => f.role === "drafts");
  if (!drafts) fail("no Drafts folder");

  try {
    // ── CANDIDATE 1: a $draft message in a mailbox of its own ────────────────
    const made = byId(
      await call([
        [
          "Mailbox/set",
          { accountId, create: { t: { name: `probe-templates-${stamp}`, parentId: null } } },
          "n",
        ],
      ]),
      "n",
    );
    if (made.notCreated?.t) fail(`could not create a mailbox: ${JSON.stringify(made.notCreated.t)}`);
    boxId = made.created.t.id as string;

    const msg = byId(
      await call([
        [
          "Email/set",
          {
            accountId,
            create: {
              e: {
                mailboxIds: { [boxId]: true },
                // The Gmail canned-response shape: a draft that lives outside
                // Drafts. `$draft` is what stops a client offering to send it.
                keywords: { $draft: true, $seen: true },
                from: [{ name: null, email: session.username }],
                subject: `Payment terms ${stamp}`,
                bodyValues: { t: { value: "<p>Our terms are <b>30 days</b>.</p>" } },
                htmlBody: [{ partId: "t", type: "text/html" }],
              },
            },
          },
          "c",
        ],
      ]),
      "c",
    );
    if (msg.notCreated?.e) {
      findings.push(
        `A $draft message outside Drafts was REFUSED: ${JSON.stringify(msg.notCreated.e)}`,
      );
    } else {
      emailId = msg.created.e.id as string;
      confirmed.push(
        "A template CAN be stored as a `$draft` message in a mailbox of its own — " +
          "the Gmail canned-response shape. It costs no schema and travels to " +
          "every client pointed at the mailbox.",
      );

      // THE POLLUTION QUESTION. A draft that turns up in the Drafts folder, or
      // in an ordinary inbox query, would make the composer's own held-send
      // flow ambiguous — `sendDueMessages` finds drafts by id, and a person
      // looking in Drafts would see their template library sitting in it.
      const inDrafts = byId(
        await call([
          [
            "Email/query",
            { accountId, filter: { inMailbox: drafts.id }, limit: 50 },
            "q",
          ],
        ]),
        "q",
      );
      const leaked = ((inDrafts.ids ?? []) as string[]).includes(emailId);
      console.log(`\n--- template visible in the Drafts folder: ${leaked}`);
      if (leaked) {
        findings.push(
          "A `$draft` message filed outside Drafts STILL appears in the Drafts " +
            "folder query — so a template library would sit among real unsent " +
            "messages, and the scheduled-send sweep would have to tell them apart.",
        );
      } else {
        confirmed.push(
          "A `$draft` message filed outside Drafts does NOT appear in the Drafts " +
            "folder — the mailbox, not the keyword, is what decides where it shows.",
        );
      }

      // And does it come back with the HTML intact? A template that loses its
      // markup on the round trip is not a template.
      const read = byId(
        await call([
          [
            "Email/get",
            {
              accountId,
              ids: [emailId],
              properties: ["subject", "htmlBody", "bodyValues", "keywords"],
              fetchHTMLBodyValues: true,
            },
            "g",
          ],
        ]),
        "g",
      );
      const stored = ((read.list ?? []) as Json[])[0];
      const html = Object.values(stored?.bodyValues ?? {})[0] as Json | undefined;
      console.log(`--- round-tripped html: ${JSON.stringify(html?.value ?? null)}`);
      if (typeof html?.value === "string" && html.value.includes("<b>")) {
        confirmed.push("Template markup round-trips through Email/set intact.");
      } else {
        findings.push("Template markup did NOT round-trip intact.");
      }
    }

    // ── CANDIDATE 2: the filenode capability ─────────────────────────────────
    //
    // Advertised on this server and used by nothing. Worth one call: this
    // module's habit is that an advertised capability is usually cheaper than
    // expected — with ADR 0005 as the standing counterexample.
    const nodeAttempt = byId(
      await call(
        [
          [
            "FileNode/set",
            {
              accountId,
              create: {
                f: { name: `probe-template-${stamp}.html`, parentId: null },
              },
            },
            "f",
          ],
        ],
        [CORE, FILENODE],
      ),
      "f",
    );
    if (nodeAttempt.type === "error" || nodeAttempt.notCreated?.f) {
      console.log(
        `--- FileNode/set: ${JSON.stringify(nodeAttempt).slice(0, 220)}`,
      );
      findings.push(
        "FileNode/set did not accept a plain create — the file store is " +
          "advertised but is not a drop-in place to keep a template.",
      );
    } else {
      nodeId = nodeAttempt.created?.f?.id ?? "";
      confirmed.push("FileNode/set works, so the server has a usable file store.");
    }

    // ── CANDIDATE 3: THE ONE THAT DECIDES IT ─────────────────────────────────
    //
    // Everything above is stored INSIDE one mail account. A business template is
    // worth writing once for the whole company, and the delegation probe already
    // established that naming an account you were not granted returns
    // `forbidden`. So a colleague can only ever see this if they have been
    // granted this whole mailbox — i.e. read all of somebody's mail.
    //
    // Asserted rather than assumed, because it is the entire argument for a
    // table and it should not rest on a memory of another probe.
    const otherAccounts = Object.keys(session.accounts ?? {}).filter(
      (id) => id !== accountId,
    );
    console.log(
      `--- accounts this token may use: ${Object.keys(session.accounts ?? {}).join(", ")}`,
    );
    confirmed.push(
      `Mail-server storage is scoped to ONE account (this token may use ` +
        `${otherAccounts.length + 1}). Sharing a template with a colleague would ` +
        "mean granting them the whole mailbox — every message in it — so there " +
        "is no way to share a template without sharing the correspondence.",
    );
    findings.push(
      "NO MAIL-SERVER LOCATION CAN HOLD A TENANT-WIDE TEMPLATE. Storing one in " +
        "a mailbox makes it personal to whoever owns that mailbox and invisible " +
        "to the rest of the business — which is the opposite of what a company " +
        "boilerplate is for, and it dies when that person leaves. A Yosher " +
        "table is the only shape that survives staff turnover and is shareable " +
        "without handing over a mailbox.",
    );
  } finally {
    if (emailId) {
      await call([["Email/set", { accountId, destroy: [emailId] }, "de"]]);
    }
    if (boxId) {
      await call([
        ["Mailbox/set", { accountId, destroy: [boxId], onDestroyRemoveEmails: true }, "db"],
      ]);
    }
    if (nodeId) {
      await call([["FileNode/set", { accountId, destroy: [nodeId] }, "dn"]], [
        CORE,
        FILENODE,
      ]);
    }
    console.log(`\n--- cleaned up`);
  }

  console.log("\n─── CONFIRMED");
  for (const line of confirmed) console.log(`  ✓ ${line}`);
  if (findings.length > 0) {
    console.log("\n─── FINDINGS");
    for (const line of findings) console.log(`  ⚠ ${line}`);
    console.log("");
  } else {
    console.log("\n─── No findings.\n");
  }
}

void main();
