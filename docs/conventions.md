# Code conventions

> **Read before:** writing a server action, adding a module slice, handling
> money or dates, or writing tests.
> **Update when:** a pattern here is deliberately superseded. If you find
> yourself deviating, either follow the convention or change this file — do not
> leave the codebase holding two patterns silently.

These are descriptive, not aspirational: they are the shapes already in the
tree. Match the surrounding code.

---

## 1. The canonical server action

Every server action follows one shape:

```
gate → Zod → withTenant(core + audit) → revalidate
```

Written out ([src/modules/documents/actions.ts](../src/modules/documents/actions.ts)
is the reference implementation):

```ts
"use server";

const Schema = z.object({ folderId: z.string().uuid(), name: z.string().min(1) });

export async function renameFolderAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();                    // 1. authorize + entitlement
    const { folderId, name } = Schema.parse(input);  // 2. validate
    await withTenant(                            // 3. one transaction
      ctx.tenantId,
      async (tx) => {
        await renameFolder(tx, ctx, folderId, name);   // pure-ish core
        await logAuditInTx(tx, { /* identifiers only */ });
      },
      { role: ctx.role },                        // never omit if visibility matters
    );
    revalidate();                                // 4. cache
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
```

Rules that fall out of that shape:

- **`gate()` is the first statement.** A module-local helper wrapping
  `requireTenant()` + `requireModuleEnabled()` + any role rules. Each module
  defines its own; do not inline the calls.
- **Zod parses before anything else touches the input.** Never index into
  unvalidated input, not even to log it.
- **The mutation and its audit row share one transaction** for anything
  financial (`logAuditInTx`). See [security.md S10](security.md).
- **`{ role: ctx.role }`** whenever the query reads visibility-bearing data.
  Omitting it denies a read; it can never grant one — preserve that direction.
- **One `withTenant` per action.** Two transactions means a half-applied
  mutation is reachable.

### Return type

A discriminated union, never a thrown error crossing the client boundary:

```ts
type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };
```

### Errors

Each module defines its own error type and a `friendlyMessage()` translator
(`core/errors.ts`). A `fail()` helper converts unknown errors into
`{ error }`, logging the real one server-side:

```ts
function fail(err: unknown): { error: string } {
  if (err instanceof DocsError) return { error: friendlyMessage(err) };
  console.error("documents action failed", err);
  return { error: friendlyMessage(err) };
}
```

Never return a raw Postgres or provider error to the client — it leaks schema
and internals.

### Fail closed on roles

The `expert` role (the platform's bookkeeper working inside a client's
workspace) is read-only in modules that have no read-only-safe writes. Deny
explicitly rather than letting the default carry it:

```ts
if (ctx.role === "expert") throw new DocsError("FORBIDDEN_EXPERT", "…");
```

---

## 2. Module structure

Modules grow into slices. The shape that has held up:

```
src/modules/<slug>/
  <Slug>Module.tsx      registry-rendered entry component
  actions.ts            server actions — gate/Zod/withTenant/revalidate
  core/                 pure domain logic. No auth, no I/O, no React
    errors.ts           module error type + friendlyMessage
    types.ts
  components/           client components
  <slice>/              a bounded area (banking/, invoicing/, shares/)
  ai/                   prompt construction + response validation
```

**`core/` is pure.** It takes a `tx` and plain arguments, returns data or
throws a module error. It never calls `requireTenant`, never reads env, never
imports React. That is what makes it testable without a database session and
what keeps the authorization story in one place.

`ai/` splits three ways every time: `*-prompt.ts` builds the prompt (pure),
`*-validate.ts` Zod-parses the response, and the caller orchestrates. Model
output is untrusted input.

---

## 3. Money

Integer cents in JS numbers. Never floats, anywhere, for any reason.

- `parseMoneyToCents()` for user input — returns `null` on anything
  unparseable, negative, over two decimals, or beyond `MAX_AMOUNT_CENTS`.
- `formatCents()` for display.
- `toSafeCents()` for Postgres `bigint` aggregates, which arrive as strings —
  it throws rather than silently losing precision.
- DB columns are `bigint`.
- CSV amounts are built by integer construction, never `toFixed()`.

[src/lib/money.ts](../src/lib/money.ts) is the only place this logic lives. If
you are writing `/100` or `* 100` outside it, stop.

It moved out of `src/modules/accounting/lib/` on 2026-08-04, when CRM needed it
for deal amounts and could not import another module. `src/modules/accounting/lib/money.ts`
is now a re-export kept so the sixty existing callers were not rewritten inside
a feature PR; **import `@/lib/money` in new code.**

---

## 4. Database

- Migrations: `npm run db:generate` for schema, then a **second `--custom`
  migration** for RLS policies. Drizzle does not generate RLS.
