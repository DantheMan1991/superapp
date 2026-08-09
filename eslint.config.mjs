import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * MODULE ISOLATION, ENFORCED.
 *
 * Until this slice the rule in docs/extension-model.md — "a module never imports
 * another module" — was discipline. Discipline is what a codebase has instead of
 * a constraint, and this one is built largely by agents reading nearby code to
 * infer what is allowed. One `import { loadDocument } from "@/modules/documents"`
 * inside `src/modules/email/` would have read as precedent forever after, and by
 * the time anybody noticed, Mail would not work for a tenant who never bought
 * Documents.
 *
 * THE THREE RULES, and what each protects:
 *
 *  1. **A module may not import another module.** Modules are sold separately.
 *     `src/modules/documents/ingest.ts` says it in prose already: "the module
 *     owns its own copy rather than importing the accounting one, so a tenant
 *     without accounting still has a working filing cabinet." Genuinely shared
 *     code moves to `src/lib/` — which is exactly how `sanitizeFileName` ended
 *     up in `lib/file-headers.ts`.
 *
 *  2. **A CONTRIBUTING module may import only `mail-extensions/types`, never
 *     `registry` or `resolve`.** A contributor importing `registry.ts` would
 *     import every other module through it, defeating rule 1 by one level of
 *     indirection. The contract is the types; the wiring is not a contributor's
 *     business.
 *
 *     `src/modules/email/` is exempt, and the exemption is the whole shape of a
 *     declared extension point: mail DECLARES the slot and is the thing that
 *     runs it, so it necessarily depends on the registry that composes the
 *     fillers. Everything else FILLS a slot, and a filler that knew about the
 *     other fillers would not be one. The asymmetry is the design, not a
 *     loophole — which is why it is one named directory rather than a pattern.
 *
 *  3. **`mail-extensions/` may not import modules, except `registry.ts`.** The
 *     composition root is one file by name. `types.ts` importing a module would
 *     make the contract depend on an implementation of itself.
 *
 * `src/modules/index.ts` never trips rule 1: it imports only each module's
 * top-level renderer, and it is the other composition root — it exists so that
 * nothing else has to be.
 *
 * WHAT THIS CANNOT CATCH: a dynamic `await import(...)`, and a deep relative
 * path nobody would write by hand. The `../` patterns below cover the plausible
 * escapes from one module directory into another; the alias form is what this
 * codebase actually uses, and that one is airtight.
 *
 * NOT restricted, on purpose: `@/db/schema`. Tables are the platform's, not a
 * module's — mail's reverse view reads `mail_links`, and accounting's invoice
 * page reads `documents`. What isolation protects is CODE coupling: a module
 * must not depend on another module's functions, errors or behaviour. RLS, not
 * an import graph, is what decides who may read a row.
 */
const MODULE_SLUGS = ["accounting", "crm", "documents", "email", "hello"];

const CROSS_MODULE_MESSAGE =
  "Modules are sold separately and must work alone — a module may not import another module. " +
  "Move genuinely shared code to src/lib/, or contribute through the mail-extensions contract " +
  "(src/lib/mail-extensions/types.ts). See docs/extension-model.md.";

const REGISTRY_MESSAGE =
  "A module may import only src/lib/mail-extensions/types. Importing the registry or the " +
  "resolver pulls in every other module and defeats the isolation rule by one level of indirection.";

/**
 * Every way one module directory could name another, alias and relative.
 *
 * NOTE WHAT IS DELIBERATELY ABSENT: the single-level `../<slug>/*`. It reads
 * like the obvious escape and it is ambiguous — from a file inside a module
 * subdirectory it points at a SIBLING subdirectory of the same module, not at
 * another module. `src/modules/accounting/documents/` is the live example, and
 * the first version of this config flagged accounting's own
 * `../documents/links` as a cross-module import. Two levels up and beyond always
 * clears the module root, so those are unambiguous and stay.
 *
 * The alias form is what this codebase actually writes, and that one is exact.
 */
function pathsToModule(slug) {
  return [
    `@/modules/${slug}`,
    `@/modules/${slug}/*`,
    `@/modules/${slug}/**`,
    `../../${slug}/*`,
    `../../../${slug}/*`,
    `../../modules/${slug}/*`,
    `../../../modules/${slug}/*`,
  ];
}

/** The module that DECLARES the mail extension point, and therefore runs it. */
const EXTENSION_HOST = "email";

/**
 * The attention-source contract gets the same treatment, with one asymmetry
 * worth naming: it has NO module exemption.
 *
 * Mail's host is a module (`src/modules/email/`), so that one directory has to
 * be allowed to reach the registry it runs. Attention sources are run by the
 * notifications digest, which is platform-level code in `src/lib/` and
 * `src/app/` — no module declares this slot, so no module needs to import the
 * wiring. Every module here is a filler, and a filler that knew about the other
 * fillers would not be one.
 */
const ATTENTION_REGISTRY_MESSAGE =
  "A module may import only src/lib/attention-sources/types. The registry and resolver are " +
  "platform wiring — importing either pulls in every other module's source and defeats the " +
  "isolation rule by one level of indirection.";

const moduleIsolation = MODULE_SLUGS.map((slug) => ({
  files: [`src/modules/${slug}/**/*.{ts,tsx}`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          ...MODULE_SLUGS.filter((other) => other !== slug).map((other) => ({
            group: pathsToModule(other),
            message: CROSS_MODULE_MESSAGE,
          })),
          ...(slug === EXTENSION_HOST
            ? []
            : [
                {
                  group: [
                    "@/lib/mail-extensions/registry",
                    "@/lib/mail-extensions/resolve",
                  ],
                  message: REGISTRY_MESSAGE,
                },
              ]),
          // No host exemption — see ATTENTION_REGISTRY_MESSAGE above.
          {
            group: [
              "@/lib/attention-sources/registry",
              "@/lib/attention-sources/resolve",
            ],
            message: ATTENTION_REGISTRY_MESSAGE,
          },
        ],
      },
    ],
  },
}));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...moduleIsolation,
  {
    // The extension contract and the resolver. `registry.ts` is deliberately
    // absent from this glob — it is the one file allowed to name modules.
    files: [
      "src/lib/mail-extensions/types.ts",
      "src/lib/mail-extensions/resolve.ts",
      "src/lib/attention-sources/types.ts",
      "src/lib/attention-sources/resolve.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*", "@/modules/**"],
              message:
                "Only the registry.ts beside this file may import modules. The contract must not " +
                "depend on an implementation of itself.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // AND EVERY NESTED COPY OF THEM. `.next/**` anchors at the repo root, so it
    // does not match a build output sitting inside a git worktree — and
    // `.claude/worktrees/` accumulates those, each with its own full `.next`.
    // The bundles in there are ordinary .js files whose NAMES contain
    // "node_modules", so the default node_modules ignore misses them too.
    //
    // Left unignored this is not a slow lint, it is an unusable one: six stale
    // worktrees carrying several hundred megabytes of generated chunks took
    // `npm run lint` past seventeen minutes and 1.2 GB of resident memory
    // before it was killed. CI never saw it because CI checks out clean.
    "**/.next/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
