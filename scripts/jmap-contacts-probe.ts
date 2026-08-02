import "dotenv/config";

/**
 * What does this mail server mean by "contacts"?
 *
 *   npm run mail:probe-contacts
 *
 * WHY THIS HAS TO RUN BEFORE ANY CODE. The server has advertised
 * `urn:ietf:params:jmap:contacts` since the very first probe, and nothing has
 * ever used it — but unlike `mail` and `submission`, **contacts is not a
 * published RFC**. It is a draft, and it changed models mid-flight:
 *
 *   • the OLD draft has `Contact`, with `firstName`, `lastName` and
 *     `emails: [{ type, value }]`
 *   • the CURRENT one has `ContactCard`, following JSContact (RFC 9553), with
 *     `name: { components: [...] }` and `emails: { key: { address } }`
 *
 * Those are not variations on a theme, they are different objects with
 * different method names. Writing a parser from either one and hoping is
 * exactly the mistake `migadu-parse.ts` made twice and the Sieve compiler made
 * once. So this asks the server and prints what it says.
 *
 * READ-ONLY against any server EXCEPT a loopback one. An empty address book
 * proves nothing about a populated card's shape — the Slice 0 probe made exactly
 * that mistake and the dossier records it — so against the local container this
 * creates one card, reads it back, and destroys it. Same guard and same reason
 * as `mail:fixture` and `mail:probe-compose`.
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

const auth = Buffer.from(`${user}:${pass}`).toString("base64");
const findings: string[] = [];
const confirmed: string[] = [];

/**
 * JSON the probe has just fetched. `any` is deliberate and scoped to this
 * alias: the whole point is that the shape is not yet known.
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

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const CONTACTS = "urn:ietf:params:jmap:contacts";
const CORE = "urn:ietf:params:jmap:core";

async function main(): Promise<void> {
  const session = await http(rawUrl);
  const apiUrl = rebase(session.apiUrl as string, rawUrl);
  console.log(`\nserver   ${session.username}`);

  // ── Is it advertised, and what does the capability object say? ────────────
  const capabilities = (session.capabilities ?? {}) as Json;
  const contactsCapability = capabilities[CONTACTS];
  if (!contactsCapability) {
    findings.push(
      "The server does NOT advertise urn:ietf:params:jmap:contacts. Address " +
        "autocomplete cannot use the mail server at all here — it would have " +
        "to come entirely from recent correspondents and the extension seam.",
    );
    report();
    return;
  }
  confirmed.push("urn:ietf:params:jmap:contacts is advertised.");
  console.log("\n--- the contacts capability object");
  console.log(
    JSON.stringify(contactsCapability, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );

  const accountId =
    (session.primaryAccounts?.[CONTACTS] as string) ??
    (session.primaryAccounts?.["urn:ietf:params:jmap:mail"] as string) ??
    Object.keys(session.accounts ?? {})[0];
  if (!accountId) fail("no account to ask");
  // A separate primary account for contacts would mean the address book lives
  // somewhere other than the mailbox — which changes which token can read it.
  if (session.primaryAccounts?.[CONTACTS] &&
      session.primaryAccounts[CONTACTS] !== session.primaryAccounts["urn:ietf:params:jmap:mail"]) {
    findings.push(
      "Contacts have their OWN primary account, separate from mail. The " +
        "mailbox's token may not cover them.",
    );
  }

  /** Try a method and hand back whatever came out, error or not. */
  async function tryMethod(name: string, args: Json): Promise<Json | null> {
    const out = await http(apiUrl, {
      using: [CORE, CONTACTS],
      methodCalls: [[name, { accountId, ...args }, "c"]],
    });
    const response = (out.methodResponses ?? [])[0];
    if (!response) return null;
    if (response[0] === "error") {
      console.log(`    ${name.padEnd(22)} → error: ${JSON.stringify(response[1])}`);
      return null;
    }
    console.log(`    ${name.padEnd(22)} → ok`);
    return response[1] as Json;
  }

  // ── Which object model is this? ───────────────────────────────────────────
  console.log("\n--- which methods exist");
  const cardGet = await tryMethod("ContactCard/get", { ids: null });
  const contactGet = await tryMethod("Contact/get", { ids: null });
  const addressBookGet = await tryMethod("AddressBook/get", { ids: null });
  const contactGroupGet = await tryMethod("ContactGroup/get", { ids: null });

  if (cardGet) {
    confirmed.push(
      "This server speaks the CURRENT draft: ContactCard, i.e. JSContact " +
        "(RFC 9553). `emails` is a keyed OBJECT, not an array.",
    );
  } else if (contactGet) {
    confirmed.push(
      "This server speaks the OLD draft: Contact, with firstName/lastName and " +
        "`emails: [{ type, value }]` as an ARRAY.",
    );
  } else {
    findings.push(
      "NEITHER ContactCard/get NOR Contact/get works, despite the capability " +
        "being advertised. The address book is not readable over JMAP here.",
    );
  }
  if (addressBookGet) confirmed.push("AddressBook/get works — there are named books.");
  if (contactGroupGet) confirmed.push("ContactGroup/get works — there are groups.");

  // ── What does one actually look like? ─────────────────────────────────────
  const listing = cardGet ?? contactGet;
  const list = (listing?.list ?? []) as Json[];
  console.log(`\n--- ${list.length} contact(s) on this account`);
  if (list.length === 0 && !LOOPBACK.has(new URL(rawUrl).hostname)) {
    // Only a finding when the fixture below CANNOT run. An empty address book
    // against a real server means the shape is still a guess; against the local
    // container it just means the probe is about to create one.
    findings.push(
      "THE ADDRESS BOOK IS EMPTY and this is not a loopback server, so the " +
        "probe could not create a fixture. The shape of a populated card is " +
        "unproven here — add one and re-run before trusting the parser.",
    );
  } else if (list.length > 0) {
    console.log(
      JSON.stringify(list[0], null, 2)
        .split("\n")
        .slice(0, 60)
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }

  // ── A real card, so the shape stops being a guess ─────────────────────────
  //
  // An empty address book must not read as a clean bill of health — the Slice 0
  // probe made exactly that mistake and the dossier records it. So if this is a
  // loopback server, the probe CREATES one card, reads it back, and destroys it.
  //
  // Guarded to loopback for the same reason `mail:fixture` and
  // `mail:probe-compose` are: a probe that writes must not be one keystroke away
  // from doing it in somebody's real address book.
  if (list.length === 0 && LOOPBACK.has(new URL(rawUrl).hostname)) {
    console.log("\n--- empty, so creating one card to learn the shape");

    const [book] = ((addressBookGet?.list ?? []) as Json[]);
    const card: Json = {
      // JSContact (RFC 9553). Sent WITHOUT @type/version to find out whether the
      // server requires them or fills them in.
      name: {
        components: [
          { kind: "given", value: "Aoife" },
          { kind: "surname", value: "Ó Braonáin" },
        ],
      },
      emails: {
        work: { address: "aoife@probe.example", contexts: { work: true } },
        personal: { address: "aoife.home@probe.example" },
      },
      organizations: { o1: { name: "Probe Construction Ltd" } },
      ...(book ? { addressBookIds: { [book.id as string]: true } } : {}),
    };

    const created = await http(apiUrl, {
      using: [CORE, CONTACTS],
      methodCalls: [["ContactCard/set", { accountId, create: { probe: card } }, "cc"]],
    });
    const setResponse = (created.methodResponses ?? [])[0];
    const refusal = (setResponse?.[1]?.notCreated ?? {}).probe;
    if (refusal) {
      findings.push(
        `ContactCard/set refused a card: ${JSON.stringify(refusal)}. The shape ` +
          "above is what it rejected, so the parser is still unproven.",
      );
    } else {
      const cardId = setResponse[1].created.probe.id as string;
      try {
        const readBack = await http(apiUrl, {
          using: [CORE, CONTACTS],
          methodCalls: [["ContactCard/get", { accountId, ids: [cardId] }, "cr"]],
        });
        const stored = ((readBack.methodResponses ?? [])[0]?.[1]?.list ?? [])[0] as Json;
        console.log("\n--- what a stored ContactCard ACTUALLY looks like");
        console.log(
          JSON.stringify(stored, null, 2)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
        );

        // The three things a parser has to get right, asserted individually so
        // a failure names which one.
        const emails = stored?.emails as Json | undefined;
        if (emails && !Array.isArray(emails) && typeof emails === "object") {
          const addresses = Object.values(emails).map((e) => (e as Json).address);
          if (addresses.includes("aoife@probe.example")) {
            confirmed.push(
              "`emails` is a keyed object whose values carry `address` — NOT an " +
                "array of `{ type, value }` as the old draft had.",
            );
          } else {
            findings.push(
              `The address did not come back where expected: ${JSON.stringify(emails)}`,
            );
          }
        } else {
          findings.push(`\`emails\` came back as ${JSON.stringify(emails)}.`);
        }

        const name = stored?.name as Json | undefined;
        if (typeof name?.full === "string" && name.full.length > 0) {
          confirmed.push(
            `The server COMPUTES \`name.full\` ("${name.full}") from the ` +
              "components, so a display name need not be assembled by hand.",
          );
        } else {
          findings.push(
            "`name.full` is absent, so a display name must be assembled from " +
              "`name.components` in order — which is locale-dependent and the " +
              "reason JSContact has a `full` field at all.",
          );
        }

        if (stored?.["@type"] === "Card" || stored?.version) {
          confirmed.push(
            "The server fills in `@type`/`version` itself; a client need not send them.",
          );
        }

        // Does the text filter actually match this card?
        const searched = await http(apiUrl, {
          using: [CORE, CONTACTS],
          methodCalls: [
            ["ContactCard/query", { accountId, filter: { text: "aoife" }, limit: 5 }, "cq"],
          ],
        });
        const hits = ((searched.methodResponses ?? [])[0]?.[1]?.ids ?? []) as string[];
        if (hits.includes(cardId)) {
          confirmed.push("A `text` filter matches on the address and the name.");
        } else {
          findings.push(
            "A `text` filter did NOT match a card that obviously should match. " +
              "Server-side search is advertised but not usable; autocomplete " +
              "would have to fetch and filter locally.",
          );
        }

        const byName = await http(apiUrl, {
          using: [CORE, CONTACTS],
          methodCalls: [
            ["ContactCard/query", { accountId, filter: { text: "Braonáin" }, limit: 5 }, "cn"],
          ],
        });
        const nameHits = ((byName.methodResponses ?? [])[0]?.[1]?.ids ?? []) as string[];
        if (nameHits.includes(cardId)) {
          confirmed.push("The text filter handles non-ASCII in a surname.");
        } else {
          findings.push(
            "The text filter missed a non-ASCII surname. Anybody with an " +
              "accented name would be unfindable by typing their own name.",
          );
        }
      } finally {
        await http(apiUrl, {
          using: [CORE, CONTACTS],
          methodCalls: [["ContactCard/set", { accountId, destroy: [cardId] }, "cd"]],
        });
        console.log("\ncleanup   probe card destroyed");
      }
    }
  }
  // ── Can it be SEARCHED server-side, or must we fetch and filter? ──────────
  console.log("\n--- can it be queried");
  const queryName = cardGet ? "ContactCard/query" : "Contact/query";
  const queried = await tryMethod(queryName, {
    filter: { text: "a" },
    limit: 5,
  });
  if (queried) {
    confirmed.push(
      `${queryName} accepts a text filter, so autocomplete can ask the server ` +
        "rather than downloading the whole address book to filter locally.",
    );
  } else {
    findings.push(
      `${queryName} refused a text filter. Autocomplete would have to fetch ` +
        "the whole address book and filter in our own code — fine for a few " +
        "hundred contacts, not for a synced corporate directory.",
    );
  }

  report();
}

function report(): void {
  console.log("\n─── CONFIRMED");
  for (const line of confirmed) console.log(`    ✓ ${line}`);
  console.log("\n─── FINDINGS");
  if (findings.length === 0) console.log("    (none — every assumption held)");
  for (const line of findings) console.log(`    ! ${line}`);
  console.log("");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
