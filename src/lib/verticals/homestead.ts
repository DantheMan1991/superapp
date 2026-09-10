import {
  Beef,
  Calculator,
  ClipboardList,
  Fence,
  Globe,
  PackageCheck,
  Scissors,
  Sprout,
  Store,
  Tractor,
} from "lucide-react";
import type { Vertical } from "./types";

/**
 * Yosher Homestead — the first vertical.
 *
 * **EVERY CLAIM ON THIS PAGE IS BUILT AND SHIPPED.** That is not a style note,
 * it is the rule the page lives by: this is the page a farmer signs up from,
 * and the first thing they will do is look for the feature that brought them.
 * Before adding a line here, check the module's dossier says `built`, not
 * `next`. Three things were deliberately LEFT OFF for exactly that reason and
 * must stay off until their dossiers change:
 *
 *   - **Profit per enterprise as a report.** Costs carry the enterprise
 *     (`enterprises` slices 1–3) but the revenue side is slice 4 and parked,
 *     so the capability below says costs and stops there.
 *   - **Email from the farm's own domain.** The mail stack is live, but SES
 *     production access was refused (2026-09-07) and outbound is sandboxed.
 *   - **Licensed professional review.** The landing page frames it as a
 *     direction, deliberately and with a comment saying why. A vertical page
 *     is a worse place to be loose about it, so it is absent.
 *
 * The nouns come from `src/industries/homestead-farm/index.ts` — paddock, lot,
 * kill sheet, cut sheet, butcher — so the words a farmer reads here are the
 * words they will see on the screens. When that profile renames something,
 * this page is the other half of the change.
 */
