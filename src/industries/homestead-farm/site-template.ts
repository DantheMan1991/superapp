import type { SiteTemplate } from "@/lib/site-templates/types";

/**
 * The homestead farm's website (Marketing slice 15, ADR 0030): five pages
 * a family-scale farm that sells direct needs, in the order a visitor
 * looks for them — what you raise, how to buy it, come and see, who you
 * are, how to reach you — with the pack's price list and the calendar's
 * bookings and events where the tenant has them.
 *
 * DATA, never a component (the industry layer's rule). The starter words
 * read on their own and are true of a homestead farm as a kind; the writer
 * rewrites every one of them from the brief, and is told to keep only what
 * the brief supports. `{name}` and `{what}` are filled by the assembler.
 *
 * What makes it work as marketing, in order of weight: one promise in the
 * headline (raised here, sold direct), the three things a buyer wants
 * before they trust a farm (how the animals live, what is in season, who
 * is behind it), the price list where a pack keeps it current, a plain way
 * to order, a reason to visit, and local words for search on every page.
 */
export const homesteadFarmSiteTemplate: SiteTemplate = {
  slug: "homestead-farm",
  name: "Homestead farm",
  industry: "homestead-farm",
  description: "Five pages for a farm that sells direct: what you raise, how to buy it, come and see, our story, and how to reach us.",
  look: { look: "warm", fontPairing: "warm", buttonShape: "rounded" },
  frame: {
    headerButton: { label: "Order now", href: "/shop" },
    footerColumns: [
      {
        heading: "Shop",
        text: "",
        links: [
          { label: "What we sell", href: "/shop" },
          { label: "How to order", href: "/shop" },
        ],
      },
      {
        heading: "Visit",
        text: "",
        links: [
          { label: "Come see the farm", href: "/visit" },
          { label: "Find us", href: "/contact" },
        ],
      },
    ],
    footerNote: "Raised here. Sold here.",
  },
  pages: [
    {
      path: "/",
      title: "Home",
      inNav: true,
      description: "{name}: pasture-raised meat and eggs sold direct from the farm. See what we raise, this week's prices, and how to order or visit.",
      seoTitle: "Pasture-raised meat and eggs sold direct | {name}",
      sections: [
        {
          type: "hero",
          headline: "Pasture-raised meat and eggs from {name}",
          subheadline: "Raised on our own ground and sold direct to the people who eat it.",
          cta: { label: "See what we sell", href: "/shop" },
          image: null,
          height: "tall",
          style: { width: "default", spacing: "default", align: "center", background: "photo", photo: null },
        },
        {
          type: "offer",
          heading: "What we raise",
          items: [
            { name: "Meat by the cut", blurb: "What we have that week, cut, wrapped and frozen on the farm." },
            { name: "Whole and half animals", blurb: "Reserve ahead and fill the freezer at a better price per pound." },
            { name: "Eggs", blurb: "From hens that live on pasture, gathered every day." },
            { name: "Seasonal extras", blurb: "What the season brings, from the garden and the kitchen." },
          ],
        },
        {
          type: "columns",
          heading: "How we farm",
          intro: "Simple, honest and out in the open.",
          columns: 3,
          widths: "equal",
          look: "cards",
          cards: [
            { id: "farm01", image: null, icon: "leaf", heading: "On pasture", body: ["Animals live outdoors on grass and are moved to fresh ground as the season allows."], cta: null },
            { id: "farm02", image: null, icon: "sun", heading: "In season", body: ["We raise what the year makes possible and sell it at its best."], cta: null },
            { id: "farm03", image: null, icon: "users", heading: "Known by name", body: ["You can meet the people who raised your food and ask them anything."], cta: null },
          ],
          style: { width: "default", spacing: "default", align: "default", background: "tint", photo: null },
        },
        {
          type: "columns",
          heading: "How to buy",
          intro: "Three steps, no account, no app.",
          columns: 3,
          widths: "equal",
          look: "plain",
          cards: [
            { id: "buy01", image: null, icon: "shopping-bag", heading: "Order ahead", body: ["Tell us what you want by the form, by phone or by email, and we set it aside for you."], cta: { label: "Place an order", href: "/shop" } },
            { id: "buy02", image: null, icon: "calendar", heading: "Pick a day", body: ["Collect at the farm on a day we agree, or find us at market."], cta: null },
            { id: "buy03", image: null, icon: "package", heading: "Take it home", body: ["Cut, wrapped and frozen, ready for the freezer or the table."], cta: null },
          ],
        },
        {
          type: "block",
          kind: "retail.prices",
          heading: "This week's prices",
          note: "What we have and what it costs, straight from our stock.",
          emptyText: "Prices are posted when the season starts.",
          config: {},
        },
        { type: "hours", heading: "Where to find us", note: "", needs: "hours" },
        {
          type: "cta",
          headline: "Come and see where your food is raised.",
          cta: { label: "Plan a visit", href: "/visit" },
        },
      ],
    },
    {
      path: "/shop",
      title: "Shop",
      inNav: true,
      description: "Pasture-raised meat by the cut or the share, plus eggs, from {name}. Prices and how to order.",
      seoTitle: "Shop pasture-raised meat and eggs | {name}",
      sections: [
        {
          type: "hero",
          headline: "What we sell",
          subheadline: "Cut, wrapped and frozen on the farm. Order ahead, or find us at market.",
          cta: null,
          image: null,
          height: "compact",
          style: { width: "default", spacing: "default", align: "default", background: "tint", photo: null },
        },
        {
          type: "text",
          heading: "How to order",
          body: [
            "Tell us what you want with the form below, or call or email. We confirm what is available, and you pick it up at the farm or at market on the day we agree.",
            "Whole and half animals are reserved ahead. We walk you through how that works and what to expect.",
          ],
        },
        {
          type: "offer",
          heading: "By the cut and by the share",
          items: [
            { name: "By the cut", blurb: "Individual cuts and packs, sold by the pound." },
            { name: "Halves and wholes", blurb: "Fill a freezer at a better price per pound, cut to your liking." },
            { name: "Eggs and extras", blurb: "Eggs by the dozen, and whatever else the season brings." },
          ],
        },
        {
          type: "block",
          kind: "retail.prices",
          heading: "Current prices",
          note: "",
          emptyText: "Ask us for this week's list.",
          config: {},
        },
        {
          type: "form",
          heading: "Place an order",
          note: "Say what you would like and when. We confirm by email.",
          buttonLabel: "Send order",
          askPhone: true,
          thanks: "Thanks. We'll confirm what's available and when to collect it.",
          fields: [
            { id: "order01", label: "What would you like?", kind: "long", required: true, options: [] },
            { id: "order02", label: "Pickup or delivery?", kind: "choice", required: false, options: ["Pickup at the farm", "Pickup at market", "Delivery"] },
            { id: "order03", label: "When do you need it by?", kind: "text", required: false, options: [] },
          ],
        },
      ],
    },
    {
      path: "/visit",
      title: "Visit",
      inNav: true,
      description: "Visit {name}: walk the pastures, meet the animals and see how your food is raised. Book a time and find us.",
      seoTitle: "Visit the farm | {name}",
      sections: [
        {
          type: "hero",
          headline: "Come see the farm",
          subheadline: "Walk the pastures, meet the animals and see how your food is raised.",
          cta: null,
          image: null,
          height: "standard",
          style: { width: "default", spacing: "default", align: "center", background: "photo", photo: null },
        },
        {
          type: "text",
          heading: "What a visit is like",
          body: [
            "A visit takes about an hour. We walk out to the pastures, look in on the animals and finish at the barn. Wear boots or shoes you do not mind getting muddy.",
            "Groups and school classes are welcome by arrangement.",
          ],
        },
        {
          type: "booking",
          heading: "Book a farm visit",
          note: "Pick a time that suits you and we will be ready.",
          title: "Farm visit",
          minutes: 60,
          days: [5, 6],
          from: "09:00",
          to: "16:00",
          leadHours: 24,
          horizonDays: 30,
          askPhone: true,
          buttonLabel: "Book",
          thanks: "Thanks. We'll confirm by email.",
          needs: "scheduling",
        },
        {
          type: "events",
          heading: "What's on at the farm",
          note: "Open days, market dates and farm events.",
          count: 3,
          horizonDays: 90,
          emptyText: "Nothing scheduled right now. Check back soon.",
          needs: "scheduling",
        },
        { type: "hours", heading: "When we're here", note: "", needs: "hours" },
        { type: "map", heading: "Find us", note: "", zoom: 15, showAddress: true, directions: true },
      ],
    },
    {
      path: "/about",
      title: "About",
      inNav: true,
      description: "About {name}: a working homestead farm raising animals on pasture and selling direct.",
      seoTitle: "About | {name}",
      sections: [
        {
          type: "text",
          heading: "Our story",
          body: [
            "{name} is a working homestead farm. We raise animals on pasture, grow what we can, and sell what we produce directly to the people who eat it.",
            "We farm the way we do because it makes better food and a better place to live. The rest of the story is best told in person, so come and see us.",
          ],
        },
        {
          type: "columns",
          heading: "What we stand for",
          intro: "",
          columns: 3,
          widths: "equal",
          look: "cards",
          cards: [
            { id: "stand01", image: null, icon: "shield-check", heading: "Raised right", body: ["Animals with room, fresh air and good feed, handled calmly."], cta: null },
            { id: "stand02", image: null, icon: "leaf", heading: "Land first", body: ["Grazing that builds soil and leaves every field better than we found it."], cta: null },
            { id: "stand03", image: null, icon: "heart", heading: "Neighbors", body: ["We sell to people we know by name, and we want to keep it that way."], cta: null },
          ],
          style: { width: "default", spacing: "default", align: "default", background: "tint", photo: null },
        },
        { type: "image", image: null, caption: "", layout: "wide" },
      ],
    },
    {
      path: "/contact",
      title: "Contact",
      inNav: true,
      description: "Contact {name}: phone, email, hours and where to find us.",
      seoTitle: "Contact | {name}",
      sections: [
        { type: "contact", heading: "Get in touch", note: "Call, email or send a note below. We answer as quickly as we can." },
        { type: "form", heading: "Send us a message", note: "", buttonLabel: "Send", askPhone: true, thanks: "Thanks. We'll be in touch.", fields: [] },
        { type: "hours", heading: "Hours", note: "", needs: "hours" },
        { type: "map", heading: "Find us", note: "", zoom: 15, showAddress: true, directions: true },
      ],
    },
  ],
  pictures: [
    { at: "/#0", where: "background", scene: "hills", alt: "" },
    { at: "/visit#0", where: "background", scene: "dawn", alt: "" },
    { at: "/about#2", where: "image", scene: "furrows", alt: "Rows in a field under a wide sky" },
  ],
  writerNotes: [
    "This is a homestead farm: a family-scale farm that raises animals on pasture and sells direct, at the farm gate, at farmers markets and by pre-order.",
    "Keep only what the brief supports. If it says what the farm raises, say exactly that and drop the rest of any list; if it does not, keep lists general and never claim a product, a practice, a breed or a certification the brief does not give.",
    "Local search matters: put the town or area from the address together with what the farm sells in the home page's headline or the line under it, and in every page's description.",
    "The voice is a farmer talking to a neighbor: plain, warm, concrete. Nothing about passion or journeys. Prices and hours are shown by the site itself; do not write them into the words.",
    "Buttons say where they lead: the shop, a visit, the contact page. A page that asks the reader to do something ends with one clear ask.",
    "When the owner's own words name what they raise or sell, the What we raise list and the shop page say exactly those things, in the owner's terms, and nothing they do not name.",
  ],
};
