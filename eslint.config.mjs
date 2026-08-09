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
const MODULE_SLUGS = [
  "accounting",
  "crm",
  "documents",
  "email",
  "hello",
  "scheduling",
  // Added 2026-08-09, three slices late. `src/modules/work/` existed from slice
  // 1 and was not in this list, so nothing stopped it importing another module
  // AND nothing stopped another module importing it — the guard is generated
  // from this array in both directions. A new module belongs here in the slice
  // that creates its directory.
  "work",
];

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
 * Modules that declare an "attach this to a record" surface, and therefore have
 * to run the wiring that composes every contributor's linkable types.
 *
 * TWO HOSTS RATHER THAN ONE, which is the difference from `EXTENSION_HOST`
 * above. Mail declared the idea first; scheduling wants the same nine entity
 * types, because an event is attached to an invoice for the same reason a
 * thread is. The contract lives in `src/lib/entity-links/` and both import its
 * registry.
 *
 * A CONTRIBUTOR IS STILL FORBIDDEN. Accounting importing this registry would
 * pull in CRM and Documents through it — rule 1 defeated by one indirection,
 * exactly as with mail's. Adding a host here is a deliberate act: it means that
 * module now renders a picker over everybody else's records.
 */
const ENTITY_LINK_HOSTS = ["email", "scheduling", "work"];

/**
 * WORK IS THE FIRST MODULE THAT IS BOTH A HOST AND A CONTRIBUTOR, and that
 * combination has an edge the per-module rule above cannot see.
 *
 * Being a host exempts the WHOLE directory from the registry ban — the rule is
 * generated per module, not per file. But `src/modules/work/links.ts` is Work's
 * CONTRIBUTION, imported BY the registry. If it imported the registry back, the
 * two files would form a genuine import cycle: `registry -> work/links ->
 * registry`, which JavaScript resolves by handing one of them a half-built
 * module and is the kind of failure that shows up as `undefined is not a
 * function` at request time, on one route, in production.
 *
 * So the contributor file gets the non-host rules put back. Everything else
 * under `src/modules/work/` keeps the host exemption it needs to render the
 * picker.
 */
const CONTRIBUTOR_FILE_MESSAGE =
  "This file is Work's CONTRIBUTION to entity-links and is imported by the registry. " +
  "Importing the registry from here creates a cycle (registry -> links -> registry). " +
  "The host half of Work may import it; this file may not.";

const ENTITY_LINKS_MESSAGE =
  "A module may import only src/lib/entity-links/types. The registry composes every " +
  "module's linkable types, so importing it from a contributor pulls in every other " +
  "module and defeats the isolation rule by one level of indirection. Only a module " +
  "that DECLARES an attach-to surface (mail, scheduling) is a host.";

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

/**
 * The patterns one module directory is forbidden to import.
 *
 * Extracted so the per-file override below can ask for the NON-host version of
 * a host module's rules without restating any of them — two copies of this list
 * would drift, and the one that drifted would be the one nobody reads.
 */
function isolationPatterns(slug, { entityLinkHost }) {
  return [
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
    ...(entityLinkHost
      ? []
      : [
          {
            group: ["@/lib/entity-links/registry"],
            message: ENTITY_LINKS_MESSAGE,
          },
        ]),
  ];
}

const moduleIsolation = MODULE_SLUGS.map((slug) => ({
  files: [`src/modules/${slug}/**/*.{ts,tsx}`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: isolationPatterns(slug, {
          entityLinkHost: ENTITY_LINK_HOSTS.includes(slug),
        }),
      },
    ],
  },
}));

/**
 * The one file inside a host module that is a CONTRIBUTOR — see
 * CONTRIBUTOR_FILE_MESSAGE. Flat config is last-wins per rule, so this block
 * REPLACES the module's patterns for this file, which is why it asks for the
 * full non-host set rather than only the registry ban.
 */
const contributorFileInHost = {
  files: ["src/modules/work/links.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: isolationPatterns("work", { entityLinkHost: false }).map(
          (pattern) =>
            pattern.group[0] === "@/lib/entity-links/registry"
              ? { ...pattern, message: CONTRIBUTOR_FILE_MESSAGE }
              : pattern,
        ),
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...moduleIsolation,
  // AFTER moduleIsolation, deliberately: flat config is last-wins per rule.
  contributorFileInHost,
  {
    // The extension contract and the resolver. `registry.ts` is deliberately
    // absent from this glob — it is the one file allowed to name modules.
    files: [
      "src/lib/mail-extensions/types.ts",
      "src/lib/mail-extensions/resolve.ts",
      "src/lib/attention-sources/types.ts",
      "src/lib/attention-sources/resolve.ts",
      // The shared linkable-record contract. Same rule, same reason: a contract
      // that imported an implementation of itself would invert the graph.
      "src/lib/entity-links/types.ts",
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
