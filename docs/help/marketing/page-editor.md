# Editing a page

> Change what a page of your website says: its title and address, the sections on it and their order, and the words in each, beside a preview of the draft. Every save is kept, and any earlier version can be put back.
> **Route:** /dashboard/m/marketing/website/pages/*
> **Order:** 210

Open **Marketing**, click `Website`, and click {button:Edit|outline|pencil} on a page in `Pages`. Owners only. The page opens with its settings and sections on the left and a preview on the right. Everything you change stays on this screen until you click {button:Save|primary}; the preview shows the saved draft, and the internet shows what you last published.

## What you see

- **{button:Back to the website|link}.** Top left. Returns to the Website page. If you have unsaved changes, they are lost.
- **`Unsaved changes` and {button:Save|primary}.** Top right. The words appear once you have changed something. {button:Save|primary} is grayed out until then and reads `Saving…` while it works.
- **`Page`.** `Title`, shown in the menu and the browser tab. `Address`, for every page but the home page: letters, numbers and hyphens with a slash between parts; the line under it reads `This page is at /about` or says why the address cannot be used. `In the menu`, a switch; the home page is always in the menu. `Description for search engines`, up to 200 characters, used by search results; blank uses your tagline.
- **`Sections`.** The page's sections in order, each with its kind and a line of what it says. Drag the {icon:grip-vertical} handle to move a section, or use {button:↑|ghost} and {button:↓|ghost}. Click a section to edit it. {icon:trash} removes it. Under the list, `Add a section after the selected one` and a button for each kind: {button:Big headline|outline}, {button:What you offer|outline}, {button:About|outline}, {button:Text|outline}, {button:Call to action|outline}, {button:Contact details|outline}, {button:Hours|outline}, {button:Enquiry form|outline}, {button:Photo|outline}, {button:Photo gallery|outline}, {button:Slideshow|outline} and {button:Columns|outline}. Hold the pointer over one to read what it is for. A page holds up to twelve sections. A section with a photo that has no description shows `The photo has no description.` (or `2 of 3 photos have no description.`) in amber under its line, and the count for the whole page appears under the `Sections` heading with `Screen readers and search engines say the description instead of the picture; add one under each photo.` Both clear as soon as you type the descriptions; publishing is never held up by them.
- **The selected section.** A card headed with the section's kind, {button:Remove section|ghost|trash}, its own fields (below), and under them `Layout and look`, the same on every kind: `Width` ({button:As designed|outline}, {button:Text column|outline}, {button:Page|outline} or {button:Full width|outline}; a Photo section and a Slideshow keep their own width setting instead), `Spacing` ({button:As designed|outline}, {button:Tight|outline}, {button:Normal|outline} or {button:Airy|outline}; the Big headline has `Height`, {button:Compact|outline}, {button:Standard|outline} or {button:Tall|outline}, instead), `Alignment` ({button:As designed|outline}, {button:Left|outline} or {button:Centred|outline}) and `Background` ({button:As designed|outline}, {button:None|outline}, {button:Tint|outline}, {button:Brand colour|outline}, {button:Dark|outline} or {button:Photo|outline}). `As designed` is how that kind of section looks on its own; every choice is a preset that fits a phone as well as a laptop. A dark background or a photo turns the words white; the brand colour uses your brand's own contrast. Choosing `Photo` adds a `Background photo` picker; the photo is darkened so the words stay readable and, being decoration, needs no description. A Big headline or an About section with a photo also gets `Photo side` ({button:Right|outline} or {button:Left|outline}).
  Its own fields:
  - *Big headline*: `Headline` (under ten words reads best), `Line under it`, a `Button` with a `Label` and `Goes to` ({button:Remove button|ghost} takes the button off; {button:Add a button|outline} puts one back), and `Photo beside the headline`, optional: a landscape photo sits to the right of the words on a wide screen and under them on a phone. See *Photos* below for how a photo is chosen.
  - *What you offer*: `Heading` and `Items`, each with a name and a line. {button:Add item|outline|plus} adds one, up to eight; the {icon:trash} beside an item removes it, down to one.
  - *About* and *Text*: `Heading` (optional for Text) and `Paragraphs`. Leave a blank line between paragraphs. Up to eight. *About* also has `Photo beside the text`, optional: the photo sits to the right of the paragraphs on a wide screen and under them on a phone.
  - *Photo*: `Photo`, a `Caption` (a line under the photo, or blank) and `Width`: {button:In the text column|outline} keeps it as wide as the words; {button:Full width|outline} spans the page. A Photo section with no photo chosen shows nothing on the site.
  - *Photo gallery*: `Heading` (optional), `Photos per row` ({button:2|outline}, {button:3|outline} or {button:4|outline} on a wide screen; a phone always shows two) and `Photos`, one row each: the picture, a description box (what is in the picture, for people who can't see it), a `Caption, or blank` box, {icon:image-plus} to swap it for another from the library, {button:↑|ghost} and {button:↓|ghost} to reorder, and {icon:trash} to take it out of the gallery. {button:Add a photo|outline|plus} opens `Your site's photos` (see *Photos* below) and the photo you click is added at the end, up to twelve; the same photo can appear more than once. On the site each photo shows as a tile with its caption underneath; clicking one opens it large over the page with `Photo 2 of 5` above it, arrows (or the keyboard's arrow keys, or a swipe across the photo on a phone) to move between the photos, and {icon:x} or Escape to close. A visitor whose browser runs no scripts gets the photo in a new tab instead. A gallery with no photos shows nothing on the site.
  - *Columns*: `Heading` (optional), `Line under it`, `Columns` ({button:2|outline}, {button:3|outline} or {button:4|outline} on a wide screen; a phone stacks them), with two columns `Widths` ({button:Equal|outline}, {button:Wide left|outline} or {button:Wide right|outline}), `Look` ({button:Cards|outline} puts each card in a white panel on a tinted band; {button:Plain|outline} stacks them on the page) and `Cards`, one panel each headed `Card 1`, `Card 2` and so on. Drag the {icon:grip-vertical} handle to move a card, or use {button:↑|ghost} and {button:↓|ghost}; {icon:trash} removes it. Each card has a `Heading`, `Text` (a blank line starts a new paragraph, up to four), an `Icon` chosen from a list (shown above the heading when the card has no photo), a `Photo` (chosen the same way as elsewhere; it sits above the heading in place of the icon) and a `Button` with a `Label` and `Goes to`. {button:Add a card|outline|plus} adds one, up to twelve. Cards fill the columns left to right, row by row. A new Columns section starts as `Why choose us` with three cards to overwrite.
  - *Slideshow*: `Heading` (optional), `Moves on by itself` ({button:Only when pressed|outline}, {button:Every 4 seconds|outline}, {button:Every 6 seconds|outline} or {button:Every 10 seconds|outline}), `Width` ({button:In the text column|outline} or {button:Full width|outline}) and `Photos`, the same rows as a gallery's. On the site one photo shows at a time with its caption under it, arrows on either side, a dot for each photo (the current one in your color) and, when it moves by itself, `Pause` and `Play`. It stops moving while a visitor's pointer is on it, and never moves for a visitor whose device asks for less motion; the arrows and dots always work. On a phone a swipe across the photo moves it on or back, and with a keyboard the arrow keys do the same while one of its buttons has focus. A slideshow with no photos shows nothing on the site.
  - *Photos*, wherever one can be placed: with none chosen, {button:Add a photo|outline|image-plus} opens `Your site's photos`. With one chosen you see it small with its size, such as `1600 × 1067`, a `Describe the photo` box (what is in the picture, for people who can't see it and for search engines), {button:Change photo|outline|image-plus} and {button:Remove|ghost|trash}, which takes the photo off this section only. The `Your site's photos` window shows every photo on the site as a grid; click one to use it. {button:Upload a photo|outline|image-plus} takes a JPEG, PNG or WebP up to 12MB, reads `Uploading…`, and puts the new photo straight into the section. Yosher resizes every photo for the web and strips the camera's data, so a photo taken on a phone never carries its location onto your site. The {icon:trash} under a photo removes it from the whole site after your browser asks `Remove this photo from the site? It disappears from every page that shows it once you publish.` A site holds up to sixty photos. {button:Close|ghost} closes the window.
  - *Call to action*: `Line` and a `Button` with `Label` and `Goes to`.
  - *Contact details* and *Hours*: `Heading` and `Note`. The details themselves come from the Website page's `Details on the site`.
  - *Enquiry form*: `Heading`, `Note`, `Button` (blank reads `Send`), `Ask for a phone number` (a switch; name, email and the message are always asked), `After sending`, the line shown in place of the form once a message is sent (blank reads `Thanks. We'll be in touch.`), and `Questions`, your own questions, asked between the phone number and the message. Each question is a card with the question's words, a kind (`Short answer`, one line up to 200 characters; `Long answer`, a few lines up to 1,000; `Pick one`, a list to choose from; `Yes or no`, a box to tick), {button:↑|ghost} and {button:↓|ghost} to reorder, {icon:trash} to remove it, and a `Must be answered` switch. A `Pick one` question lists its choices, one box each, with {icon:trash} beside each (down to one), {button:Add a choice|outline|plus} (up to twelve) and the line `Between one and twelve choices, each with a name.` {button:Add a question|outline|plus} adds one, up to six; the line under the list reads `Up to six, asked between the phone number and the message. Answers arrive with the message, in the follow-up and in the email.` A visitor's answers are checked against the questions as published, so publish after changing them. What a visitor sends lands on the Website page under `Messages`, as a contact and a follow-up in your workspace, and in your email; see [Your website](website.md). In the preview the form is shown but grayed out, with `Visitors can send this once the site is published.`
  `Goes to` takes a page on this site such as `/contact`, a full `https://` address, or a `mailto:` or `tel:` link. A button's shape, and the site's fonts, come from the `Look` on your brand kit (see [Your brand kit](overview.md)), the same on every page. Anything else shows `That is not a link the site can use.` in red under the box as you type, and Save answers `Section [number]: a link is a page on this site such as /contact, a full https:// address, or a mailto: or tel: link.` until it is fixed.
- **`History`.** Every save, publish and restore of this page, newest first, with the time, up to the last thirty. {button:Restore|ghost} beside an older one puts that version into the draft.
- **`Preview of the saved draft`.** The right-hand side shows the page as the renderer draws it. It reads `(save to see your changes)` while you have unsaved edits. {button:Reload|ghost|refresh} redraws it.

## How to change what a page says

1. Click a section in `Sections`. Its fields open below the list.
2. Change the words. The list's summary line updates as you type.
3. Click {button:Save|primary}. You see `Page saved. Publish from the Website page when it reads right.` and the preview redraws.
4. When every page reads right, go back to the website and click {button:Publish changes|primary}. See [Your website](website.md).

## How to move, add and remove sections

1. To move a section, drag its {icon:grip-vertical} handle up or down the list, or click {button:↑|ghost} or {button:↓|ghost}. With the keyboard, focus the handle, press `Space`, move with the arrow keys and press `Space` again.
2. To add a section, click the section it should follow, then click its kind under `Add a section after the selected one`. With nothing selected it is added at the end. The new section opens with placeholder words to replace.
3. To remove a section, click {icon:trash} on its row, or {button:Remove section|ghost|trash} on its card.
4. Click {button:Save|primary}.

## How to change the title, address or menu

1. In `Page`, change `Title`. For any page but the home page, change `Address`; the line under it shows the address it will be at.
2. Turn `In the menu` off to keep a page reachable by its address but out of the menu.
3. Click {button:Save|primary}. The menu on the live site changes at once; the page's words wait for Publish.

## How to go back to an earlier version

1. In `History`, find the version. `Saved` is a save on this screen, `Published` is what went on the internet, `Restored` is an earlier restore.
2. Click {button:Restore|ghost}. Your browser asks `Put this version back into the draft? Anything you have not saved on this page is lost.` Confirm.
3. You see `Version restored into the draft.` The screen reloads with that version, and the restore itself is added to the history.

## Messages

| Message | What it means |
| --- | --- |
| `Page saved. Publish from the Website page when it reads right.` | The draft was saved. The internet has not changed. |
| `Version restored into the draft.` | The chosen version is the draft now. |
| `Section 2: headline is missing.` | A required field in that section is empty. Fill it in and save again. |
| `Section 2: headline is too long.` | A field is over its limit. |
| `Give the page a title.` | `Title` is empty. |
| `Give the page an address, like /services.` | `Address` is empty. |
| `Use letters, numbers and hyphens, with a slash between parts.` | The address has a character it cannot have. |
| `That address is set aside. Choose another.` | The address is one Yosher keeps for itself. |
| `The home page already has that address.` | Only the home page is at `/`. |
| `Another page already has that address.` | Two pages cannot share an address. |
| `The home page stays; every site has one.` | The home page cannot be renamed to another address or deleted. |
| `That page no longer exists.` | The page was deleted on the Website page. Go back. |
| `That version is gone.` | The version was trimmed from history. |
| `Only an owner can change how the business looks.` | You are signed in as staff. |
| `No sections yet. Add one below.` | The page is empty. |
| `Nothing saved yet. Every save, publish and restore is kept here, the last thirty.` | The page has no history yet. |
| `Unsaved changes` | You have changed something since the last save. |
| `Photo added.` | The upload was checked, resized and saved, and the photo is in the section. |
| `Photo removed.` | The photo is gone from the site's library. Pages that showed it lose it when you publish. |
| `That file isn't a photo Yosher can use. Use a JPEG, PNG or WebP.` | The file is not one of the three kinds, or could not be read as a picture. An SVG is not accepted as a photo. |
| `That photo is over 12MB. Export it smaller and try again.` | The limit for one upload. |
| `A site can hold up to 60 photos. Remove one first.` | The library is full. |
| `That photo is no longer there. Upload it again.` | The upload never reached storage, or was removed before it was checked. |
| `This photo is no longer in the library.` | Under a placed photo: somebody removed it from the site. Choose another or remove it from the section. |
| `No photos yet. Upload one to start.` | The library is empty. |
| `The upload didn't finish. Try again.` | The file never reached storage. Check your connection and try again. |
| `File storage isn't set up on this deployment yet.` | This installation of Yosher has no file storage. Ask us. |

## Not on this page

Photos and pictures in a section. Columns or side-by-side layouts. Writing a section with the assistant; today {button:Rewrite the words|ghost} on the Website page rewrites every page from your brand kit. Undo within the screen; use `History` instead. Ask us if you need any of these.

## Who can do what

Owners edit, save, add, move and remove sections, and restore versions. Staff and accountants do not open this screen; they see the Website page and the draft preview.
