# Editing a page

> Change what a page of your website says: its title and address, the sections on it and their order, and the words in each, beside a preview of the draft. Every save is kept, and any earlier version can be put back.
> **Route:** /dashboard/m/marketing/website/pages/*
> **Order:** 210

Open **Marketing**, click `Website`, and click {button:Edit|outline|pencil} on a page in `Pages`. Owners only. The page opens with its settings and sections on the left and a preview on the right. Everything you change stays on this screen until you click {button:Save|primary}; the preview shows the saved draft, and the internet shows what you last published.

## What you see

- **{button:Back to the website|link}.** Top left. Returns to the Website page. If you have unsaved changes, they are lost.
- **`Unsaved changes` and {button:Save|primary}.** Top right. The words appear once you have changed something. {button:Save|primary} is grayed out until then and reads `Saving…` while it works.
- **`Page`.** `Title`, shown in the menu and the browser tab. `Address`, for every page but the home page: letters, numbers and hyphens with a slash between parts; the line under it reads `This page is at /about` or says why the address cannot be used. `In the menu`, a switch; the home page is always in the menu. `Description for search engines`, up to 200 characters, used by search results; blank uses your tagline.
- **`Sections`.** The page's sections in order, each with its kind and a line of what it says. Drag the {icon:grip-vertical} handle to move a section, or use {button:↑|ghost} and {button:↓|ghost}. Click a section to edit it. {icon:trash} removes it. Under the list, `Add a section after the selected one` and a button for each kind: {button:Big headline|outline}, {button:What you offer|outline}, {button:About|outline}, {button:Text|outline}, {button:Call to action|outline}, {button:Contact details|outline} and {button:Hours|outline}. Hold the pointer over one to read what it is for. A page holds up to twelve sections.
- **The selected section.** A card headed with the section's kind, {button:Remove section|ghost|trash}, and its fields:
  - *Big headline*: `Headline` (under ten words reads best), `Line under it`, and a `Button` with a `Label` and `Goes to`. {button:Remove button|ghost} takes the button off; {button:Add a button|outline} puts one back.
  - *What you offer*: `Heading` and `Items`, each with a name and a line. {button:Add item|outline|plus} adds one, up to eight; the {icon:trash} beside an item removes it, down to one.
  - *About* and *Text*: `Heading` (optional for Text) and `Paragraphs`. Leave a blank line between paragraphs. Up to eight.
  - *Call to action*: `Line` and a `Button` with `Label` and `Goes to`.
  - *Contact details* and *Hours*: `Heading` and `Note`. The details themselves come from the Website page's `Details on the site`.
  `Goes to` takes a page on this site such as `/contact`, a full `https://` address, or a `mailto:` or `tel:` link.
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

## Not on this page

Photos and pictures in a section. Columns or side-by-side layouts. Writing a section with the assistant; today {button:Rewrite the words|ghost} on the Website page rewrites every page from your brand kit. Undo within the screen; use `History` instead. Ask us if you need any of these.

## Who can do what

Owners edit, save, add, move and remove sections, and restore versions. Staff and accountants do not open this screen; they see the Website page and the draft preview.
