# Taking payments

> Connecting the account that takes card payments from your customers, what each status on this page means, and the card readers a market stall uses.
> **Route:** /dashboard/settings/payments
> **Order:** 30

Open **Taking payments** under `Settings` in the sidebar. Owners only. This page is about money your customers pay you. What your business pays Yosher is on **Billing**. The page reads `Card payments go straight to your own bank account, in your own name.`

## What you see

- **One card per provider and company.** Square is the provider on offer, so you get a `Square` card for each company in your books. A `Stripe` card appears only for a company that already has a Stripe account connected from before. With more than one company, each card is titled with the company's name, such as `Square · Oak Row LLC`, and each company connects its own account. One Square account can be connected to one company only.
- **`Not available yet`.** If card payments are not switched on for your deployment at all, this is the only card: `Card payments are not switched on for this deployment. Get in touch and we will set it up.`
- **The Square card.** A status word, a sentence explaining it, and the buttons {button:Connect Square|primary}, {button:Open your Square dashboard|outline|external-link}, {button:Check with Square again|ghost} and {button:Disconnect Square|ghost}, as the status allows. The statuses:
  - `Not connected`. `Connect the Square account this business already takes cards with. Yosher never sees a card number and never holds your money.`
  - `Connected`. Square can take a card. If your Square account has several locations, the sentence says how many can take a card, and a `Locations` list shows each one, whether it is on the move or at a fixed address, and whether it takes cards. The main location is marked `the till charges here`.
  - `Checking with Square`. `Connected. Square hasn't confirmed card processing yet — this refreshes each time you open the page.`
  - `Square isn't ready`. Square is connected but will not take a card yet. A box headed `Before Square will take a card` says what to finish in your Square dashboard.
  - `Needs reconnecting`. Square stopped accepting Yosher's access. Nothing is lost. Connect again.
  - `Disconnected`. You or Square withdrew the connection.
- **Under the cards.** `Square handles the card, its fee and the payout, in your business's name — Yosher never holds your funds and never sees a card number. What Yosher holds is a permission to act for your Square account, which you can withdraw here or from your Square dashboard at any time.`
- **The Stripe card.** Only for a company that already has a Stripe account. Its statuses: `Not connected`, `Needs information` with a box headed `Stripe still needs` listing what in plain words, such as `A bank account for Stripe to pay into`, and a deadline when Stripe has set one, `Needed by [date], or Stripe stops accepting payments on this account.`; `Stripe is reviewing`; `Payouts on hold`, meaning cards work but Stripe is holding the money until it has what is listed; `Ready to take payments`; `Not available`, when Stripe does not support this business, country or kind of entity; and `Disconnected`. Its buttons: {button:Set up card payments|primary} or {button:Continue Stripe setup|primary}, {button:Open your Stripe dashboard|outline|external-link}, and {button:Check with Stripe again|ghost}. There is no disconnect for Stripe.
- **`Card readers`.** For a Stripe company that is connected. Before any exist: `No readers yet. A reader is the card machine a customer taps — add one and it can take payments at a stall.` Each reader shows its name and {badge:online|success} or {badge:offline|secondary}, with {button:Take a payment|outline}, {button:Rename|outline} and {button:Retire|outline}.

## How to connect Square

1. Click {button:Connect Square|primary}. You go to Square to sign in and approve Yosher.
2. Come back. A green banner reads `Square is connected. What you see below is what Square said just now, not what the redirect claimed.` If it did not work, an amber banner says why, such as `Square access was declined, so nothing was connected.` or `That Square account is already connected to another of your companies.`
3. If the status is `Checking with Square` or `Square isn't ready`, finish what the card lists in your Square dashboard, then click {button:Check with Square again|ghost}. It reads `Checking…` and shows Square's latest answer.

To disconnect, click {button:Disconnect Square|ghost} and confirm. You see `Square disconnected.`

## How to finish Stripe setup

1. Click {button:Set up card payments|primary}, or {button:Continue Stripe setup|primary} when Stripe still needs information. It reads `Opening Stripe…` and opens Stripe's own form.
2. Enter your business details, tax ID and bank account there. Stripe saves what you have entered if you stop part way. A setup link only lasts a few minutes; if it expired, a banner says so and you start the button again.
3. Come back and click {button:Check with Stripe again|ghost}. The page reads Stripe's status when you open it; `This page updates itself when it finishes` means when you next open it.

## How to add a card reader

1. Click {button:Add a reader|ghost}.
2. Give it a name in `What to call it`, such as `Front table`, and type the `Pairing code` shown on the reader's own screen. The code expires after a few minutes, so fetch it just before you add the device. For the first reader of a company, Stripe also needs the street address, city, state and ZIP where the reader is used.
3. Click {button:Add reader|primary}. You see `Reader added`.

## How to take a payment on a reader

1. Click {button:Take a payment|outline} on the reader's row.
2. Type the `Amount` and click {button:Charge this card|primary}. It reads `Sending to reader…`.
3. The customer taps their card. The status line goes from `Waiting for the customer to tap` through `Processing…` to `Paid`. {button:Check|outline} asks for the latest status. {button:Cancel|outline} stops the payment.

A payment taken here is recorded in Stripe, not yet in your books in Yosher.

## How to rename or retire a reader

1. Click {button:Rename|outline}, change the name in place, and click {button:Save|primary}.
2. Click {button:Retire|outline} to stop a reader. The dialog reads `It stops being able to take payments and disappears from the till. Payments it already took are unaffected. You can add it again with a fresh pairing code.`

## Messages

| Message | What it means |
| --- | --- |
| `Card payments are not switched on for this deployment. Get in touch and we will set it up.` | Neither provider is enabled for your deployment. Ask us. |
| `Square access was declined, so nothing was connected.` | You did not approve Yosher at Square. Click {button:Connect Square|primary} again. |
| `That Square account is already connected to another of your companies.` | One Square account connects to one company. Use a different Square account for this company. |
| `Needed by [date], or Stripe stops accepting payments on this account.` | Stripe has set a deadline for the information it listed. |

## Not on this page

A payment taken on a reader is not yet recorded in your books. There is no disconnect for a Stripe account. Ask us for either.

## Who can do what

Only owners see this page.
