/**
 * Turning rules into a Sieve script.
 *
 * THIS FILE GENERATES CODE THAT THE MAIL SERVER EXECUTES. Everything a user
 * types — a sender, a word in a subject, a folder name — is interpolated into
 * a program. That makes `sieveString()` below the most important function in
 * the module, and the reason the whole thing is pure and heavily tested: a
 * quote that escapes its string does not throw, it changes what the script
 * does to every message that arrives afterwards.
 *
 * The blast radius is one mailbox, since a script runs inside the account that
 * owns it. That is a reason not to panic, not a reason to be careless: the
 * cheapest available damage is `discard`, and a rule that silently deletes
 * incoming mail is about the worst thing this product could do.
 *
 * Pure, so the output can be asserted character by character. Nothing here
 * touches the network.
 */

export type RuleField = "from" | "to" | "subject";

export interface RuleTest {
  field: RuleField;
  /** Substring match. The only operator offered, deliberately — see below. */
  contains: string;
}

export interface RuleAction {
  /**
   * JMAP mailbox id, not a name.
   *
   * The server supports the `mailboxid` extension, so a rule survives the
   * folder being renamed. `fileinto :mailboxid "id" "Name"` carries the name
   * only as the fallback Sieve uses when the id no longer resolves.
   */
  fileIntoMailboxId: string | null;
  fileIntoName: string | null;
  markRead: boolean;
  flag: boolean;
}

export interface MailRule {
  name: string;
  isEnabled: boolean;
  /** Every test must match, or any one of them. */
  match: "all" | "any";
  tests: RuleTest[];
  action: RuleAction;
  /** Stop processing later rules when this one matches. */
  stop: boolean;
}

/** Stalwart reports maxSizeScript = 102400. Stay well inside it. */
export const MAX_SCRIPT_BYTES = 60_000;
/** The one script this module owns. Updated in place, never recreated. */
export const RULES_SCRIPT_NAME = "yosher-rules";

/**
 * A Sieve quoted string.
 *
 * RFC 5228 §2.4.2: inside a quoted string, backslash escapes backslash and
 * double-quote. Backslash MUST be escaped first — doing quotes first would
 * then escape the backslashes this step introduced and produce a different
 * string.
 *
 * Control characters are removed rather than escaped. A newline inside a
 * quoted string is legal Sieve, but it makes a generated script impossible to
 * read in a diff and gives an attacker a line boundary to work with; nothing
 * a user should be typing into "subject contains" needs one.
 */
export function sieveString(value: string): string {
  const printable = value.replace(/[\u0000-\u001F\u007F]/g, "");
  const escaped = printable.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function testLine(test: RuleTest): string {
  const needle = sieveString(test.contains);
  switch (test.field) {
    case "subject":
      return `header :contains "subject" ${needle}`;
    case "from":
      return `address :contains "from" ${needle}`;
    case "to":
      // `to` alone misses anyone cc'd, which is not what somebody filing mail
      // addressed to a shared address means by "to".
      return `address :contains ["to", "cc"] ${needle}`;
  }
}

function actionLines(rule: MailRule): string[] {
  const lines: string[] = [];
  if (rule.action.fileIntoMailboxId) {
    // The name is the FALLBACK, used only if the id stops resolving. Passing
    // it is what stops a deleted folder turning into silently dropped mail.
    const fallback = sieveString(rule.action.fileIntoName ?? "INBOX");
    lines.push(
      `fileinto :mailboxid ${sieveString(rule.action.fileIntoMailboxId)} ${fallback};`,
    );
  }
  // `\\Seen` and `\\Flagged` in the generated text are the IMAP flags \Seen
  // and \Flagged — one backslash survives Sieve's own escaping.
  if (rule.action.markRead) lines.push(`addflag "\\\\Seen";`);
  if (rule.action.flag) lines.push(`addflag "\\\\Flagged";`);
  if (rule.stop) lines.push("stop;");
  return lines;
}

/**
 * Only the extensions actually used, so a script cannot require what the
 * server lacks.
 *
 * `mailbox` IS REQUIRED ALONGSIDE `mailboxid`, and that is not a style
 * question — Stalwart rejects the entire script with
 * `Undeclared capability 'mailbox'`, pointing at the `:mailboxid` tag. RFC 9042
 * reads as though `mailboxid` alone were enough, which is exactly why this was
 * wrong until the server was asked: seventeen unit tests passed against output
 * the mail server refused to compile.
 */
function requiredExtensions(rules: MailRule[]): string[] {
  const needed = new Set<string>();
  for (const rule of rules) {
    if (rule.action.fileIntoMailboxId) {
      needed.add("fileinto");
      needed.add("mailbox");
      needed.add("mailboxid");
    }
    if (rule.action.markRead || rule.action.flag) needed.add("imap4flags");
  }
  return [...needed].sort();
}

export interface CompileResult {
  script: string;
  /** Rules that produced no Sieve at all, by name. */
  inert: string[];
}

/**
 * Compile enabled rules into one script.
 *
 * A rule with no tests, or with no action, produces nothing and is reported as
 * inert rather than emitted. A test-less rule would match EVERY message —
 * filing an entire mailbox into one folder on the strength of a half-finished
 * form — and an action-less one would generate an empty block. Both are far
 * more likely to be an unfinished thought than an intention.
 */
export function compileRules(rules: MailRule[]): CompileResult {
  const live = rules.filter(
    (rule) =>
      rule.isEnabled &&
      rule.tests.length > 0 &&
      actionLines(rule).some((line) => !line.startsWith("stop")),
  );
  const inert = rules
    .filter((rule) => rule.isEnabled && !live.includes(rule))
    .map((rule) => rule.name);

  const extensions = requiredExtensions(live);
  const out: string[] = [];

  if (extensions.length > 0) {
    out.push(`require [${extensions.map(sieveString).join(", ")}];`);
    out.push("");
  }
  out.push("# Generated by Yosher. Changes made here are overwritten.");
  out.push("");

  for (const rule of live) {
    // The name is a COMMENT, so it is escaped differently: comments run to end
    // of line, which means a newline is the only dangerous character and it
    // has to be flattened rather than escaped.
    out.push(`# ${rule.name.replace(/[\r\n]+/g, " ").slice(0, 200)}`);

    const tests = rule.tests.map(testLine);
    const condition =
      tests.length === 1
        ? tests[0]
        : `${rule.match === "all" ? "allof" : "anyof"} (${tests.join(", ")})`;

    out.push(`if ${condition} {`);
    for (const line of actionLines(rule)) out.push(`  ${line}`);
    out.push("}");
    out.push("");
  }

  return { script: out.join("\n"), inert };
}
