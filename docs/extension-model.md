# The extension model — core tools, capability packs, industry profiles

> **Read before:** adding anything to a core module, starting an industry
> feature, or tailoring something for one client. If you are about to type the
> word "construction" into `src/modules/`, stop and read §3.
> **Update when:** a new extension primitive is added, a pack boundary moves, or
> a neutrality violation is found or fixed.

This file exists because of one recurring failure: industry-specific concepts
keep landing inside the core tools. Section 8 lists the ones currently in the
tree. Everything before it is the model that prevents new ones.

---

## 1. The layers

```
Layer 0   Platform shell        tenancy, auth, billing, RLS, module registry
                                 ↑ knows nothing about business domains
Layer 1   Core tools            accounting · documents · email · (CRM …)
                                 ↑ universal business truth. Industry-blind.
Layer 2a  Capability packs      jobs · dispatch · estimating · permits …
                                 ↑ real code + tables. ALSO industry-blind.
Layer 2b  Industry profiles     plumbing · electrical · general-contractor
                                 ↑ manifests. NO code. Lists packs + supplies
                                   vocabulary, seed data, defaults.
Layer 3   Tenant configuration  one company's tailoring. Data only, never code.
```

**The important claim is that Layer 2 is two things, not one.** Most of the
duplication problem comes from treating "the plumbing module" as a single unit
that owns features. It doesn't own anything. It is a *list*.

---

## 2. Why this answers "how do plumbing and electrical share add-ons?"

They share because they both **reference the same capability pack**, not because
one inherits from the other and not because the code is copied.

| Capability pack (built once) | plumbing | electrical | general-contractor |
| --- | :---: | :---: | :---: |
| `jobs` | ● | ● | ● |
| `dispatch` | ● | ● | |
| `estimating` | ● | ● | ● |
| `permits` | ● | ● | ● |
| `service-agreements` | ● | | |
| `certified-payroll` | | ● | ● |
| `drawings` | | | ● |

`jobs` is written once. Plumbing and electrical both list it. When you fix a bug
in `jobs`, it is fixed for every industry, forever. There is no plumbing copy to
keep in sync, because there is no plumbing copy.

A capability only ever appears in one column when it is genuinely a different
capability — `service-agreements` (recurring maintenance contracts) is not a
variant of anything electrical contractors use, so it is its own pack that only
plumbing's profile lists.

### The rule that makes it work

> **A capability pack must never know which industry it is running in.**

No `if (industry === "plumbing")`. Not once. The moment a pack branches on
industry, it has become two half-packs sharing a file, and you are back to
maintaining duplicates with extra steps.

Industry differences are expressed in exactly three ways, in order of
preference:

1. **Configuration** — the profile supplies a value. Default markup, units,
   which fields are required, tax treatment.
2. **An extension point** — the pack declares a named slot and something else
   fills it. `estimating` declares `lineItemFields`; a profile or another pack
   contributes.
3. **A separate pack** — the difference is large enough to be its own
   capability, composed alongside.

Forking `estimating-plumbing` is never on the list.

### Naming is load-bearing

Call it "the plumbing module" and you will build plumbing things inside it —
the name grants permission. Call it "the `jobs` pack, listed by the plumbing
profile" and the same mistake reads as obviously wrong. Use the second phrasing
in code, in commits, and in conversation.

---

## 3. The neutrality test

Before putting anything in Layer 1, ask:

> Would a **bookkeeping firm**, a **dental practice**, and a **plumbing
> contractor** all recognise this as their own?

Three deliberately unrelated businesses. If any of them would find it strange,
it does not belong in core.

Worked examples:

| Thing | Verdict |
| --- | --- |
| An invoice with line items | ✅ Core. All three send invoices. |
| A folder tree with permissions | ✅ Core. All three file documents. |
| A folder named "Insurance & Bonds" | ❌ Pack. The dentist has no bonds. |
| A document with a `doc_kind` string | ✅ Core — the *column* is neutral. |
| `doc_kind = "submittal"` | ✅ Pack — the *value* is supplied by a pack. |
| Chart of accounts structure | ✅ Core. Double-entry is universal. |
| "Subcontractor Expense" account | ❌ Pack. |
| A thread linked to an entity | ✅ Core. |
| A thread linked to an **RFI** | ✅ Pack registers the entity type. |

Notice the pattern: **core owns the mechanism, packs own the vocabulary.** A
neutral column with an open value set is almost always the right shape.

### The honest tradeoff

