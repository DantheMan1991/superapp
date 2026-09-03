# Taking payments

> Connecting the account that takes card payments from your customers, what each status on this page means, and the card readers a market stall uses.
> **Route:** /dashboard/settings/payments
> **Order:** 30

This page is about money your customers pay you. What your business pays Yosher is on **Billing**. The description reads `Card payments go straight to your own bank account, in your own name.`

## Which provider you see

Square is the provider on offer. You get a **Square** card for each company in your books. A **Stripe** card appears only for a company that already has a Stripe account connected from before.

If card payments are not switched on for your deployment at all, the page shows one card, **Not available yet**: `Card payments are not switched on for this deployment. Get in touch and we will set it up.`

If your books hold more than one company, each card is titled with the company's name, for example `Square · Oak Row LLC`, and each company connects its own account. One Square account can be connected to one company only.

## The Square card

The card shows a badge, a sentence explaining it, and buttons. The badge is one of:

- **Not connected.** `Connect the Square account this business already takes cards with. Yosher never sees a card number and never holds your money.`
- **Connected.** Square is connected and can take a card. If your Square account has several locations, the sentence says how many can take a card, and a **Locations** list shows each one, whether it is on the move or at a fixed address, and whether it takes cards. The main location is marked `the till charges here`.
- **Checking with Square.** `Connected. Square hasn't confirmed card processing yet — this refreshes each time you open the page.`
- **Square isn't ready.** Square is connected but will not take a card yet. A box headed **Before Square will take a card** tells you what to finish in your Square dashboard.
- **Needs reconnecting.** Square stopped accepting Yosher's access. Nothing is lost; connect again.
- **Disconnected.** You or Square withdrew the connection.

**Connect Square** sends you to Square to sign in and approve Yosher. When you come back, a green banner reads `Square is connected. What you see below is what Square said just now, not what the redirect claimed.` If it did not work, an amber banner says why, for example `Square access was declined, so nothing was connected.` or `That Square account is already connected to another of your companies.`

The other buttons: **Open your Square dashboard**; **Check with Square again**, which asks Square for its latest answer; and **Disconnect Square**, which asks you to confirm and then shows `Square disconnected.`

Under the cards: `Square handles the card, its fee and the payout, in your business's name — Yosher never holds your funds and never sees a card number. What Yosher holds is a permission to act for your Square account, which you can withdraw here or from your Square dashboard at any time.`

## The Stripe card

Shown only for a company that already has a Stripe account. Its badge is one of:

- **Not connected.** `Connect a Stripe account and card payments go straight to your own bank. Stripe asks for your business details and a bank account; it takes about ten minutes.`
- **Needs information.** Stripe needs details before this company can take a card. A box headed **Stripe still needs** lists them in plain words, for example `A bank account for Stripe to pay into` or `The business tax ID (EIN)`. If Stripe has set a deadline, a line reads `Needed by [date], or Stripe stops accepting payments on this account.`
- **Stripe is reviewing.** Everything asked for has been sent. Stripe usually confirms within a day or two.
- **Payouts on hold.** Cards work, but Stripe is holding the money until it has what is listed.
- **Ready to take payments.** `Card payments and payouts are both working. Money from a card goes to your own bank account.`
- **Not available.** Stripe does not support card payments for this business, country or kind of entity. The sentence says which.
- **Disconnected.** The account is no longer connected to Yosher.

**Set up card payments** or **Continue Stripe setup** opens Stripe's own form, where your business details, tax ID and bank account are entered. Stripe saves what you have entered if you stop part way. A setup link only lasts a few minutes; if it expired, a banner says so and you start the button again. **Open your Stripe dashboard** and **Check with Stripe again** do what they say. There is no disconnect for Stripe.

The page reads Stripe's status when you open it. `This page updates itself when it finishes` means when you next open it.

## Card readers

A Stripe company that is connected can register card readers. The section is headed **Card readers**. Before any exist it reads `No readers yet. A reader is the card machine a customer taps — add one and it can take payments at a stall.`

**Add a reader.** Give it a name in **What to call it**, for example `Front table`, and enter the **Pairing code** shown on the reader's own screen. The code expires after a few minutes, so fetch it just before you add the device. For the first reader of a company, Stripe also needs the street address, city, state and ZIP where the reader is used. Click **Add reader**. You see `Reader added`.

Each reader shows its name and whether it is `online` or `offline`. Its buttons:

- **Take a payment** opens a panel. Type the **Amount** and click **Charge this card**. The customer taps their card on the reader. The status line goes from `Waiting for the customer to tap` through `Processing…` to `Paid`. **Check** asks for the latest status and **Cancel** stops the payment.
- **Rename** changes the name in place.
- **Retire** asks you to confirm: `It stops being able to take payments and disappears from the till. Payments it already took are unaffected. You can add it again with a fresh pairing code.`

A payment taken from this panel is recorded in Stripe, not yet in your books in Yosher.
