# 0034 — A personal account is a register whose ledger leg is the owner's equity

- **Date:** 2026-09-08
- **Status:** Accepted
- **Affects:** accounting module — `bank_accounts.kind`, `bank_rules.action`, the review queue, the AI sweep, the banking RLS policies (`drizzle/0278`, `0279`)

## Context

Most small farms, and most small businesses converting from a shoebox, do not
have a business bank account. The founder's own farm is the pilot and its
money is mixed with personal: one checking account carries the groceries, the
mortgage, the feed store and the hatchery. The onboarding plan
([docs/modules/onboarding.md](../modules/onboarding.md)) treats this as the
normal case, and the pilot could not be loaded at all until the software had
an answer for it.

The register machinery that exists is built for an account the BUSINESS holds:
its ledger account is a bank asset, its balance is the business's balance, an
opening balance puts that balance on the books, reconciliation proves the
ledger agrees with the statement, and every line that arrives is the
business's until somebody says otherwise. A personal account breaks every one
of those assumptions. Its balance was never the business's; there is nothing
to reconcile against; and most of what arrives is not the business's at all,
so the default has to run the other way.

What an accountant does with a business expense paid from the owner's own
pocket is not in doubt: it is money the owner put in, a credit to owner's
equity, and a business receipt that lands in the owner's own account is money
the owner took out, a debit to the same. The question was only where that
belongs in the software.

## Decision

A **personal account** is a fourth register kind. Its ledger account is an
EQUITY account (subtype `owner_funds`), not a bank asset, so the ordinary
posting — the register on one side, the category on the other — produces the
accountant's entry by itself: a business line paid from it credits the owner's
funds, a business receipt landing in it debits them, and the account's balance
is what the owner has put in net of what they took out. Nothing else about
posting changes.

Three things follow from the balance never being the business's, and are
refused rather than merely unoffered: no opening balance, no reconciliation,
and the account is not a deposit target.

**Personal by default.** Every line on the register is the owner's own until
something says it is the business's. A rule can now say so on arrival
(`bank_rules.action = 'exclude'`, which sets a row aside and posts nothing); the
sweep is told whose account it is looking at, has the prior inverted, may
answer `PERSONAL`, and is shown what was already set aside; and one button sets
aside everything still waiting that nothing has called the business's. Setting
aside teaches the register: three of a payee set aside propose an exclude rule,
the way three hand-codings propose a categorize rule.

**Visible to the owner and the accountant, never to staff.** Row-level
security, not the application: the `bank_accounts` policy hides a personal
register from `staff`, and the `bank_transactions` and `bank_rules` policies
inherit visibility from the register through an `EXISTS`, so there is no second
copy of the rule to drift. The accountant is included because sorting a
client's mixed account is the bookkeeper's job and the register exists to be
sorted; staff are excluded because an employee has no business with the
owner's groceries.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Import the personal account as an ordinary checking register and exclude the personal lines by hand | The farm's balance sheet then carries the owner's personal balance as a business asset, and nothing reconciles. Every line arrives as the business's and must be excluded one by one, which on the pilot is most of a year of one person's spending |
| Do not import the personal account; record the business lines by hand as "paid by owner" journal entries | Correct and hopeless. The statement is the only complete record a converting business has, and re-keying a year of it by hand is the overwhelm the onboarding plan exists to remove |
| One equity account for every personal register ("Owner's personal funds") rather than one per register | Two personal accounts — a spouse's, a card — would fold into one balance and one feed, and the register page could no longer say which account a line arrived on. The chart cost is one account per register, the same as a bank register |
| Post money out to Owner Contributions and money in to Owner Draws | Right on a statement of equity and wrong for a register: a register has one ledger account, and splitting by direction would need a special case in the one posting path everything else shares. The accountant can reclass the net at year end; the register keeps one leg |
| Hide personal rows in the application, leaving the `member_all` policies | AGENTS.md: RLS is the backstop, not the application. One forgotten filter in one page would show staff the owner's spending, silently |
| Hide the register from the accountant too | Then the bookkeeper the platform sells (Tier 3) could not sort the account the register exists to sort, and the completeness question an accountant asks — is any income sitting on the personal side? — could not be answered by looking |
| A `personal` status on the row, separate from `excluded` | Two states meaning "not in the books" with one difference of intent. `excluded` is that state; the register's kind supplies the intent, and the tab, the buttons and the toasts say "personal" where the kind is personal |

## Consequences

What it buys:

- **The pilot can be loaded.** A mixed account is imported whole, the business
  lines are posted, the rest is set aside, and the books carry only the
  business — with owner's equity saying how much of it the owner funded.
- **No new posting path.** `categorizeTransaction` is untouched; the equity
  leg falls out of the register's ledger account. Splits, transfers, matches,
  undo and void all work as they did, because none of them knew the leg was an
  asset.
- **The work shrinks with use.** Exclude rules act on arrival, the sweep is
  biased the right way, and the proposals mean the second month's statement is
  mostly sorted before anybody opens it.
- **The same set-aside machinery serves a business register**, where an
  excluded row is a duplicate or a non-movement; only the words change.

What it costs, honestly:

- **Every read of a register now has to carry the caller's role.** `withTenant`
  defaults to `staff`, under which an owner's own personal register reads as
  empty with no error. Every banking action goes through one helper that passes
  the role, and every banking page passes it; a new reader that forgets will
  show an owner an empty register. The failure is visible, not dangerous, and
  the pattern is written down in the dossier.
- **The ledger account's NAME is visible to staff** in the chart of accounts,
  because `accounts` is member-wide. A register named "Chase personal" tells
  staff that such an account exists, not what is in it. The guide says to name
  it plainly.
- **The `bank_transactions` policy runs a subquery per row.** An index probe on
  the register's primary key; measured against the page's existing per-row
  work it is not what makes it slow, but it is a cost the old flat policy did
  not have.
- **A deposit into the personal account is a draw and is not yet expressible
  as a deposit.** The account is left out of the deposit picker until a deposit
  can say so. Recording the receipt on the register itself works today.
- **An exclude rule cannot carry a payee, memo or auto-post.** There is nothing
  to post, so there is nothing for them to attach to; the CHECK constraint
  holds the shape.

## Notes

The dividing line that made this settle: a register's kind is about whose money
the BALANCE is, not about what the account is at the bank. A joint account, a
sole proprietor's only account and a spouse's card are all "personal" here for
the same reason, and Plaid, which knows what an account is at the bank, is
deliberately never allowed to pick this kind.

What would make us revisit: a business that runs on a personal account for
years and wants the personal side of it in its books after all — a household
budget, in effect. That is a different product, and the answer would be a
second tenant, not a fifth kind.
