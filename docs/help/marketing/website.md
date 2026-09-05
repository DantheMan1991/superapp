# Your website

> Build a website for your business from your brand kit and a few details, look at it, and put it on the internet when it reads right.
> **Route:** /dashboard/m/marketing/website
> **Order:** 200

Open **Marketing** in the sidebar and click `Website` in the row under the title. The first time, this page asks for an address and your contact details and builds three pages: home, about and contact. The words are written from your brand kit, the kind of business you are and the details you give; the logo and colors come from your brand kit. Nothing is on the internet until you click {button:Publish|primary}.

## What you see

Before there is a website:

- **`Build your website`.** A short explanation, then the form.
- **`Address`.** The first part of your site's web address, in letters, numbers and hyphens. It starts as your business's name. The line under it reads `Your site will be at [address].[site domain]`, or, when Yosher has no site domain set up yet, `Your site will be at /sites/[address] until a site domain is set up.` Type something that cannot be an address and the line says why: `Use letters, numbers and hyphens only.`, `An address needs at least 3 characters.`, `An address can be at most 40 characters.` or `That address is set aside. Choose another.`
- **`Phone`, `Email`, `Address`, `Hours`.** What the contact page shows. All optional. `Address` is a box that keeps line breaks; the text under it reads `Shown on the contact page. Leave blank if customers come to you by appointment.` `Hours` takes one line per entry, up to seven; the text under it reads `One line each, up to seven. Blank hides the hours section.`
- **{button:Build it|primary}.** Grayed out until the address is usable. It reads `Writing…` while the words are written, usually ten to thirty seconds.

Once there is a website:

- **The first card.** The site's name with a badge, {badge:Draft|secondary} or {badge:Published|success}, and a line that reads `Not on the internet yet.` or `On the internet since [date].`, followed by `The words were written by Yosher's assistant from your brand kit; read them before you publish.` or `The words are the standard set; read them before you publish.` The standard set is Yosher's plain text used when the assistant could not write for you.
- **`Address`** and **`Also at`.** Your site's web address, `[address].[site domain]`, and the address on Yosher, `/sites/[address]`. When no site domain is set up only the second is shown, as `Address`.
- **{button:Preview the draft|outline|external-link}.** Opens your draft in a new tab, with a yellow band at the top reading `Draft preview. Only people signed in to [your business] can see this; publish it from Marketing to put it on the internet.`
- **{button:Open the live site|outline|external-link}.** Appears once published. Opens the site as customers see it.
- **{button:Publish|primary}.** Owners only. Puts every draft page on the internet. Once published it becomes {button:Publish changes|primary}, which puts your latest drafts live, and {button:Unpublish|outline} appears beside it.
- **{button:Rewrite the words|ghost}.** Owners only. Writes every page again from your brand kit and details. Your browser asks `Write every page again from your brand kit and details? The current drafts are replaced. What is published stays until you publish again.`
- **`Pages`.** Under the heading: `Drag to set the menu order. A page's words wait for Publish; its place in the menu shows at once.` One row per page: its title, its address such as `/about`, how many sections it has, and `published` or `draft only`. {button:Preview|ghost} opens that page's draft in a new tab. Owners also see the {icon:grip-vertical} drag handle, {button:Edit|outline|pencil}, which opens the page in the editor (see [Editing a page](page-editor.md)), and {icon:trash} on every page but the home page. Under the list, {button:Add a page|outline|plus} opens a `Title` and an `Address` with {button:Add page|primary} and {button:Cancel|ghost}; the address fills in from the title and the line under it reads `Will be at /services` or says why it cannot be used.
- **`Messages`.** Under the heading: `What people sent through the form on your site. Each one is a contact and a follow-up in your workspace, and was emailed to you.` One row per message, newest first, up to the last thirty: the sender's name, the date it arrived, a badge reading {badge:to reply|outline} while its follow-up is open, {badge:replied|outline} once the follow-up is marked done, or {badge:follow-up removed|outline} if the follow-up was deleted; their email and phone as links you can click to write or call; `from /contact` when the form was on a page other than the home page; and the first line of the message with `Show the whole message` under it (`Show less` folds it again). {button:Follow-up|outline} opens the follow-up in Work, when Work is switched on. {button:Contact|outline} opens their record in CRM, when CRM is switched on. The follow-up and the contact exist either way; the buttons only appear where there is a page to open. Owners also see {button:Remove|ghost|trash}; your browser asks `Remove the message from [name]? The contact and the follow-up it made stay where they are.` A line under each row says where the message went: `Contact: [name].` or `Saved as [name] in your contacts.`, `The contact it made has since been removed.`, and `Emailed to the site's email address.`, `Emailed to the owners; add an email to the site's details to send it there instead.` or `Not emailed: the site has no email address and no owner has one.` With no messages yet the card reads `No messages yet. When someone fills in the form on your site, it lands here.`
- **`Details on the site`.** `Name in the header`, `Phone`, `Email`, `Address` and `Hours`, the same fields as when you built the site, with {button:Save|primary} and {button:Discard changes|ghost}. The header name is blank by default, which uses your brand kit's business name. These details show on the live site the moment you save; there is no need to publish again.
- **`Your own domain`.** Under the heading: `Point a domain you already own at this site. Your free address keeps working alongside it.` One row per connected domain: the domain, a badge reading {badge:Live|success}, {badge:Waiting for DNS|secondary} or {badge:Needs attention|destructive}, a line saying what is happening (`Live. Visitors to this domain see your site.`, `Waiting for the TXT record that proves you own the domain.`, `Waiting for the record that points the domain at your site. DNS changes can take up to an hour.`, or the last error), and `Last checked [time]`. Owners see {button:Check again|outline} and {button:Remove|ghost|trash}. While a domain is not live, a table shows the records to add at your registrar: `Type`, `Name`, `Value`, a line saying what each is for, and {icon:copy} to copy the value. Under the rows, owners see `Domain you own`, a box for the domain, and {button:Connect|primary|globe}; the line under the box says what will happen, or why the domain cannot be connected. When the feature is not switched on for this installation the card reads `Connecting your own domain isn't switched on for this deployment yet. Your free address works in the meantime.`
- **`Address`** (the last card). Owners only. The address field again, with {button:Change address|outline}. The line under it reads `Changing the address breaks links people already have to the old one.`

