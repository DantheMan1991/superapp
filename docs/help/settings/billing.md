# Billing

> Your subscription to Yosher: which plan you are on, how to subscribe, and where your invoices, card and cancellation are handled.
> **Route:** /dashboard/billing
> **Order:** 20

This page is about what your business pays Yosher. Card payments from your own customers are a different page, **Taking payments**.

## Current subscription

The card **Current subscription** shows a status badge, your plan name beside it, and a line of text.

The badge is one of **None**, **Active**, **Trialing**, **Past due**, **Canceled** or **Incomplete**. The plan name is **Operations** or **Business Office**. A second badge, `cancels at period end`, appears when the subscription has been set to stop at the end of the current period.

With a subscription the text reads `Renews [date]. Payment methods, invoices, and cancellation are handled securely by Stripe.` and the card has a **Manage in Stripe portal** button. Without one it reads `No active subscription yet. Pick a plan below to get started.`

The status is read fresh from Stripe every time you open this page.

## Choosing a plan

When you have no subscription, two cards appear:

- **Operations.** `Platform access, your active modules, maintenance, on-call.`
- **Business Office.** `Everything in Operations plus the expert layer — books reviewed, contracts checked, marketing running.`

Click **Subscribe to Operations** or **Subscribe to Business Office**. The button reads `Redirecting…` and takes you to a secure checkout page run by Stripe. The price is shown there, there is a box for a promotion code, and your card is taken there. If your business is still being onboarded, a one-time onboarding fee appears on that page as a second line.

When the payment goes through you come back here with a green banner: `Payment set up — your subscription is active (it can take a few seconds to reflect here).` If the status has not changed yet, reload the page. Closing the checkout without paying simply brings you back to this page.

## Managing the subscription

Click **Manage in Stripe portal**. It reads `Opening…` and takes you to Stripe's billing portal for your business. That is where you change the card on file, download invoices and receipts, and cancel. When you are done, the portal brings you back here.

If you have not subscribed yet, the button says `No billing account yet — subscribe first.`

## Extra hours

A line under the card reads `Need extra hands-on hours this month? Buy hour blocks on the Hours page.` Hour blocks are bought there, not here.

The foot of the page reminds you: `Payments are processed by Stripe. Card details never touch our servers.`
