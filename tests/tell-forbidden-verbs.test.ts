import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **DRAFT, NEVER SEND** ([ADR 0054](../docs/decisions/0054-tell-may-draft-never-send.md) §1),
 * enforced rather than remembered.
 *
 * The founder asked for the box to work with every tool and was comfortable
 * with it doing financial things. The line drawn was not around *money* — it
 * was around **reversibility and reach**: a confirm card verifies intent, and
 * it cannot un-send an email or un-charge a card. Such a verb fails
 * [ADR 0050](../docs/decisions/0050-a-safe-verb-records-itself.md)'s second
 * test so completely that it must not be PROPOSABLE, never mind recordable.
 *
 * A rule that lives only in an ADR lasts exactly as long as the next person's
 * recollection of it, and the sources this guards are meant to multiply from
 * three to sixteen. So it lives here, where adding the import fails the build.
 *
 * It reads the FILE, not the module graph. A source that reaches a denied verb
 * through three helpers is not caught, and pretending otherwise would be worse
 * than saying so: this stops the obvious thing, done in the obvious way, by
 * somebody who had not read the ADR.
 */

const SRC = join(__dirname, "..", "src");

/** Every filler of the slot, wherever it lives. */
function tellSources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tellSources(full);
    return full.replace(/\\/g, "/").endsWith("/tell/source.ts") ? [full] : [];
  });
}

/** `import { a, b } from "x"` → the specifier and the names, per statement. */
function imports(text: string): Array<{ from: string; names: string[] }> {
  const out: Array<{ from: string; names: string[] }> = [];
  const pattern = /import\s+(type\s+)?(?:\{([^}]*)\}|[\w*\s,]+)\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    const names = (match[2] ?? "")
      .split(",")
      .map((n) => n.replace(/\btype\b/, "").split(/\s+as\s+/)[0].trim())
      .filter((n) => n !== "");
    out.push({ from: match[3], names });
  }
  return out;
}

/**
 * **ANYTHING THAT LEAVES THE BUILDING OR MOVES REAL FUNDS.**
 *
 * By NAME as well as by path, because the name pattern catches the verb that
 * has not been written yet — which is the half a list of today's paths cannot
 * do. `sendable`, `sender` and friends do not match: the capital letter is
 * what makes it a verb applied to something.
 */
const DENIED_NAMES = [
  /^send[A-Z]/,
  /^issue(Invoice|AndSend|CreditMemo)/,
  /^(charge|refund|capture|payout)[A-Z]/,
];

const DENIED_PATHS = [
  "/payments/",
  "/stripe",
  "/square",
  "email/compose",
  "invoicing/send-invoice",
  "invoicing/reminder-test",
];

/**
 * A source that reaches the books owes a posting readback
 * ([ADR 0054](../docs/decisions/0054-tell-may-draft-never-send.md) §2). The
 * contract cannot decide for itself whether an action is financial — that is a
 * fact about what the verb does, which only the module knows — so the rule is
 * written in the ADR and checked here.
 */
const LEDGER_PATHS = ["/accounting/", "/ledger", "/postings", "/journal"];

/**
 * **AND A SOURCE THAT LIVES IN ONE OF THOSE MODULES COUNTS TOO.**
 *
 * Found the moment the rule had a real subject. `accounting/tell/source.ts`
 * reaches the ledger through `../core` and `../banking/quick-add` — RELATIVE,
 * because a module's own tell source always is — so an import-specifier check
 * saw nothing and the preview requirement would never have fired for the one
 * source it was written for. The scan was green and empty.
 *
 * A source's own location is the fact that does not depend on how it spells its
 * imports.
 */
const LEDGER_HOMES = ["/modules/accounting/"];

describe("what a tell source may import", () => {
  const sources = tellSources();

  it("finds the sources at all", () => {
    // The guard that stops this whole file passing by scanning nothing — the
    // failure every scan test is one glob change away from.
    expect(sources.length).toBeGreaterThanOrEqual(3);
    const named = sources.map((f) => f.replace(/\\/g, "/"));
    expect(named.some((f) => f.includes("/livestock/tell/"))).toBe(true);
    expect(named.some((f) => f.includes("/work/tell/"))).toBe(true);
    expect(named.some((f) => f.includes("/time/tell/"))).toBe(true);
  });

  it("never reaches a verb that sends or spends", () => {
    for (const file of sources) {
      const where = file.replace(/\\/g, "/").split("/src/")[1];
      for (const line of imports(readFileSync(file, "utf8"))) {
        for (const path of DENIED_PATHS) {
          expect(
            line.from.includes(path),
            `${where} imports from "${line.from}". A tell action may RECORD money and may never move it or reach a third party — draft, never send (ADR 0054 §1).`,
          ).toBe(false);
        }
        for (const name of line.names) {
          for (const denied of DENIED_NAMES) {
            expect(
              denied.test(name),
              `${where} imports "${name}". A confirm card cannot un-send an email or un-charge a card, so that verb must not be proposable (ADR 0054 §1). Make a DRAFT and leave the sending to a button on a screen.`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it("declares a preview wherever it reaches the books", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const where = file.replace(/\\/g, "/").split("/src/")[1];
      const where2 = file.replace(/\\/g, "/");
      const touchesLedger =
        LEDGER_HOMES.some((home) => where2.includes(home)) ||
        imports(text).some((line) => LEDGER_PATHS.some((p) => line.from.includes(p)));
      if (!touchesLedger) continue;
      expect(
        /\bpreview\s*[(:]/.test(text),
        `${where} reaches the books and declares no preview. A card showing "Feed store · $240 · today" looks exactly as correct whether it posts to 5010 or 6200 — the posting has to be read back above the button (ADR 0054 §2).`,
      ).toBe(true);
    }
  });
});
