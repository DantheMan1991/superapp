import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **EVERY DOOR INTO A MODULE GOES THROUGH `requireModuleEnabled`.**
 *
 * This was a convention — step 4 of the add-a-module workflow — held by 349
 * call sites and by nothing else. ADR 0093 turned it into the place a PERSON's
 * access level is checked, which means a page that forgets it is no longer just
 * showing a switched-off module: it is serving a screen an owner deliberately
 * took away from somebody.
 *
 * A convention with that consequence needs a test rather than a habit. The
 * `jobs` pack reached production with six migrated tables and no catalogue row
 * because the equivalent step had no check; this is the cheap version of not
 * doing that again.
 *
 * Neither rule below is satisfiable by accident, and both are worded so that a
 * page or an action can only pass by doing the right thing — not by naming a
 * variable well.
 */

const MODULE_PAGES = "src/app/dashboard/m";
const ACTION_ROOTS = ["src/modules", "src/packs"];
const ROUTE_ROOT = "src/app/api";

/**
 * Routes that read tenant data WITHOUT a signed-in person, and so cannot be
 * gated on one. Each is listed with what authorises it instead, because an
 * allowlist nobody has to justify is a hole with a comment on it.
 */
const NOT_A_SESSION: Record<string, string> = {
  "src/app/api/inbound/resend/route.ts": "inbound mail webhook, signature-verified",
  "src/app/api/device/tell/route.ts": "a device grant, not a session (ADR 0048)",
  "src/app/api/marketing/sites/live/route.ts": "a published site, public by design",
  "src/app/api/marketing/sites/images/[id]/route.ts": "an image on a published site",
  "src/app/api/marketing/social/posts/[id]/image/route.ts": "a published post's image",
  "src/app/api/marketing/brand/[id]/logo/route.ts": "a logo on a published site",
  "src/app/api/payments/square/start/route.ts": "OAuth start; its own state token",
  "src/app/api/feedback/attachments/[id]/route.ts":
    "the reporter's own attachment; feedback is not a module (ADR 0053)",
};

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match(entry)) out.push(path.replace(/\\/g, "/"));
  }
  return out;
}

const reachesGate = (src: string): boolean =>
  src.includes("requireModuleEnabled") ||
  // The house helper: one `gate()` per module calling it once, which every
  // action in that module awaits. `marketing/gate.ts` is the written-down form.
  /import \{[^}]*\bgate\b/.test(src);

describe("every module page is gated", () => {
  const pages = walk(MODULE_PAGES, (f) => f === "page.tsx");

  it("finds the pages at all, so a moved folder fails loudly", () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  /**
   * **OR TOUCHES NOTHING.** Three of these are a bare `redirect()` to a child
   * that is gated — `purchases` → `purchases/bills`. A page that reads no data
   * and renders nothing has nothing to protect, and requiring the call there
   * would be cargo cult. The test says what "touches nothing" means rather than
   * trusting the file to be short.
   */
  it.each(walk(MODULE_PAGES, (f) => f === "page.tsx"))(
    "%s calls requireModuleEnabled, or reads nothing",
    (path) => {
      const src = readFileSync(path, "utf8");
      if (src.includes("requireModuleEnabled")) return;
      expect(
        /withTenant|withSystem|requireTenant/.test(src),
        `${path} reads data without calling requireModuleEnabled`,
      ).toBe(false);
    },
  );
});

describe("every server action that opens a transaction is gated", () => {
  /**
   * **THE TRANSACTION IS WHAT MAKES IT AN ACTION.** A `"use server"` file that
   * never calls `withTenant` or `withSystem` is a thin wrapper over one that
   * does — `approveBillFromAttentionAction` hands the attention feed's button a
   * handler and delegates — and gating it twice would say nothing extra. One
   * that DOES open a transaction is a door, and a door needs the gate.
   *
   * `"use server"` is checked on the first line, not anywhere in the file:
   * several helpers discuss the directive in a comment about the eslint rule
   * that governs it, and a substring search calls those action files.
   */
  const actionFiles = ACTION_ROOTS.flatMap((root) =>
    walk(root, (f) => f.endsWith(".ts")),
  ).filter((path) => {
    const src = readFileSync(path, "utf8");
    return (
      /^["']use server["'];/.test(src.trimStart()) &&
      /withTenant|withSystem/.test(src)
    );
  });

  it("finds action files at all", () => {
    expect(actionFiles.length).toBeGreaterThan(20);
  });

  it.each(actionFiles)("%s reaches requireModuleEnabled", (path) => {
    expect(
      reachesGate(readFileSync(path, "utf8")),
      `${path} opens a transaction without reaching requireModuleEnabled`,
    ).toBe(true);
  });
});

describe("every route handler that reads tenant data is gated", () => {
  /**
   * **THE SURFACE NOBODY WAS LOOKING AT.** Pages and server actions were gated
   * from the day access levels shipped, because both go through
   * `requireModuleEnabled`. Route handlers went through neither, and this test
   * did not look at them: an audit found nineteen reading tenant data and **not
   * one** calling the gate. Twelve asked `isModuleEnabled`, which is a question
   * about the BUSINESS and never about the person — so somebody whose level
   * denied Accounting could still fetch an invoice PDF by its uuid.
   *
   * A handler cannot `notFound()`, so it calls `routeGate` and returns what it
   * gets back.
   */
  const handlers = walk(ROUTE_ROOT, (f) => f === "route.ts").filter((path) =>
    /withTenant/.test(readFileSync(path, "utf8")),
  );

  it("finds the handlers at all", () => {
    expect(handlers.length).toBeGreaterThan(10);
  });

  it.each(handlers)("%s calls routeGate, or is not a session at all", (path) => {
    const src = readFileSync(path, "utf8");
    if (src.includes("routeGate(")) return;
    expect(
      Object.keys(NOT_A_SESSION),
      `${path} reads tenant data without routeGate. If it has no signed-in caller, add it to NOT_A_SESSION with the reason.`,
    ).toContain(path);
  });

  /**
   * And nothing may go back to the weaker question. `isModuleEnabled` asks
   * whether the business has the tool; on a route with a session that is
   * exactly the check that let the invoice PDF out.
   */
  it.each(handlers)("%s does not settle for isModuleEnabled", (path) => {
    const src = readFileSync(path, "utf8");
    if (path in NOT_A_SESSION) return;
    expect(
      src.includes("isModuleEnabled"),
      `${path} still calls isModuleEnabled; routeGate asks the person too`,
    ).toBe(false);
  });
});