- Run every migration against **both** the dev branch and production.
- Migrations go out **ahead of** the deploy, so every one must leave the
  currently running code working (the 0023/0025 outage, in
  [documents.md](modules/documents.md)). **A migration that DROPS a column is
  the one exception and must be applied AFTER the deploy** — drizzle names every
  column of a table in the SELECT it builds, so the old code starts answering
  `column … does not exist` the instant the column goes. Nothing enforces the
  order; what makes it safe is that the wrong way round is loud and the right
  way round is harmless. Say so in the migration's header, as
  `0075_accounting_contacts_contract.sql` and `0221` (livestock's `breed`) both
  do — those two are the only migrations in the repo that run after a deploy.
- **A composite FK cannot take a bare `ON DELETE SET NULL`.** Postgres nulls
  every referencing column, `tenant_id` included, and `tenant_id` is NOT NULL on
  every tenant table — so the delete fails with a not-null violation instead of
  doing what the constraint says. Every composite FK in this schema is
  `(tenant_id, x)`, so this applies to all of them. Three ways out, in the order
  worth considering them: **RESTRICT** (no `onDelete` at all) when the parent is
  a container and re-parenting first is the honest order; **CASCADE** when the
  child is meaningless without the parent; **`ON DELETE SET NULL (x)`**, PG 15's
  column-list form, when the child should survive unparented — which Drizzle
  cannot express (`.onDelete()` takes an action), so it has to be hand-written in
  a `--custom` migration with a comment in the schema file pointing at it. See
  `drizzle/0192` and `production_bookings_run_fk`. **The wrong choice is silent**:
  nothing in `tsc`, lint or `db:generate` can see it, and it only shows up the
  first time something deletes a parent that still has children.
- Indexes on tenant tables lead with `tenant_id`.
- Prefer a `NOT NULL DEFAULT` over a nullable column — `metadata jsonb NOT NULL
  DEFAULT '{}'` means `metadata->>'x'` is always safe.
- Discriminator columns that must be declared at every insert site get **no**
  database default, so `$inferInsert` makes them required. `documents.origin`
  does this deliberately.
- Comment the *why* in `schema.ts`. It is the most-read file in the repo, and
  its comments are load-bearing documentation.

---

## 5. Naming

| Thing | Convention |
| --- | --- |
| Module / pack slug | lowercase kebab, matches `modules.id` and the directory |
| DB tables/columns | `snake_case` |
| TS | `camelCase` values, `PascalCase` types/components |
| Server actions | verb-first, `Action` suffix (`renameFolderAction`) |
| Zod schemas | `PascalCase` (`CreateFolderSchema`) |
| Files | kebab-case (`bill-prompt.ts`); components `PascalCase.tsx` |
| Branches | `claude/<area>-<topic>` |

Do not name anything after an industry. See
[extension-model.md](extension-model.md).

---

## 6. Comments

This codebase's comments carry unusual weight — they are what the next agent
reads to infer intent. The existing standard, which is worth keeping:

- Explain **why**, not what. The diff shows what.
- File-header block comments state the file's job and its invariants.
- Document the trap you just avoided. Comments like *"Forgetting it does not
  open a hole — the GUC defaults to 'staff'"* prevent a future regression.
- Justify every `withSystem()` call at the call site.
- **Do not use industry vocabulary in core comments.** An agent reading
  "a subcontractor sends drawings" in a core file infers that core is a
  construction product and writes accordingly.

---

## 7. Tests

- Vitest. `tests/<area>.test.ts`.
- **`tests/isolation/` is the certification suite** — one file per area over a
  shared `_shared.ts` — and must cover every tenant table: a second tenant
  attempting both read and write, both denied. Add or extend the area's file in
  the same PR that adds the table.
- DB-backed suites require `TEST_DATABASE_URL`;
  `tests/setup/database-guard.ts` replaces `DATABASE_URL` for the run so tests
  physically cannot reach production. Without it suites **skip** — a skipped
  isolation run is not a passing one.
- `core/` logic is tested without a database. Prefer pushing logic there.
- `live-*.test.ts` hit real provider APIs and are not part of the default gate.
- **Two vitest projects.** `pure` runs files in parallel; `db` runs them
  sequentially, because those suites share one Neon branch and several assert
  what is *not* visible across a tenant boundary — an assertion another file
  writing at that moment can break. Which files are which lives in
  `tests/db-backed-files.ts`, and `tests/db-backed-files.test.ts` recomputes it
  from file contents and fails if it drifted. A `d(...)` block added to a
  previously pure file therefore cannot silently start racing; if that guard
  fails, update the list rather than deleting the test.
- **CI runs all of this on every push and PR** (`.github/workflows/ci.yml`), so
  a full local run is not the price of opening a PR. The traps around the test
  database in CI are in [modules/ci-and-tests.md](modules/ci-and-tests.md) —
  read that before changing anything about how tests reach a database.

```bash
npm test
npm run test:isolation   # required before deploy
```

---

## 8. UI

- Server components by default; `"use client"` only where interaction requires.
- **A server component may import COMPONENTS from a `"use client"` module, never
  plain values.** Every export of a client module becomes a client *reference*
  when a server component imports it, so calling an imported helper throws at
  render — and the production error page withholds the message. `npm run build`,
  `tsc` and `eslint` are all green either way, because the import is legal and
  only the server-side call is not. Shared helpers and constants go in a module
  with no directive at the top (`core/`, `src/lib/`). Found the expensive way on
  2026-08-04: `centsToInput` lived in `deal-form.tsx` and took the whole CRM deal
  page down in production.
- **The React Compiler rules are errors here, and each one has caught a real
  bug** (2026-08-08, `claude/lint-clean`) — treat a hit as a defect, not a lint
  nag:
  - `react-hooks/purity` — no reading the clock, randomness or any mutable
    global while rendering. `Date.now()` in a render body means the server
    renders one value and hydration another, and the figure then sits frozen
    until something unrelated re-renders. Put it in state on an interval.
  - `react-hooks/set-state-in-effect` — a `setState` called *synchronously*
    inside an effect cascades an extra render before paint. Schedule it
    (`setTimeout(fn, 0)`, an interval, an event) or adjust state during render
    by comparing against the previous value, which is React's documented way to
    react to a changed prop.
  - `react-hooks/preserve-manual-memoization` — usually means the `useMemo` was
    already useless: a dependency rebuilt every render (an inline array or
    object) can never hit the cache, and only blocks the compiler from
    memoizing properly. Delete it and let the compiler do it.
- shadcn/ui + Tailwind. Check `src/components/ui` before adding a dependency.
- **Compose a primitive from `src/components/app/` before writing a heading,
  empty state or table panel by hand** — `PageHeader`, `EmptyState`, `DataTable`,
  `StatCard`, `FilterPills`, `CategoryStrip`, `Panel`, `SectionRow`. The
  token rules that go with them (`--divider` inside a container vs `--border` at
  its edge, elevation instead of outline, never a literal radius) are in
  [modules/design-system.md](modules/design-system.md); the reasoning is in
  [ADR 0008](decisions/0008-warm-neutrals-and-layered-elevation.md). `src/components/ui`
  stays stock shadcn so it remains upgradeable — app-level composites do not go
  there.
- Modules declare layout needs via `ModuleDefinition.layout`; the shell never
  branches on a module slug.
- Mobile matters — a real share of usage is one-handed, in the field, on a
  phone. Test narrow viewports for anything a non-office user touches.

---

## 9. Next.js

This version has breaking changes from what you likely remember. **Read the
relevant guide in `node_modules/next/dist/docs/` before writing framework-level
code**, and heed deprecation notices. Do not pattern-match from memory of an
older App Router.

### A function may never cross the server/client boundary

**A prop passed from a Server Component to a `"use client"` component must be
serialisable, and a function is not.** Passing one throws *"Functions cannot be
passed directly to Client Components"* at render, which 500s the whole route.
Pass data — a string, a boolean, a pre-computed answer — or a server action.

**THIS IS NOT SOMETHING THE TOOLCHAIN TELLS YOU.** On 2026-08-26 two instances
were live in production at once (`/dashboard/m/land` and
`/dashboard/m/documents/search`), and `tsc`, `eslint` and `npm run build` were
all green with both. The types match — a function IS a valid
`(x) => boolean` — and the error exists only at render, on dynamic routes
nothing prerenders. The land one was gated on `mapped > 0`, so it was invisible
until somebody traced the first paddock boundary and then broke the page for
good.

`tests/server-client-boundary.test.ts` is the backstop: it resolves each JSX
element in a non-client file back to the module it came from and fails if an
inline function is being handed to a client component. **A prop that "obviously
needs" a callback usually wants the answer instead of the question** — the
land fix passes `basePath` and builds the URL client-side; the documents fix
computes `canDelete` per row and sends a boolean.

---

## 10. Definition of done

- [ ] `npm run build` green
- [ ] `npm test` green; `npm run test:isolation` green (not skipped)
- [ ] New tables covered in the isolation suite
- [ ] Migration applied to dev branch **and** production
- [ ] Module dossier build-log entry added ([docs/modules/](modules/))
- [ ] Guide updated for any screen that changed, or written from `_TEMPLATE.md` for a new one ([docs/help/](help/))
- [ ] Security checklist for the surface you touched ([security.md §4](security.md))
- [ ] No industry vocabulary added to Layer 1