export const homestead: Vertical = {
  slug: "homestead",
  name: "Yosher Homestead",
  industry: "homestead-farm",
  summary:
    "Books, herd, ground, butcher and farm store in one place — for homesteads running several enterprises off one bank account.",
  card: {
    icon: Sprout,
    heading: "Homestead farms",
    body: "Beef, broilers, eggs, hay, the garden and the farm store — one set of books and one set of records, in the words a farm actually uses.",
  },
  seo: {
    title: "Yosher Homestead — farm software for direct-selling homesteads",
    description:
      "Herd records, paddocks, the butcher, the freezer and the books in one place — for homesteads running several enterprises off one bank account.",
  },
  sections: [
    {
      kind: "hero",
      eyebrow: "Yosher Homestead",
      heading: "A homestead is eight businesses. It shouldn't take eight spreadsheets.",
      body: "Beef, broilers, eggs, hay, the garden, the farm store. One set of books, one set of records, and one place to look — built for how a homestead actually runs: in the field, at the market, and at the kitchen table after dark.",
      primary: { label: "Get your free farm health check", href: "/health-check" },
      secondary: { label: "See what's included", href: "#what-it-does" },
      note: "No signup, no card, no sales script.",
    },
    {
      kind: "problems",
      eyebrow: "The honest version",
      heading: "You didn't start farming to keep records.",
      body: "Every homestead we've looked at keeps good information. It's just kept in four places, none of which talk, and two of which are a person's memory.",
      items: [
        {
          title: "The notebook in the truck",
          body: "Weights, tag numbers, which paddock, what the feed cost. It's written down somewhere. Somewhere is not a record — and it can't tell you anything in aggregate.",
        },
        {
          title: "The shoebox in February",
          body: "A year of feed tickets, vet bills and market receipts, sorted the week before taxes are due. That information was worth having in June. In February it's just typing.",
        },
        {
          title: "\"Which one actually paid?\"",
          body: "Ask most homesteads whether the broilers made money and you get a feeling, not a figure. The costs are real, and they're spread across four enterprises sharing one bank account.",
        },
        {
          title: "The customer waiting on their half",
          body: "Someone paid a deposit in April, the steer went in on the 12th, and now they want to know when the cut sheet is due and roughly what it'll weigh.",
        },
      ],
    },
    {
      kind: "capabilities",
      id: "what-it-does",
      eyebrow: "What it does",
      heading: "Farm records that are actually farm records.",
      body: "Not a general ledger with a barn photo on the login screen. Every screen uses your words — paddocks, lots, kill sheets, cut sheets, the butcher — because they're the words the software was built around.",
      items: [
        {
          icon: Beef,
          title: "The herd",
          body: "Animals in lots or one at a time. Weights by tape or scale, treatments, who's out of whom, and a breeding calendar that already knows a cow carries 283 days and a sow 114.",
        },
        {
          icon: Fence,
          title: "The ground",
          body: "Your paddocks on your own map. What's grazing where and how long it's been there, structures and water, and a walk-and-navigate mode for the phone in your pocket.",
        },
        {
          icon: Scissors,
          title: "The butcher",
          body: "Book the drop-off, record the kill sheet when it comes back, keep each customer's cut sheet on the run, and match the plant's bill to the animals that actually went.",
        },
        {
          icon: PackageCheck,
          title: "What's in the freezer",
          body: "Packages with real weights, not a guess at a pound. Counts you can walk with a phone, reorder points that say when to book the next batch, and a barcode you can scan.",
        },
        {
          icon: Store,
          title: "The shop",
          body: "Prices per channel — farmers market, farm store, honour system, online — and a till that works at the market. Change a price and it's a new row, so last season's numbers stay true.",
        },
        {
          icon: Calculator,
          title: "The books",
          body: "Invoices, bills, the bank feed, statements and a clean close. Costs land against the enterprise that incurred them, so the feed bill isn't just \"feed\".",
        },
        {
          icon: Globe,
          title: "The farm's website",
          body: "Yosher writes and builds it from your own facts — what you raise, how to order, where to find you. Your price list shows live on the page, and an order arrives in the office as a real customer.",
        },
        {
          icon: ClipboardList,
          title: "Everything else",
          body: "Customers, jobs, documents and the calendar. The parts every business has, without a separate app and a separate password for each one.",
        },
      ],
    },
    {
      kind: "spotlight",
      eyebrow: "One run, end to end",
      heading: "One steer, from the pasture to the freezer.",
      body: "This is the run no general accounting package can follow, because every step is a different kind of record — an animal, a processing run, a customer instruction, a package with a weight, a sale, a bill. Yosher follows it because those all sit on one spine.",
      points: [
        {
          title: "It's a lot in the pasture",
          body: "The steer is on the books as a lot carrying its own cost — the calf, the feed, the minerals, the vet — from the day it arrives.",
        },
        {
          title: "It goes to the butcher",
          body: "A processing run with the drop-off date, the plant and the animals on it. The kill sheet comes back with hanging weight and the fee per head, and the fee follows the meat.",
        },
        {
          title: "The customer's cut sheet",
          body: "Each buyer's instructions sit on the run, where the person ringing the plant can read them.",
        },
        {
          title: "It comes back as packages",
          body: "Not \"beef, 420 lbs\". Ribeye, ground, short ribs — each with a real weight, in the freezer, ready to sell.",
        },
        {
          title: "It sells at the market",
          body: "The till takes the weight and that channel's price, and the packages leave stock as they leave the cooler.",
        },
        {
          title: "The bill matches",
          body: "The plant's invoice lands against the run it belongs to. The cost of that steer is the cost of that steer, not an average across the herd.",
        },
      ],
      footnote:
        "Every step of that is built and running today, and none of it is a spreadsheet you have to maintain.",
    },
    {
      kind: "steps",
      eyebrow: "How it starts",
      heading: "Start where it hurts. Add the rest when it pays for itself.",
      body: null,
      items: [
        {
          icon: ClipboardList,
          title: "Start with the health check",
          body: "About ten questions on how the place actually runs. You get a written picture of where the hours and the money are going — free, and yours to keep whether or not you go further.",
        },
        {
          icon: Sprout,
          title: "Switch on what you need",
          body: "The books and the herd first, most likely. The ground, the butcher, the shop and the website when they earn their place. Nothing you don't use, and no bundle you pay for out of habit.",
        },
        {
          icon: Tractor,
          title: "We fit the last part to you",
          body: "Your breeds, your channels, your cut sheets, your words. And if the thing your place genuinely needs doesn't exist yet, we build it — onto a platform we keep maintained, not as a one-off that rots.",
        },
      ],
    },
    {
      kind: "faq",
      eyebrow: "Straight answers",
      heading: "The questions farmers actually ask.",
      items: [
        {
          question: "Is this for five acres or five hundred?",
          answer:
            "Both, and that's what the layers are for. The core is the same either way; what you switch on isn't. A place with twenty broilers and a market garden turns on far less than one running beef, pigs and a farm store — and pays for less.",
        },
        {
          question: "I already use QuickBooks.",
          answer:
            "Then you already know it has no idea what a paddock is, or a cut sheet, or a lot of forty broilers. Yosher does the books and the farm records in one place, so they stop being two jobs. The accounting side was built and measured against a live QuickBooks company on purpose — we know exactly what we're being compared to.",
        },
        {
          question: "Do I have to put the whole farm in at once?",
          answer:
            "No. Start with the part that hurts. Everything else is a slot you turn on later, and the setup tool takes a paste of a list you already have — customers, vendors, animals, items, opening balances — instead of making you retype it.",
        },
        {
          question: "What about the thousand-bird exemption?",
          answer:
            "The federal poultry producer/grower exemption's head count is a figure the software knows and counts against, and it's editable — states layer their own rules on top, and some are stricter than the federal one.",
        },
        {
          question: "Does it work in the field, with no signal?",
          answer:
            "The screens are built for a phone first — the counts, the weights, the paddock walk — and designed to be worked one-handed with a glove on. Be aware it needs a signal: offline is not something we'll claim before it exists.",
        },
        {
          question: "Who else is running on it?",
          answer:
            "Yosher is early, and we'd rather say so than dress it up. The farm side was designed against a real homestead's operation and a real processor's rate sheet, not a generic template, and the business that operates the platform runs its own books on it. Ask on the health check and we'll be straight about what's proven and what's new.",
        },
        {
          question: "What does it cost?",
          answer:
            "The health check is free and takes no card. Beyond that it depends on what you switch on, which is the only honest answer when the whole model is paying for the slots you use — tell us what you run and we'll put a number on it.",
        },
      ],
    },
    {
      kind: "cta",
      heading: "Find out what the paperwork is actually costing you.",
      body: "About ten questions on the place, the animals and the office. A written health check at the end: what's eating your hours, roughly what that adds up to, and what to fix first. Yours to keep either way.",
      primary: { label: "Start your free health check", href: "/health-check" },
      secondary: { label: "Talk to us", href: "/contact" },
    },
  ],
};