## How to build the website

1. Set your brand kit first, on the `Brand` tab: the logo, colors and tagline are what the site is built from. See [Your brand kit](overview.md).
2. Click `Website` in the row under the title.
3. Check the `Address`. Change it if you want something shorter.
4. Fill in `Phone`, `Email`, `Address` and `Hours` if you want them on the contact page. You can add or change them later.
5. Click {button:Build it|primary}. It reads `Writing…`, then you see `Your website is drafted. Have a look before you publish it.` and the page changes to show your site.
6. Click {button:Preview the draft|outline|external-link} and read every page. The words are a first draft written from what Yosher knows; nothing about your business is invented, but a line may still be wrong for you.
7. If you would rather start again, click {button:Rewrite the words|ghost} and confirm.

## How to publish

1. Click {button:Publish|primary}. You see `Your website is live.` and the badge reads {badge:Published|success}.
2. Click {button:Open the live site|outline|external-link} to see it as customers do. Give people the address shown on the card.
3. After you change details or rewrite the words, click {button:Publish changes|primary}. You see `Your website is updated.`

To take it down, click {button:Unpublish|outline}; your browser asks `Take the website off the internet? Your pages are kept and you can publish again any time.` and you see `Your website is offline.`

## How to add, reorder or delete a page

1. Under `Pages`, click {button:Add a page|outline|plus}. Type a `Title`; the `Address` fills in from it, and you can change it.
2. Click {button:Add page|primary}. You see `Page added. Write it, then publish when it reads right.` and the new page opens in the editor with one text section to replace.
3. To change the menu order, drag a page's {icon:grip-vertical} handle up or down. You see `Menu order saved.` and the live site's menu changes at once.
4. To delete a page, click {icon:trash} on its row. Your browser asks `Delete the [title] page? It comes off the internet at once, with its history. This cannot be undone.` Confirm and you see `Page deleted.` The home page cannot be deleted.

