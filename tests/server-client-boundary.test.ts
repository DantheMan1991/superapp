import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **A FUNCTION CANNOT CROSS THE SERVER/CLIENT BOUNDARY, AND NOTHING CAUGHT IT.**
 *
 * On 2026-08-26 `/dashboard/m/land` was 500ing on production, and had been for
 * however long it was since somebody first traced a paddock boundary.
 * `LandModule` is a Server Component and passed a client one
 * `zoneHref={(zoneId) => …}`; React cannot serialise a function, so the render
 * threw *"Functions cannot be passed directly to Client Components"* and the
 * route died. A second, identical instance was sitting on
 * `/dashboard/m/documents/search` (`canDelete={(view) => …}`).
 *
 * **`tsc`, `eslint` and `npm run build` were all green with both bugs live.**
 * The prop types match — a function IS a valid `(x) => boolean` — and the error
 * only exists at render, on a dynamic route nothing prerenders. The land one
 * was additionally gated on `mapped > 0`, so every farm with no boundary drawn,
 * including the local dev tenant, rendered the page perfectly.
 *
 * That combination — invisible to every automated check, and conditional on
 * data — is what this test exists for. It resolves each JSX element in a server
 * file back to the module it was imported from and fails if an inline function
 * is being handed to a `"use client"` component.
 */
const SRC = path.resolve(__dirname, "..", "src");

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : Promise.resolve([full]);
    }),
  );
  return out.flat();
}

const isClientSource = (source: string) =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);

/** `@/x` → `src/x`, `./x` → sibling. Returns the file that actually exists. */
async function resolveImport(
  specifier: string,
  fromFile: string,
): Promise<string | null> {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // node_modules — not ours to police

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** name → module specifier, for both named and default imports. */
function importedNames(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1]) continue; // `import type` never reaches runtime
    const clause = m[2];
    const specifier = m[3];
    const braced = clause.match(/\{([\s\S]*?)\}/);
    if (braced) {
      for (const part of braced[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Z]/.test(name)) map.set(name, specifier);
      }
    }
    const bare = clause.replace(/\{[\s\S]*?\}/, "").replace(/,/g, "").trim();
    if (bare && /^[A-Z][A-Za-z0-9_]*$/.test(bare)) map.set(bare, specifier);
  }
  return map;
}

/**
 * Every `<Component ... prop={(a) => …}>` in the source, as
 * `{ element, prop }`. Deliberately only INLINE functions: a bare identifier
 * is usually a server action, which is legal and is the documented way to pass
 * behaviour across the boundary.
 */
function inlineFunctionProps(source: string): { element: string; prop: string }[] {
  const found: { element: string; prop: string }[] = [];
  /**
   * Tags are NOT parsed, deliberately. The obvious `<Tag ...>` regex cannot
   * work here: an arrow function contains `=>`, so the `>` that looks like the
   * end of the tag is usually the arrow of the very prop being looked for. The
   * first version of this test did exactly that, matched nothing, and passed
   * against both live bugs — it was only caught by reintroducing them.
   *
   * So: find the prop, then walk BACKWARDS to the nearest `<Component`. JSX
   * attributes belong to the most recent opening tag, and when a prop sits
   * inside a nested element (`trigger={<Button onClick={…} />}`) the nearest
   * tag is that nested one, which is the right answer anyway.
   */
  const propRe =
    /\b([a-zA-Z][A-Za-z0-9_]*)=\{\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>|\b([a-zA-Z][A-Za-z0-9_]*)=\{\s*(?:async\s+)?function\b/g;
  const tagRe = /<([A-Z][A-Za-z0-9_.]*)/g;
  let p: RegExpExecArray | null;
  while ((p = propRe.exec(source))) {
    const prop = p[1] ?? p[2];
    if (!prop) continue;
    // An inline server action is legal and declares itself.
    if (/["']use server["']/.test(source.slice(p.index, p.index + 300))) continue;

    let element: string | null = null;
    tagRe.lastIndex = 0;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(source)) && t.index < p.index) element = t[1];
    if (element) found.push({ element, prop });
  }
  return found;
}

describe("server/client boundary", () => {
  it("no server component hands an inline function to a client component", async () => {
    const files = (await walk(SRC)).filter((f) => f.endsWith(".tsx"));
    const clientCache = new Map<string, boolean>();

    async function isClientFile(file: string): Promise<boolean> {
      const hit = clientCache.get(file);
      if (hit !== undefined) return hit;
      const source = await fs.readFile(file, "utf8");
      const client = isClientSource(source);
      clientCache.set(file, client);
      return client;
    }

    const violations: string[] = [];

    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      // A client component may pass functions to another client component
      // freely — nothing is serialised between them.
      if (isClientSource(source)) continue;

      const imports = importedNames(source);
      for (const { element, prop } of inlineFunctionProps(source)) {
        const root = element.split(".")[0];
        const specifier = imports.get(root);
        if (!specifier) continue; // defined in this (server) file — fine
        const target = await resolveImport(specifier, file);
        if (!target) continue;
        if (await isClientFile(target)) {
          violations.push(
            `${path.relative(SRC, file).replace(/\\/g, "/")}: ` +
              `<${element} ${prop}={…}> — ${path
                .relative(SRC, target)
                .replace(/\\/g, "/")} is a client component, so this ` +
              `function cannot be serialised. Pass data, or a server action.`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
