import "dotenv/config";

/**
 * Which search conditions does this mail server actually implement?
 *
 *   npm run mail:probe-search
 *
 * WHY EVERY ONE HAS TO BE TESTED AGAINST A DECOY. RFC 8621 §4.4.1 defines about
 * fifteen `FilterCondition` fields, and a server is not obliged to implement all
 * of them. There are three possible outcomes per field and only one of them is
 * safe:
 *
 *   1. **supported** — narrows the result, which is what we want;
 *   2. **rejected** — `unsupportedFilter`, which is fine: we can hide the field;
 *   3. **IGNORED** — accepted, and then not applied.
 *
 * The third is the one this script exists for. A `from` condition that is
 * accepted and ignored turns "find mail from Dan" into "here is everything",
 * and it looks like a working search returning a lot of results. Nobody reports
 * that as a bug; they conclude the search is bad and stop using it.
 *
 * So every condition is checked twice: it must MATCH a message built to match,
 * and it must EXCLUDE a decoy built not to. A condition that returns both is
 * being ignored, whatever the response said.
 *
 * IT WRITES two throwaway messages, so it is LOOPBACK-ONLY and destroys them on
 * every exit path.
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
const supported: string[] = [];
const findings: string[] = [];

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

  const call = async (methodCalls: unknown[][]): Promise<Json[]> =>
    (await http(apiUrl, { using: [CORE, MAIL], methodCalls })).methodResponses;
  const byId = (rs: Json[], id: string): Json =>
    (rs.find((r) => r[2] === id)?.[1] as Json) ?? {};

  const boxes = byId(await call([["Mailbox/get", { accountId, ids: null }, "m"]]), "m");
  const inbox = ((boxes.list ?? []) as Json[]).find((f) => f.role === "inbox");
  if (!inbox) fail("no inbox");

  const stamp = String(Date.now()).slice(-8);
  /** Built to MATCH every condition below. */
  const target = {
    mailboxIds: { [inbox.id]: true },
    keywords: { $flagged: true },
    from: [{ name: "Aoife Target", email: `target-${stamp}@probe.example` }],
    to: [{ name: null, email: `dest-${stamp}@probe.example` }],
    subject: `Quotation zebrafish ${stamp}`,
    bodyValues: { t: { value: `body needle wildebeest ${stamp}` } },
    textBody: [{ partId: "t", type: "text/plain" }],
    receivedAt: "2020-06-15T12:00:00Z",
  };
  /** Built to match NONE of them. Same mailbox, so `inMailbox` cannot carry it. */
  const decoy = {
    mailboxIds: { [inbox.id]: true },
    keywords: { $seen: true },
    from: [{ name: "Other Person", email: `decoy-${stamp}@elsewhere.example` }],
    to: [{ name: null, email: `nobody-${stamp}@elsewhere.example` }],
    subject: `Unrelated ${stamp}`,
    bodyValues: { t: { value: `nothing of interest ${stamp}` } },
    textBody: [{ partId: "t", type: "text/plain" }],
    receivedAt: "2024-06-15T12:00:00Z",
  };

  const made = byId(
    await call([["Email/set", { accountId, create: { t: target, d: decoy } }, "c"]]),
    "c",
  );
  if (made.notCreated?.t || made.notCreated?.d) {
    fail(`could not create probe mail: ${JSON.stringify(made.notCreated)}`);
  }
  const targetId = made.created.t.id as string;
  const decoyId = made.created.d.id as string;

  try {
    /**
     * Run one condition and classify it. `label` is what the UI would call the
     * field, so a finding reads as something to act on.
     */
    async function check(label: string, filter: Json): Promise<void> {
      const rs = await call([
        ["Email/query", { accountId, filter, limit: 500 }, "q"],
      ]);
      const response = rs.find((r) => r[2] === "q");
      if (response?.[0] === "error") {
        // Honest refusal. Fine — the field simply is not offered.
        findings.push(
          `\`${label}\` is REFUSED (${JSON.stringify(response[1])}). Do not offer it.`,
        );
        return;
      }
      const ids = ((response?.[1]?.ids ?? []) as string[]);
      const hitTarget = ids.includes(targetId);
      const hitDecoy = ids.includes(decoyId);

      if (hitTarget && !hitDecoy) {
        supported.push(label);
      } else if (hitTarget && hitDecoy) {
        // THE DANGEROUS ONE. Accepted and not applied.
        findings.push(
          `\`${label}\` is ACCEPTED BUT IGNORED — it matched the decoy too. ` +
            "Offering this field would turn a narrow search into 'everything', " +
            "which reads as a bad search rather than a bug.",
        );
      } else {
        findings.push(
          `\`${label}\` matched neither the target nor the decoy. Either the ` +
            "condition means something other than expected, or indexing is async.",
        );
      }
    }

    console.log("\n--- checking each condition against a target and a decoy");
    await check("from", { from: `target-${stamp}@probe.example` });
    await check("to", { to: `dest-${stamp}@probe.example` });
    await check("subject", { subject: "zebrafish" });
    await check("body", { body: "wildebeest" });
    await check("text", { text: "zebrafish" });
    await check("hasKeyword", { hasKeyword: "$flagged" });
    await check("notKeyword", { notKeyword: "$seen" });
    await check("before", { before: "2022-01-01T00:00:00Z" });
    await check("after", { after: "2019-01-01T00:00:00Z", before: "2021-01-01T00:00:00Z" });
    await check("header", { header: ["Subject", "zebrafish"] });

    // Operators are what turn a list of fields into a builder. Without AND the
    // whole feature is one condition at a time.
    await check("AND (operator)", {
      operator: "AND",
      conditions: [{ subject: "zebrafish" }, { hasKeyword: "$flagged" }],
    });
    await check("OR (operator)", {
      operator: "OR",
      conditions: [{ subject: "zebrafish" }, { subject: "no-such-subject-here" }],
    });
    await check("NOT (operator)", {
      operator: "NOT",
      conditions: [{ subject: `Unrelated ${stamp}` }],
    });

    // Size is the one people ask for and rarely need; worth knowing either way.
    // Sized from the messages themselves. `minSize: 1` matches everything and
    // would report as "accepted but ignored" — a probe bug that looks exactly
    // like a server bug, which is the thing this script is meant to avoid.
    const sizes = byId(
      await call([
        ["Email/get", { accountId, ids: [targetId, decoyId], properties: ["size"] }, "s"],
      ]),
      "s",
    );
    const sized = (sizes.list ?? []) as Json[];
    const targetSize = sized.find((e) => e.id === targetId)?.size ?? 0;
    const decoySize = sized.find((e) => e.id === decoyId)?.size ?? 0;
    if (targetSize > decoySize) {
      await check("minSize", { minSize: decoySize + 1 });
    } else if (decoySize > targetSize) {
      await check("maxSize", { maxSize: decoySize - 1 });
    } else {
      findings.push("The two probe messages are the same size; size was not tested.");
    }
  } finally {
    await call([["Email/set", { accountId, destroy: [targetId, decoyId] }, "d"]]);
    console.log("\ncleanup   probe messages destroyed");
  }

  console.log("\n─── SUPPORTED (matched the target, excluded the decoy)");
  for (const line of supported) console.log(`    ✓ ${line}`);
  console.log("\n─── FINDINGS");
  if (findings.length === 0) console.log("    (none — every condition behaved)");
  for (const line of findings) console.log(`    ! ${line}`);
  console.log("");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