## How to change the details on the site

1. In `Details on the site`, change any of the fields. `Hours` takes one line per entry.
2. Click {button:Save|primary}. You see `Details saved. They show on the site straight away.`

## How to connect your own domain

You need a domain you already own and a login to wherever its DNS is managed, usually the registrar you bought it from. Nothing about your email changes: you add one or two records, and you never change the domain's nameservers.

1. In `Your own domain`, type the domain in `Domain you own`. Use the `www` form, `www.example.com`; a bare domain such as `example.com` works too. The line under the box confirms what will be asked for, or says why the domain cannot be used.
2. Click {button:Connect|primary|globe}. It reads `Connecting…`, then you see `Connected. Publish the records below at your registrar, then check again.` and the domain appears as {badge:Waiting for DNS|secondary} with a table of records.
3. At your registrar, add each record in the table exactly as shown: a `TXT` record first if one is listed (it proves you own the domain), then the `CNAME` (for a `www` name) or `A` record (for a bare domain). Use {icon:copy} to copy each value. Leave every other record alone.
4. Wait a few minutes, then click {button:Check again|outline}. You see `Live. Visitors to this domain see your site.` when it is done, or `Checked. Not there yet.` when the records have not reached the internet; DNS changes can take up to an hour.
5. Once live, the badge reads {badge:Live|success}, the records table disappears, and search engines are told this domain is the site's real address.

To disconnect, click {button:Remove|ghost|trash}; your browser asks `Disconnect [domain]? Visitors to it stop seeing your site at once. Your free address keeps working.` and you see `Domain disconnected.` The records at your registrar are yours to remove.

## How messages from your site reach you

Your contact page carries an enquiry form: `Name`, `Email`, `Phone (optional)` and `Message`, with a button that reads `Send` unless you changed it in the editor. A site built before the form existed does not have one until you add it: open the contact page in the editor and add an {button:Enquiry form|outline} section (see [Editing a page](page-editor.md)), then publish.

When a visitor presses `Send` on your live site, in the same moment:

1. They become a contact in your workspace, matched by email if you already have them, otherwise added as a person with their email and phone. When CRM is switched on, the record's source reads `website`.
2. A follow-up called `Reply to [name]` is raised in Work, due today, with the whole message in its notes. It is in that morning's email digest for owners, and on the contact's record when CRM is on.
3. The message appears under `Messages` on this page.
4. You are emailed a copy, from the site's email address in `Details on the site` if there is one, otherwise to every owner. Reply to that email and your answer goes to the visitor.

The visitor sees `Message sent.` and the line you set as `After sending`. A visitor who sends more than five messages in an hour, or a site that receives more than a hundred in a day, is asked to try later or use the phone or email on the page. In the draft preview the form is shown grayed out; only the live site takes messages.

## How to change the address

1. In the last card, type the new address. The line under the box shows what it will be, or why it cannot be.
2. Click {button:Change address|outline}. You see `Address changed.` Links to the old address stop working.

## Messages