The founder's actual market is contractors. Strict neutrality means a new
contractor tenant needs the trades profile installed before the product feels
tailored — slightly more work than welding "Jobs" into the default folder list.

Take that cost. It is small and one-time. The alternative is that the first
dental client, or the first bookkeeping client, requires unpicking industry
assumptions from four core modules — and that cost is neither small nor
one-time. Ship contractor-friendly *defaults*, just ship them **from a pack**.

---

## 4. Extension primitives

Five sanctioned ways for a pack to extend core without core knowing it exists.
Three already exist in the schema; use them rather than inventing a fourth.

**P1 — Open taxonomy columns.** A free-text classifier on a core row, with no
check constraint on its values. Core stores and filters; packs define meaning.
Already in use: `documents.doc_kind` — *"Open taxonomy for industry packs
('drawing', 'permit', 'submittal')"* ([documents.ts:101](../src/db/schema/documents.ts:101)).

**P2 — Extension metadata bags.** A `NOT NULL DEFAULT '{}'` jsonb column so
`metadata->>'x'` is always safe. Already in use: `documents.metadata`, and
`mail_annotations` — one row per extension per thread, so a pack can be
reprocessed or removed without touching another pack's work.

**P3 — Link tables carrying `extension_slug`.** `mail_links` is the model:
`entity_type` deliberately carries **no** check constraint on its values (only
a format check), so a pack registers its own linkable types without a migration
to core. An uninstalled pack's links are simply ignored.

**P4 — Pack-owned tables.** A pack may own tables outright (`job_*`). Same
rules as any other table — `tenant_id`, FORCE RLS, isolation test. See
[security.md §4](security.md).

**P5 — Declared extension points.** A core module or pack names a slot; others
fill it. This is the one that does not exist yet and will be needed first for
nav contributions and entity-type registration.

What is **not** sanctioned: adding a column to a core table for one industry,
branching on `tenant.industry` inside core, or a pack reading another pack's
tables directly.

---

## 5. Shapes to build

Not yet implemented. Recorded here so the first pack does not improvise.

> **Since 2026-08-13 there is a concrete plan.** The mechanism — how a pack is
> registered and switched on, how a profile installs one — is settled in
> [ADR 0009](decisions/0009-packs-are-modules-profiles-install-them.md) and
> written up in [modules/packs-and-profiles.md](modules/packs-and-profiles.md).
> The first profile is [modules/homestead-farm.md](modules/homestead-farm.md).
> This section stays as the statement of intent; those are the build record.

```
src/modules/      Layer 1 — core tools. Industry-blind.
src/packs/        Layer 2a — capability packs. Also industry-blind.
  jobs/
  dispatch/
  estimating/
src/industries/   Layer 2b — profiles. Manifests only, no components.
  plumbing.ts
  electrical.ts
```

A profile is data:

```ts
export interface IndustryProfile {
  slug: string;                    // "plumbing"
  name: string;                    // "Plumbing contractor"
  packs: string[];                 // ["jobs", "dispatch", "estimating", ...]
  /** Vocabulary overrides. Core renders labels through these. */
  labels: Record<string, string>;  // { job: "Service Call" }
  /** Seed data contributed on install: folders, accounts, doc kinds, templates. */
  seed: {
    folders?: DefaultFolder[];
    accounts?: CoaSeedRow[];
    docKinds?: string[];
    documentTemplates?: string[];
  };
  /** Config handed to packs. Packs read their own key; never the profile slug. */
  packConfig: Record<string, unknown>;
}
```

Sharing between profiles is by **spreading a constant**, not by inheritance:

```ts
const TRADE_BASE = ["jobs", "dispatch", "estimating", "permits"] as const;

export const plumbing: IndustryProfile = {
  packs: [...TRADE_BASE, "service-agreements"],
  labels: { job: "Service Call" },
  // ...
};
```

Flat and resolvable by reading one file. No inheritance chain, no diamond, no
"which ancestor set this" archaeology.

### Vocabulary is data, not code

Plumbing says "Service Call", electrical says "Job", a GC says "Project". That
is **one table, one code path, three label packs** — not three features. Most
apparent industry duplication dissolves once labels are data, so reach for this
before anything else.

### Layer 3 — one company's tailoring

`tenant_modules.config` (jsonb) already exists and is the right home. Per-client
differences live in config and data, **never in forked code**. If a client needs
something code-shaped, it becomes a config option or a pack. A per-tenant branch
in code is the one outcome this whole model exists to prevent.

