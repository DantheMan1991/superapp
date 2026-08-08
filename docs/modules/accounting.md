# Accounting

> Full double-entry accounting for client tenants: ledger, reports, banking
> feeds, invoicing (AR), documents/receipts, payables (AP), and month-end
> close — with AI assist at every capture point. This is the flagship
> module of Phase 2 ("The Outsourced Business Office").
> Status: `available` · Scope: `module`

The flagship pipeline it enables: emailed bill → extracted document →
prefilled bill draft → AI line coding → owner approval (posts to ledger) →
payment → bank-feed match → month-end close with AI narrative → full-books
export for the accountant.

## Build log

### 2026-08-06 — `bookkeeping_timezone` dropped (branch `claude/drop-bookkeeping-timezone`)
- `0088` removes the column deprecated in the entry below. `tenants.timezone` is the only clock; `accounting_settings` no longer carries one
- **Applied AFTER the deploy**, like `0075` and for the same reason: nothing read the value, but Drizzle builds its SELECT column list from `schema.ts`, so a deployment still declaring the column selects it. Dropping under a live old build 500s `getSettings` and every accounting page
- Carries the value up one last time first, but only for a tenant still on the untouched default — an unconditional backfill would overwrite a zone an owner had since set at `/dashboard/settings`

### 2026-08-05 — The books' day boundary moves to the tenant (branch `claude/tenant-timezone`)
- `accounting_settings.bookkeeping_timezone` is **deprecated**. It had no UI and no writer anywhere in `src/`, so every tenant sat on the `America/New_York` default and every accounting "today" was New York's, correct only by luck
- All **21** reads now use `tenants.timezone` (`0086`): pages take `ctx.tenant.timezone`, and `posting.ts` / `recurring.ts` / the books export take `getTenantTimezone(tx, tenantId)` because `LedgerCtx` deliberately carries only an id
- `settings.csv` keeps its `bookkeeping_timezone` **header** — an export is a file somebody's accountant already parses — but the value now follows the tenant. `tests/export.test.ts` sets the two zones differently so the assertion cannot pass by coincidence
- The column is **not dropped this release** (the inverse of `0075`'s ordering): the previous deployment still SELECTs it. A follow-up migration removes it. Full reasoning in [timezone.md](timezone.md)

### 2026-08-04 — `customers.email` / `.phone` retired; the party owns the address (branch `claude/party-contact-points`)
- The four columns were **dropped** (`0075`). `party_contact_points` is the only store now, so the customers page, the CRM record and the mail composer cannot show three answers to one question
- **The forms keep their Email and Phone boxes.** They edit the party's main address of that kind directly — `setPreferredContactValue` renders `preferredContact` and writes back to the same row, so correcting a typo edits one address instead of adding a second, and **an emptied box now deletes it**. That reverses the additive rule from the entry below, deliberately: additive was right for a mirror of a column and wrong for the thing itself. Full reasoning in [crm.md](crm.md)
- **`0075` must be applied AFTER the deploy** — the only migration in the repo that inverts the standing order, because dropping a column breaks the code still selecting it. It re-runs the backfill first (addresses typed into the old form after `0074` ran exist nowhere else) and refuses to drop if anything usable would be lost
- **Five** read sites moved, not the two the entry below predicted: the customers page, the vendors page, `mail/extension.ts` (search, resolve, `{{customer.email}}` and the contact source) and both halves of the books export. Neither dialog component changed — the pages hand them the values. The placeholder key `{{customer.email}}` is unchanged too; renaming it would break every saved template that used it
- `customers.address` and `.notes` STAY. Nothing reads a postal address that they do not serve, and `party_addresses` is deferred rather than forgotten
- The customers and vendors CSVs keep their `email` and `phone` columns, filled from the party. An export is a file somebody's accountant already has a process for

### 2026-08-04 — Customer and vendor addresses now also live on the party (branch `claude/party-contact-points`)
- `party_contact_points` arrived on the shared spine. Existing `customers`/`vendors` email and phone values were backfilled onto their parties, and `createCustomer`/`updateCustomer` (and the vendor equivalents) now contribute them through `@/lib/parties` on every write
- **The sync is ADDITIVE, unlike the name sync.** Clearing `customers.email` does NOT remove a contact point — a name is one fact with an authoritative copy, a way of reaching somebody is one of several. Mirroring would let an invoicing change silently delete a mobile number somebody added in CRM
- **Nothing accounting reads has changed.** `customers.email` / `.phone` / `.address` are untouched and still authoritative for invoicing; this is the expand phase. Retiring them is a later contract slice — only two files read them directly
- An unusable value contributes nothing rather than failing the save it is attached to

### 2026-08-03 — The party spine: customers and vendors became roles (branch `claude/crm-party-spine`)
- `customers` and `vendors` gained `party_id` (composite FK to the new shared `parties` table) and are now ROLE records — "a party we invoice", "a party we pay". No existing foreign key moved: `invoices.customer_id` and `bills.vendor_id` point exactly where they did
- A business that is both a customer and a vendor is now ONE party with two role rows, which neither table could previously state. `UNIQUE (tenant_id, party_id)` on each stops a party taking the same role twice
- `createCustomer`/`createVendor` mint the party in the same transaction via `@/lib/parties` — the single door onto that table; this module never writes `parties` directly. A rename carries onto the party (`syncPartyName`) so the invoice and the CRM cannot disagree about who the customer is
- Deactivating a customer or vendor deliberately does NOT deactivate the party: the same business may still be live in the other role
- Migrations `0059`–`0062`, expand/backfill/contract with compatibility triggers covering the deployed code through the window. **The backfill matched nothing** — one party per existing role row, because fusing on a name would silently merge two real businesses. Full reasoning in [crm.md](crm.md)

### 2026-07-23 — Session 7: Close & accountant tools (`90e8775`, PR #4)
- Expert (accountant) role: memberships-backed overlay on the Clerk role, fail-closed `gate()` across all accounting actions, owner toggle on the Team page
- Month-end close subsystem: `period_closes` + `close_notes`, warn-not-block checklist, monotonic closes with latest-only reopen, sign-off, review notes; `closed_through` became derived state (old trial-balance lock dialog retired)
- Close-narrative AI (auto-runs on close); full-books export as a streaming zip (all-table CSVs, reports, audit trail, document blobs), owner+expert only, 60s cooldown

### 2026-07-23 — Inbox rename + context-aware routing (`516edc5`, `f5bef04`)
- "Capture" tab renamed to **Inbox**; routing buttons on inbox documents are context-aware (bill vs expense vs invoice destinations)

### 2026-07-22 — Email-in & upload production fixes (`8147c2d`)
- Email-in silently dropped mail: forwarding-address tokens were mixed-case base64url but mail infrastructure lowercases local parts (Outlook did). Tokens now lowercase hex (128-bit), parsing case-folds; a real missed bill was replayed and recovered
- Uploads failed on the private blob store: switched to the presigned flow with the same tenant/namespace/allowlist gates; read-write token now passed explicitly in every server-side blob call (SDK otherwise prefers ambient OIDC creds, which fail locally)
- Also (`c59f7a8`): tiny signature-logo email attachments filtered out; tool renamed to "Bills & Receipts"

### 2026-07-22 — Session 6: Payables (`3c39027`)
- `vendors`, `bills` (state machine draft → awaiting_approval → approved → partial → paid / void), `bill_lines` (nullable account until coded; approve enforces), `bill_payments` (atomic entry, CAS-serialized derivation)
- Create-bill-from-document idempotent by link presence; prefill trusts extraction line items only when they sum exactly to the total
- AI line coding (vendor-history few-shot + industry-pack context seam); duplicate detection warns, never blocks
- `ENTRY_SOURCE_MANAGED` guard: invoice/bill entries can no longer be voided from the journal (closed a latent session-4 desync gap)
- AP aging via shared `lib/aging-core.ts` (mirrors AR)

### 2026-07-22 — Session 5: Documents (`c223b25`)
- Two-table split: `documents` (blob, sha256, email provenance, extraction jsonb, inbox/filed/trashed lifecycle) + `document_links` with exactly-one-of composite FKs to entries / bank txns / invoices (bill_id added in session 6)
- Client-direct uploads to private Vercel Blob (token route re-gates tenant + module + namespace + allowlist); authenticated streaming route for reads
- Email-in via Resend inbound: per-tenant bearer-token forwarding address, svix-verified webhook, attachment-level idempotency, hourly rate cap
- Claude vision extraction (auto-runs on arrival, only prefills — never posts); receipt inbox with match-to-bank-txn suggestions
- Soft-delete only, linked docs can't be trashed; unlink-first coordination on all hard-delete paths (P21)

### 2026-07-21 — Session 4: Invoicing / AR (`e86e7f3`, PR #3)
- `customers`, `invoices` (state machine; partial/paid DERIVED from payments, never client-set; race-safe INV-#### numbering), `invoice_lines` (signed unit prices for discounts, integer-math amounts), `invoice_payments` (born atomically with their Dr deposit / Cr AR entry), `recurring_invoices` (monthly templates generate DRAFTS — human approves before AR posts)
- Bank-feed matching closes the double-count trap: staged deposits matching recorded payments get labeled candidates; Match links the feed row to the EXISTING entry, posting nothing
- Voiding any matched entry sends its feed row back to review (P13, shared `resetBankLinkForEntry`)
- A/R aging report; issued invoices freeze lines; unapply blocked when the deposit line is reconciled

### 2026-07-21 — Session 3: Banking (`b1e9370`, PR #2)
- One staging table for both feeds (Plaid + CSV import), hash-dedup; categorization/AI/reconciliation are feed-agnostic
- `bank_accounts` (1:1 with a ledger account), `reconciliations` + `reconciliation_lines` (NO ACTION composite FK = DB backstop for reconciled immutability), `plaid_items` (AES-256-GCM encrypted access tokens)
- Third mutability tier: entries with reconciled lines are immutable — reverse is the only correction path
- First live AI feature: batched categorization suggestions (forced tool_choice, few-shot from tenant history, suggestions never post)
- Fixed in-session: re-categorize after void posts a FRESH entry via per-attempt idempotency keys

### 2026-07-21 — Session 2: Reports (`bfc261a`, PR #1)
- Pure, DB-free report builders: P&L (with prev-period/prev-year and by-dimension columns), Balance Sheet, Cash Activity; CSV export server-recomputed
- Policy set pinned P1–P7: fiscal-year boundaries, computed Retained Earnings with NO closing entries, inclusive dates, posted-only reads, integer cents (zero rounding), natural contra presentation, own-subtype sectioning
- P&L split-by-dimension is the future "P&L by property" seam for industry packs

### 2026-07-21 — Session 1: Core Ledger Platform (`5ce7e65`)
- Schema: `accounts`, `journal_entries`, `journal_lines`, `dimension_members`, `line_dimensions`, `accounting_settings` — FORCE RLS, composite tenant FKs, idempotency + single-reversal partial uniques, optimistic versioning
- DB-enforced invariants: deferrable constraint trigger rejects unbalanced non-draft entries at commit; append-only `audit_log` trigger
- Posting engine (`src/modules/accounting/core`) is the ONLY writer of ledger rows; three-tier mutability policy; period lock; COA service; dimension registry (industry-pack seam)
- `logAuditInTx` writes the audit row in the same transaction as every financial mutation
- 44-account general COA template provisioned idempotently BEFORE module enable

## Data model

| Table | Since | Purpose |
| --- | --- | --- |
| `accounts` | S1 | Chart of accounts, hierarchical |
| `journal_entries` / `journal_lines` | S1 | The ledger; balanced-at-commit trigger |
| `dimension_members` / `line_dimensions` | S1 | Dimension tagging (industry-pack seam); line_dimensions gained invoice_line_id (S4) and bill_line_id (S6) with exactly-one-parent CHECKs |
| `accounting_settings` | S1 | Per-tenant config (fiscal year, etc.) |
| `bank_accounts`, `bank_transactions`, `reconciliations`, `reconciliation_lines`, `plaid_items` | S3 | Feeds, staging, reconciliation; encrypted Plaid tokens |
| `parties` | 2026-08-03 | **Shared, not this module's.** The identity spine behind `customers` and `vendors`; written through `src/lib/parties/`. See [crm.md](crm.md) |
| `customers`, `invoices`, `invoice_lines`, `invoice_payments`, `recurring_invoices` | S4 | AR. `customers.party_id` (2026-08-03) makes the row a role on a party |
| `documents`, `document_links` | S5 | Capture substrate; exactly-one-of link targets |
| `vendors`, `bills`, `bill_lines`, `bill_payments` | S6 | AP. `vendors.party_id` (2026-08-03) makes the row a role on a party |
| `period_closes`, `close_notes` | S7 | Month-end close |

All tables: `tenant_id`, FORCE RLS, covered by `tests/isolation/accounting.test.ts`.

## Key files & seams

- `src/modules/accounting/` — `core/` (posting engine, reports, reconciliation), `banking/`, `invoicing/`, `documents/`, `payables/`, `close/`, `export/`, `ai/` (shared engine pattern), `templates/` (COA)
- Tenant UI under `src/app/dashboard/m/accounting/`
- AI engines all follow the same shape: pure prompt seam + pure validate seam + injectable model call + forced tool_choice + cooldown; suggestions never post — a human accepts

## Decisions & gotchas

- **Three-tier mutability**: draft (free edit) → posted (edit-with-version/void/reverse) → reconciled (immutable; reverse only). The DB backs each tier with triggers/FKs, not just app code.
- **Derived, never stored**: invoice/bill statuses derive from payments; `closed_through` derives from period_closes; Retained Earnings is computed — no closing entries exist.
- **All money is integer cents.** No floats, no division in report math.
- **AI never writes to the ledger.** Every AI feature (categorization, extraction, bill coding, close narrative) only suggests or prefills; a human action posts.
- **Email-in tokens must be lowercase** — mail infra lowercases local parts (found in production, `8147c2d`).
- **Blob store is private** — use the presigned upload flow and pass the RW token explicitly server-side.
- **Managed-source entries** (invoice/bill) can't be voided from the journal; void via their document's lifecycle.

## Open items

- Credit memos (designed-for headroom in S4, unbuilt)
- Recurring-invoice cron (fast-follow; zero schema change needed)
- Industry-pack dimension packs ("P&L by property" seam live but no pack registered yet — Real Estate pack is the planned next build)