| Message | What it means |
| --- | --- |
| `Your website is drafted. Have a look before you publish it.` | The three pages were written and saved as drafts. |
| `Your website is live.` | Every draft page is now on the internet at your address. |
| `Your website is updated.` | The latest drafts replaced what was on the internet. |
| `Your website is offline.` | The site is no longer served. Your pages are kept. |
| `The words are rewritten. Have a look before you publish.` | Every draft was written again. What is published has not changed. |
| `Details saved. They show on the site straight away.` | Phone, email, address and hours were saved and the live site already shows them. |
| `Address changed.` | The site moved to the new address. |
| `That address is already taken. Choose another.` | Another business on Yosher has that address. |
| `Use letters, numbers and hyphens for the address.` | The address has a character it cannot have. |
| `That address is set aside. Choose another.` | The address is one Yosher keeps for itself, such as `www` or `mail`. |
| `This business already has a website.` | You tried to build a second one. Each business has one site. |
| `There is no website yet. Build one first.` | An action ran before the site was built. Reload the page. |
| `There are no pages to publish yet.` | The site has no pages. Click {button:Rewrite the words|ghost} to write them. |
| `Check the fields and try again.` | A field is over its length, or the email address is not one. |
| `Only an owner can change how the business looks.` | You are signed in as staff. Ask an owner. |
| `Accountant access is read-only.` | You are signed in as the accountant. |
| `Connected. Publish the records below at your registrar, then check again.` | The domain is on the site's hosting. It goes live once the records are published and checked. |
| `Connected and live.` | The domain was already pointing at the site's hosting; nothing else to do. |
| `Live. Visitors to this domain see your site.` | The domain is verified and pointing at the site. |
| `Checked. Not there yet.` | The records have not reached the internet, or one is missing. Compare the table with your registrar and try again later. |
| `Domain disconnected.` | The domain no longer reaches the site. |
| `Connecting your own domain isn't switched on for this deployment yet.` | This installation of Yosher has no hosting connection for domains. Ask us. |
| `That doesn't look like a domain. Try www.example.com.` | The box holds something that is not a domain name. |
| `That address belongs to Yosher. Connect a domain you own.` | You typed a Yosher address rather than your own domain. |
| `Connect one name, like www.example.com, not a wildcard.` | Wildcards are not supported. |
| `That domain is already connected to a site on Yosher.` | Another site on Yosher has it. If it is yours, remove it there first. |
| `A site can have up to five domains. Remove one first.` | The limit. |
| `Vercel says that domain is already in use elsewhere. Remove it there, or ask us.` | The hosting provider has the domain on another project. |
| `Vercel no longer has this domain. Remove it here and connect it again.` | The domain was removed on the hosting side. Click {button:Remove|ghost|trash} and connect it again. |
| `Couldn't copy. Select the value and copy it by hand.` | The browser refused the clipboard. |
| `Page added. Write it, then publish when it reads right.` | The page exists as a draft and the editor is open. |
| `Menu order saved.` | The order you dragged into is saved and live. |
| `Page deleted.` | The page, its published copy and its history are gone. |
| `Another page already has that address.` | Two pages cannot share an address. |
| `The home page stays; every site has one.` | The home page cannot be deleted. |
| `Not on the internet yet.` | The site is a draft. |
| `On the internet since [date].` | When it was last published. |
| `draft only` | In `Pages`: this page has never been published. |
| `Message removed.` | The record of the message is gone from this page. The contact and the follow-up stay. |
| `That message is already gone.` | Somebody removed it before you did. Reload the page. |
| `Pick a message and try again.` | The page and the workspace disagree about which message you meant. Reload the page. |
| `No messages yet. When someone fills in the form on your site, it lands here.` | Nobody has sent a message through the form, or the site has no form yet. |
| `Message sent.` | What a visitor sees on your site after sending; your `After sending` line follows it. |
| `Check the highlighted fields and try again.` | On your site: a visitor left a field empty or mistyped their email. |
| `That's a few messages from here already. Give it an hour, or use the phone or email on this page.` | On your site: the same visitor sent more than five messages in an hour. |
| `This form isn't taking messages right now. Use the phone or email on this page.` | On your site: the site is unpublished, or the form was reached on a site that no longer exists. |
| `That didn't go through. Try again, or use the phone or email on this page.` | On your site: the message could not be saved. Ask us if it keeps happening. |

## Not on this page

Photos on the pages. Buying a new domain through Yosher; today you connect one you already own. A form with your own questions; today it asks for a name, an email, a phone number and a message. An online shop. Visitor counts. Ask us if you need any of these; they are the next things this page grows.

## Who can do what

Owners can build, publish, unpublish, rewrite, change the details, change the address and remove messages. Staff can open the page, see the addresses, the details and the messages, and open the draft preview and the live site; they cannot change anything. Accountants see the same read-only view. Anyone on the internet can send a message through the form on a published site; nobody needs to sign in for that.