---

## 6. Building a pack

1. Confirm it fails the §3 neutrality test — otherwise it belongs in core.
2. Confirm no existing pack covers it. Prefer config or an extension point over
   a new pack; prefer a new pack over any fork.
3. `src/packs/<slug>/`. Tables get `tenant_id` + FORCE RLS + a `--custom`
   migration + isolation-test coverage ([security.md §4](security.md)).
4. Extend core through P1–P5 only.
5. Register in the profiles that need it — nothing else changes.
6. Dossier at `docs/modules/<slug>.md` from `_TEMPLATE.md`.
7. Grep your own diff for industry nouns. If the pack names an industry, the
   boundary is wrong.

---

## 7. Review questions

For any PR touching Layer 1:

- Does this pass the bookkeeper / dentist / plumber test?
- Is an industry noun appearing in a core file — including comments, labels,
  seed data and AI prompt text?
- Is a new value being constrained where it should be open (P1)?
- Could this be a label instead of a feature?

For any PR touching Layer 2a:

- Does the pack name an industry anywhere?
- Would a second industry adopting this pack need to change its code? If yes,
  the difference belongs in config or an extension point.

---

## 8. Known violations in core today

Found 2026-07-27 by auditing `src/modules/` for industry vocabulary. These are
**pre-existing**, not regressions, and are listed so the cleanup is scoped
rather than rediscovered. Nothing here is a security issue.

**Data leakage — industry-flavoured content shipped by core:**

| Where | What | Fix |
| --- | --- | --- |
| [templates/defaults.ts](../src/modules/documents/templates/defaults.ts) | `DEFAULT_FOLDERS` = Jobs · Insurance & Bonds · Licenses & Permits · Safety · Equipment · Suppliers | Move to a `trades` profile. Core ships a minimal neutral set. |
| [templates/general.ts:61](../src/modules/accounting/templates/general.ts:61) | `"5100" Subcontractor Expense` in the *general* chart of accounts | Move to trades profile seed. The file's own comment already says packs ship their own. |
| [templates/page.tsx:17](../src/app/dashboard/m/documents/templates/page.tsx:17) · [documents.ts:538](../src/db/schema/documents.ts:538) | Document templates described as "lien waiver, change order, subcontract" | Core describes the mechanism; the pack ships those templates. |
| [ai/bill-prompt.ts:33](../src/modules/accounting/ai/bill-prompt.ts:33) | Coding prompt infers "from the vendor's **trade**", examples are lumber yards | Prompt vocabulary should come from profile config. |
| [new-client-form.tsx:28](../src/app/admin/clients/new/new-client-form.tsx:28) | Industry selector **defaults** to `"construction"` | Default to `general`. A defaulted industry is an assumption. |

**Vocabulary leakage — comments and UI copy that train the next agent toward
construction** (mild individually, corrosive together): subcontractor framing in
[documents/inbound.ts:15](../src/modules/documents/inbound.ts:15),
[folder-controls.tsx:310](../src/app/dashboard/m/documents/browse/folder-controls.tsx:310),
[documents/inbox/page.tsx:24](../src/app/dashboard/m/documents/inbox/page.tsx:24),
and "takeoff" in [file-viewer.tsx:177](../src/modules/documents/components/file-viewer.tsx:177).

Rewrite opportunistically when touching those files. This is the leak that
matters most in an agent-built codebase: an agent reads nearby comments to infer
what the product is, so construction framing in core reliably produces more
construction code in core.

**Fixed 2026-07-27:** the job-site framing in `app-shell.tsx` (rewritten while
adding the full-width layout seam), and the Mail module's seeded description,
which first read *"threads beside the job, the drawing set and the invoice"*.
That one is worth keeping as the worked example of how subtle this gets: the
founder caught "drawing set" immediately, but the corrected version still said
*"the job"* — which reads as neutral until §5 reminds you that "Job" is
precisely what electrical calls its work while plumbing calls it a Service Call
and a GC calls it a Project. **A word can fail the §3 test while sounding
generic.** The live copy is now "customer, invoice or record".

**Counter-example — core doing it right:** `mail_links.entity_type` carries no
value constraint, with the reasoning written into the schema
([mail.ts:531](../src/db/schema/mail.ts:531)); `documents.doc_kind` is an explicitly
open taxonomy; `documents.metadata` is a pack extension bag. The newest code
already reaches for the right primitive — this model names what it was doing.
