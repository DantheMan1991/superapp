# Billing

> Your subscription to Yosher: which plan you are on, how to subscribe, and where your invoices, card and cancellation are handled.
> **Route:** /dashboard/billing
> **Order:** 20

Open **Billing** under `Settings` in the sidebar. Owners only. This page is about what your business pays Yosher. Card payments from your own customers are on **Taking payments**.

## What you see

- **`Current subscription`.** A status badge, your plan name beside it, and a line of text. The badge is {badge:None|secondary}, {badge:Active|success}, {badge:Trialing|secondary}, {badge:Past due|destructive}, {badge:Canceled|destructive} or {badge:Incomplete|warning}. The plan is `Operations` or `Business Office`. A second badge, {badge:cancels at period end|outline}, appears when the subscription has been set to stop at the end of the current period. With a subscription the text reads `Renews [date]. Payment methods, invoices, and cancellation are handled securely by Stripe.` and the card carries {button:Manage in Stripe portal|secondary}. Without one it reads `No active subscription yet. Pick a plan below to get started.` The status is read fresh from Stripe every time you open the page.
- **The two plans.** Shown while you have no subscription. `Operations`: `Platform access, your active modules, maintenance, on-call.` `Business Office`: `Everything in Operations plus the expert layer — books reviewed, contracts checked, marketing running.` Each card ends in {button:Subscribe to Operations|primary} or {button:Subscribe to Business Office|primary}.
- **The line about extra hours.** `Need extra hands-on hours this month? Buy hour blocks on the Hours page.` Hour blocks are bought on Hours, not here.
- **The foot of the page.** `Payments are processed by Stripe. Card details never touch our servers.`

## How to subscribe

1. Click {button:Subscribe to Operations|primary} or {button:Subscribe to Business Office|primary}. The button reads `Redirecting…`.
2. You land on a secure checkout page run by Stripe. The price is shown there, there is a box for a promotion code, and your card is taken there. If your business is still being onboarded, a one-time onboarding fee appears as a second line.
3. Pay. You come back here with a green banner: `Payment set up — your subscription is active (it can take a few seconds to reflect here).` If the status has not changed yet, reload the page. Closing the checkout without paying brings you back here with nothing changed.

## How to change your card, download an invoice, or cancel

1. Click {button:Manage in Stripe portal|secondary}. It reads `Opening…` and takes you to Stripe's billing portal for your business.
2. Change the card on file, download invoices and receipts, or cancel there. When you are done, the portal brings you back here.

## Messages

| Message | What it means |
| --- | --- |
| `No active subscription yet. Pick a plan below to get started.` | Your business has not subscribed. Choose a plan. |
| `No billing account yet — subscribe first.` | The portal button was pressed before any subscription exists. Subscribe first. |
| `Payment set up — your subscription is active (it can take a few seconds to reflect here).` | The checkout went through. Reload if the badge has not changed yet. |

## Not on this page

Extra retainer hours are bought on the Hours page. Card payments from your customers are set up on Taking payments.

## Who can do what

Only owners see this page.
