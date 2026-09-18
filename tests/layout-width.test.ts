import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * HOW WIDE THE APP IS, AND HOW WIDE A SENTENCE IS (ADR 0088).
 *
 * Two numbers, one line of CSS each, and **both of them fail silently**.
 *
 * `max-w-content` is a Tailwind v4 utility generated from `--container-content`
 * in `@theme`. Rename or drop the token and the class stops existing: no error,
 * no warning, no failing build — the column simply becomes unbounded, and a
 * table row on a 3,440px monitor runs the whole way across. The same is true of
 * `--container-measure` and the rule that caps running text: lose it and 398
 * paragraphs in 188 files quietly go back to 230 characters a line.
 *
 * Neither is visible in `tsc`, in lint, in the build or in any other test. This
 * is that test — the same reason `module-accents.test.ts` exists.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");
const SHELL = readFileSync("src/components/app-shell.tsx", "utf8");

describe("the width tokens", () => {
  it("declares --container-content, so `max-w-content` is a real utility", () => {
    expect(CSS).toMatch(/--container-content:\s*[^;]+;/);
  });

  it("declares --container-measure, so `max-w-measure` is a real utility", () => {
    expect(CSS).toMatch(/--container-measure:\s*[^;]+;/);
  });

  it("measures the line length in `ch`, so it scales with the type", () => {
    const measure = /--container-measure:\s*([^;]+);/.exec(CSS)?.[1].trim();
    expect(measure, "a measure in px is a measure for one font size only").toMatch(/ch$/);
  });
});

describe("the shell's column", () => {
  it("is clamped by the token, not by a hardcoded width", () => {
    expect(SHELL).toContain("max-w-content");
  });

  /**
   * 72rem is what it was, and it spent two thirds of an ultrawide on margin.
   * A revert would look like a tidy-up in a diff. Comments are stripped first
   * — the one above the column explains what it used to be.
   */
  it("is not back on max-w-6xl", () => {
    const code = SHELL.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("max-w-6xl");
  });
});

describe("running text", () => {
  it("is capped inside the app's content column", () => {
    expect(CSS).toMatch(/\[data-app-main\]\s+p\s*\{[^}]*max-width:\s*var\(--container-measure\)/);
  });

  /** Centred text in a capped box has to keep the box centred. */
  it("keeps a centred paragraph centred", () => {
    expect(CSS).toMatch(/\[data-app-main\]\s+p\.text-center\s*\{[^}]*margin-inline:\s*auto/);
  });
});
