import "dotenv/config";

/**
 * What does the SYNC path actually see when mail arrives?
 *
 *   npm run mail:probe-autofile
 *
 * WHY THIS DECIDES THE SLICE. Filing attachments into Documents automatically
 * has to be triggered by something, and there is exactly one candidate: our own
 * sync. **A Sieve rule cannot do it** — Sieve runs inside the mail server and
 * has no way to call Yosher, and the one Sieve action that could reach us
 * (`redirect` to an inbound address) would send the message back out over SMTP,
 * duplicate it, and break SPF on the way. So the trigger is `Email/changes`,
 * and every assumption this design makes about that call is worth checking
 * before any of it is written.
 *
 * FOUR QUESTIONS, and the last one is the expensive one to get wrong:
 *
 *   1. **Does `created` include messages the USER creates?** A draft saved by
 *      the composer, a message moved to Sent. If it does, an auto-filer keyed on
 *      `created` would file somebody's own outgoing attachments back into
 *      Documents — silently, forever, in a loop with itself.
 *   2. **Does MOVING a message show up as `created` or `updated`?** A rule that
 *      says "everything filed into Invoices" only works if a move is visible,
 *      and it changes which list has to be walked.
 *   3. **Can `Email/query` filter `hasAttachment` against a decoy?** The
 *      alternative trigger, and the search probe's lesson applies: a condition
 *      that is accepted and ignored looks exactly like one that works, so it
 *      must exclude a message built NOT to match.
 *   4. **THE ONE THAT MATTERS MOST: is `hasAttachment` true for a message whose
 *      only part is an INLINE `cid:` logo?** Almost every business email carries
 *      one — it is what a signature is made of. `filableAttachments()` already
 *      excludes inline parts, so if the server reports `hasAttachment: true` for
 *      them, an auto-filer would download every marketing email in the mailbox
 *      to discover there was nothing to file. That is not a wrong result, it is
 *      a bill: bytes and function time, per message, forever.
 *
 * IT WRITES — a folder and several messages — so it is LOOPBACK-ONLY and
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

const byId = (rs: Json[], id: string): Json =>
  (rs.find((r) => r[2] === id)?.[1] as Json) ?? {};

/** A 1x1 PNG, so the inline part is a real image rather than a claim. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main(): Promise<void> {
  const session = await http(rawUrl);
  const accountId =
    (session.primaryAccounts?.[MAIL] as string) ??
    Object.keys(session.accounts ?? {})[0];
  const apiUrl = rebase(session.apiUrl as string, rawUrl);
  const uploadUrl = rebase(String(session.uploadUrl), rawUrl).replace(
    "{accountId}",
    encodeURIComponent(accountId),
  );
  console.log(`\nserver   ${session.username}`);

  const call = async (methodCalls: unknown[][]): Promise<Json[]> =>
    (await http(apiUrl, { using: [CORE, MAIL], methodCalls })).methodResponses as Json[];

  const boxes = byId(await call([["Mailbox/get", { accountId, ids: null }, "m"]]), "m");
  const folders = (boxes.list ?? []) as Json[];
  const inbox = folders.find((f) => f.role === "inbox");
  const drafts = folders.find((f) => f.role === "drafts");
  if (!inbox || !drafts) fail("need an inbox and a drafts folder");

  const stamp = String(Date.now()).slice(-8);
  const made: string[] = [];
  let boxId = "";

  // The state BEFORE anything is created — the cursor a sync would hold.
  const before = byId(
    await call([["Email/get", { accountId, ids: [], properties: ["id"] }, "s"]]),
    "s",
  ).state as string;
  console.log(`--- cursor before: ${before}`);

  try {
    // Upload the logo once; two messages reference it.
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "image/png" },
      body: PNG,
    });
    if (!uploaded.ok) fail(`upload failed: ${uploaded.status}`);
    const logoBlob = (await uploaded.json()).blobId as string;

    const mkbox = byId(
      await call([
        ["Mailbox/set", { accountId, create: { b: { name: `probe-autofile-${stamp}`, parentId: null } } }, "n"],
      ]),
      "n",
    );
    boxId = mkbox.created?.b?.id ?? "";

    // ── Three messages, each answering a different question ──────────────────
    const created = byId(
      await call([
        [
          "Email/set",
          {
            accountId,
            create: {
              // (a) An ordinary arrival with a REAL attachment: the thing an
              //     auto-filer is supposed to act on.
              real: {
                mailboxIds: { [inbox.id]: true },
                keywords: { $seen: true },
                from: [{ name: null, email: `supplier-${stamp}@example.com` }],
                to: [{ name: null, email: session.username }],
                subject: `Invoice with a real attachment ${stamp}`,
                bodyValues: { t: { value: "Please find the invoice attached." } },
                textBody: [{ partId: "t", type: "text/plain" }],
                attachments: [
                  {
                    blobId: logoBlob,
                    type: "image/png",
                    name: "invoice.png",
                    disposition: "attachment",
                  },
                ],
              },
              // (b) THE DECOY. Its only non-text part is an INLINE cid logo —
              //     what every signature in the world is made of.
              logo: {
                mailboxIds: { [inbox.id]: true },
                keywords: { $seen: true },
                from: [{ name: null, email: `newsletter-${stamp}@example.com` }],
                to: [{ name: null, email: session.username }],
                subject: `Newsletter with only a signature logo ${stamp}`,
                bodyValues: { h: { value: '<p>Hello</p><img src="cid:logo1">' } },
                htmlBody: [{ partId: "h", type: "text/html" }],
                attachments: [
                  {
                    blobId: logoBlob,
                    type: "image/png",
                    name: "logo.png",
                    disposition: "inline",
                    cid: "logo1",
                  },
                ],
              },
              // (c) A DRAFT the user wrote, with an attachment. An auto-filer
              //     that acts on this files somebody's own outgoing work.
              draft: {
                mailboxIds: { [drafts.id]: true },
                keywords: { $draft: true, $seen: true },
                from: [{ name: null, email: session.username }],
                to: [{ name: null, email: `customer-${stamp}@example.com` }],
                subject: `My own draft ${stamp}`,
                bodyValues: { t: { value: "Quote attached." } },
                textBody: [{ partId: "t", type: "text/plain" }],
                attachments: [
                  {
                    blobId: logoBlob,
                    type: "image/png",
                    name: "quote.png",
                    disposition: "attachment",
                  },
                ],
              },
            },
          },
          "c",
        ],
      ]),
      "c",
    );
    if (created.notCreated) {
      fail(`could not create messages: ${JSON.stringify(created.notCreated)}`);
    }
    const realId = created.created.real.id as string;
    const logoId = created.created.logo.id as string;
    const draftId = created.created.draft.id as string;
    made.push(realId, logoId, draftId);

    // ── 1 & 2. What does Email/changes report? ──────────────────────────────
    const changes = byId(
      await call([["Email/changes", { accountId, sinceState: before, maxChanges: 200 }, "ch"]]),
      "ch",
    );
    const createdIds = (changes.created ?? []) as string[];
    const updatedIds = (changes.updated ?? []) as string[];
    console.log(
      `--- Email/changes: created=${createdIds.length} updated=${updatedIds.length}`,
    );

    if (createdIds.includes(draftId)) {
      confirmed.push(
        "`Email/changes.created` INCLUDES the user's own draft. An auto-filer " +
          "keyed on it must exclude `$draft` and the Drafts/Sent mailboxes, or " +
          "it would file somebody's own outgoing attachments back into Documents.",
      );
    } else {
      findings.push(
        "The user's own draft did NOT appear in `created` — so this server " +
          "distinguishes them, and the exclusion below is belt-and-braces rather " +
          "than load-bearing. Do not rely on that: it is a fact about one server.",
      );
    }

    // A MOVE: created or updated?
    const stateAfterCreate = changes.newState as string;
    if (boxId) {
      await call([
        [
          "Email/set",
          { accountId, update: { [realId]: { [`mailboxIds/${inbox.id}`]: null, [`mailboxIds/${boxId}`]: true } } },
          "mv",
        ],
      ]);
      const after = byId(
        await call([
          ["Email/changes", { accountId, sinceState: stateAfterCreate, maxChanges: 200 }, "ch2"],
        ]),
        "ch2",
      );
      const movedInCreated = ((after.created ?? []) as string[]).includes(realId);
      const movedInUpdated = ((after.updated ?? []) as string[]).includes(realId);
      console.log(`--- after a move: created=${movedInCreated} updated=${movedInUpdated}`);
      if (movedInUpdated && !movedInCreated) {
        confirmed.push(
          "Moving a message reports it as UPDATED, never re-created — so a rule " +
            "keyed on a folder has to walk `updated` as well as `created`, and " +
            "an auto-filer must be idempotent per message rather than trusting " +
            "'created means new to me'.",
        );
      } else if (movedInCreated) {
        findings.push(
          "A MOVED message appears in `created`. Anything treating `created` as " +
            "'newly arrived' would re-file a message every time somebody filed " +
            "it into a folder.",
        );
      }
      // Put it back so the query test below is about the inbox.
      await call([
        [
          "Email/set",
          { accountId, update: { [realId]: { [`mailboxIds/${boxId}`]: null, [`mailboxIds/${inbox.id}`]: true } } },
          "mv2",
        ],
      ]);
    }

    // The full-text index is asynchronous (found by mail:probe-search); the
    // filters below are structural rather than textual, but the same settle
    // costs three seconds and removes the doubt.
    await new Promise((r) => setTimeout(r, 3000));

    // ── 3. hasAttachment as a query filter, against a decoy ──────────────────
    const q = byId(
      await call([
        [
          "Email/query",
          { accountId, filter: { inMailbox: inbox.id, hasAttachment: true }, limit: 50 },
          "q",
        ],
      ]),
      "q",
    );
    const hits = (q.ids ?? []) as string[];
    console.log(`--- hasAttachment query returned ${hits.length}`);
    if (hits.includes(realId)) {
      confirmed.push(
        "`Email/query` filters on `hasAttachment` and matches a message that " +
          "genuinely has one — a usable trigger that costs one request per sync.",
      );
    } else {
      findings.push(
        "`hasAttachment: true` did NOT match a message with a real attachment. " +
          "The filter cannot be used to find work.",
      );
    }

    // ── 5. IS `after` INCLUSIVE? ────────────────────────────────────────────
    //
    // The watermark is stored as the receivedAt of the last message dealt with,
    // so whether `after` includes that instant decides a recurring cost: if it
    // does, the boundary message comes back on EVERY sweep and gets downloaded
    // again to discover it was already filed. RFC 8621 says "the same as or
    // after", which would make it inclusive — worth confirming rather than
    // trusting, because the alternative reading silently loses any message that
    // shares a timestamp with the boundary, and that is the unrecoverable
    // direction.
    const stamps = byId(
      await call([
        ["Email/get", { accountId, ids: [realId], properties: ["receivedAt"] }, "r"],
      ]),
      "r",
    );
    const realReceivedAt = ((stamps.list ?? []) as Json[])[0]?.receivedAt as string;
    const boundary = byId(
      await call([
        [
          "Email/query",
          {
            accountId,
            filter: { inMailbox: inbox.id, hasAttachment: true, after: realReceivedAt },
            limit: 50,
          },
          "qa",
        ],
      ]),
      "qa",
    );
    const inclusive = ((boundary.ids ?? []) as string[]).includes(realId);
    console.log(`--- after=<its own receivedAt> includes the message: ${inclusive}`);
    if (inclusive) {
      confirmed.push(
        "`after` is INCLUSIVE — a message whose receivedAt equals the watermark " +
          "comes back on the next sweep. That is the SAFE direction (nothing " +
          "sharing a timestamp with the boundary is ever skipped) and it costs " +
          "one repeated message per rule per tick, refused cheaply by the " +
          "already-filed check.",
      );
    } else {
      // The dangerous answer, so the compensation is verified here too rather
      // than assumed: does backing the query off by one second bring it back?
      const backed = new Date(new Date(realReceivedAt).getTime() - 1000).toISOString();
      const again = byId(
        await call([
          [
            "Email/query",
            {
              accountId,
              filter: { inMailbox: inbox.id, hasAttachment: true, after: backed },
              limit: 50,
            },
            "qb",
          ],
        ]),
        "qb",
      );
      const recovered = ((again.ids ?? []) as string[]).includes(realId);
      console.log(`--- after=<receivedAt - 1s> includes the message: ${recovered}`);
      if (recovered) {
        confirmed.push(
          "`after` is EXCLUSIVE on this server, contrary to RFC 8621's 'the same " +
            "as or after' — so a watermark stored AT the last message would step " +
            "over anything sharing its timestamp, which is the unrecoverable " +
            "direction. Backing the query off by one second recovers it, and the " +
            "overlap costs at most one second's messages per tick, refused by the " +
            "already-filed check.",
        );
      } else {
        findings.push(
          "`after` is EXCLUSIVE and backing off by a second does NOT recover the " +
            "boundary message. The watermark cannot be a timestamp on this server.",
        );
      }
    }

    // ── 4. THE EXPENSIVE ONE: does an inline logo count? ─────────────────────
    const detail = byId(
      await call([
        [
          "Email/get",
          {
            accountId,
            ids: [realId, logoId],
            properties: ["id", "subject", "hasAttachment", "attachments"],
          },
          "g",
        ],
      ]),
      "g",
    );
    const rows = (detail.list ?? []) as Json[];
    const logoRow = rows.find((r) => r.id === logoId);
    const realRow = rows.find((r) => r.id === realId);
    console.log(
      `--- real:  hasAttachment=${realRow?.hasAttachment} parts=${(realRow?.attachments ?? []).length}`,
    );
    console.log(
      `--- logo:  hasAttachment=${logoRow?.hasAttachment} parts=${JSON.stringify(
        (logoRow?.attachments ?? []).map((a: Json) => ({
          name: a.name,
          disposition: a.disposition,
          cid: a.cid,
        })),
      )}`,
    );

    const logoCountedByServer = logoRow?.hasAttachment === true;
    const logoInQuery = hits.includes(logoId);
    if (logoCountedByServer || logoInQuery) {
      findings.push(
        "**A MESSAGE WHOSE ONLY PART IS AN INLINE `cid:` LOGO REPORTS " +
          `hasAttachment=${logoRow?.hasAttachment} AND ` +
          `${logoInQuery ? "IS" : "is not"} returned by the hasAttachment query.** ` +
          "Almost every business email carries a signature logo, so this is the " +
          "common case rather than an edge one. `filableAttachments()` correctly " +
          "excludes inline parts, so an auto-filer keyed on the server's flag " +
          "would fetch the whole message and file NOTHING — a per-message bill in " +
          "bytes and function time, forever. The parts list has to be inspected " +
          "before anything is downloaded.",
      );
    } else {
      confirmed.push(
        "An inline `cid:` logo does NOT set `hasAttachment`, so the server's own " +
          "flag already means 'a real file' and the trigger needs no second pass.",
      );
    }
  } finally {
    if (made.length > 0) {
      await call([["Email/set", { accountId, destroy: made }, "de"]]);
    }
    if (boxId) {
      await call([
        ["Mailbox/set", { accountId, destroy: [boxId], onDestroyRemoveEmails: true }, "db"],
      ]);
    }
    console.log("\n--- cleaned up");
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
