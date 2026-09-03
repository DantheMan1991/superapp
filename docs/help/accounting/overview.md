# Accounting at a glance

> Double-entry books for your business: the Overview page, the accounting menu, how a bill or an invoice moves through the books, and who can do what. Each page has its own guide.
> **Route:** /dashboard/m/accounting/**
> **Order:** 0

Open **Accounting** in the sidebar. The Overview shows the state of the books on nine cards, and the accounting menu under the title takes you to every other page. To write a journal entry from here, click {button:New entry|primary}.

## What you see

- **The line under the title.** `Double-entry books for [your business].`
- **`Ledger health`.** `In balance` in green, or `Out of balance` in red. Every posted entry's debits must equal its credits, and the check is made for each company on its own.
- **`Companies`.** How many sets of books you keep. With one it reads `One set of books. Add another for a second LLC.` This card is the only way to the Companies page.
- **`Active accounts`.** How many accounts are in your chart. Click it to open Chart of Accounts.
- **`Posted entries`.** How many journal entries are posted, with `2 drafts · 1 void` under it.
- **`Accounts receivable`.** What customers owe you on open invoices. Click it to open the A/R aging report.
- **`Bank feed`.** How many bank transactions are waiting for review. Click it to open Banking.
- **`Accounts payable`.** What you owe vendors on approved bills. When bills are waiting for approval, the line under it says so, `3 bills awaiting approval`. Click it to open Bills.
- **`Inbox`.** How many documents are waiting to be filed. Click it to open the Inbox.
- **`Books closed through`.** The last month closed, or a dash while any company is still open. Click it to open Close.
- **The accounting menu.** A row of tabs under the title on every accounting page. On a narrow screen it scrolls sideways, with arrows at whichever end has more to show. `Overview`, this page. `Banking`, your bank and card accounts, their transactions, imports, rules and reconciliation. `Inbox`, where bills and receipts arrive, uploaded or emailed, read automatically and routed to your books. `Sales`, invoices, customers, reminders and your catalogue. `Purchases`, bills and vendors. `Chart of Accounts`, the accounts your books are kept in. `Journal`, every entry in the ledger, and hand-written ones. `Recurring`, journals, bills and invoices that repeat every month on their own. `Reports`, profit and loss, balance sheet, cash activity, general ledger, aging, sales tax. `Trial Balance`, every account's balance on one page. `Close`, month-end: the checklist, the lock, and the export for your accountant.

Everyone sees the same Overview. What differs by role is what you can do on the pages behind it.

## How money moves through the books

1. **Money out.** A bill arrives in the Inbox, by upload or by email. Yosher reads it and {button:Create bill|primary} turns it into a draft with the document attached.
2. The draft is checked and, if you are staff, submitted for approval. An owner approves it, which posts it to the ledger.
3. When it is paid, the owner records the payment against it. When the bank feed shows the money leaving, the transaction is matched. At month end the month is closed.
4. **Money in.** An invoice is written and issued, which posts it. It is sent to the customer by email with a PDF, and reminders can chase it.
5. When the money arrives, the payment is recorded against it and the bank feed matches the deposit.

Nothing reaches the ledger by itself. Yosher's assistant reads documents and suggests accounts, but a person saves every draft and an owner posts every entry. A bank rule an owner wrote down can post on its own, because a rule is a decision, not a guess.

## How companies work

Most businesses keep one set of books. A business that runs more than one company keeps a set for each. Once there are two, a `Company` picker appears on the list pages and on reports, so a list can show one company or `All companies`, and a bill or an invoice is created in one company and stays there. Paying one company's bill from another company's account is recorded on both sides, and the page says so before you do it.

## Who can do what

- **Owners** do everything: approve and post, record payments, void, close months, and change the chart.
- **Staff** record bills and invoices as drafts, submit bills for approval, manage vendors and customers, and work the bank feed. They do not approve, post, pay or void.
- **Your accountant**, given accountant access on the Team page, can read every page, review and sign off a close, and export the books. Anything that would change the books answers `Accountant access is read-only — reviews, sign-offs and exports only.` The buttons are still shown; the answer comes when one is pressed.
