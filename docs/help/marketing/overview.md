# Your brand kit

> Set how your business looks to customers: the logo, the name they know you by, a tagline and your colors. Everything you save here goes onto every invoice PDF from the moment you save it.
> **Route:** /dashboard/m/marketing/**
> **Order:** 100

Open **Marketing** in the sidebar. This page holds your brand kit. Upload a logo with {button:Upload logo|outline|image-up}, fill in the fields and click {button:Save|primary}. From then on the PDF of every invoice, the copy attached to an emailed invoice and the copy attached to a payment reminder carry your logo at the top left, your business name and tagline beside it, and your primary color on the heading and the rules. Nothing else in Yosher changes yet; the website and your email signature come later.

## What you see

- **The heading.** `Marketing`, with the line `How [your business] looks to its customers. Today that is your brand kit: the logo, colors and tagline on every invoice.`
- **`Your brand`.** One card in three parts, top to bottom: how it reads, the logo, and the fields. This is the look every invoice uses unless a company below has one of its own.
- **How it reads.** The top of the card shows what the top of an invoice will show. Your logo if you have uploaded one, otherwise a colored square with the first letter of your name. Your name beside it, in your primary color. Your tagline under the name, or `No tagline yet`. At the right, two swatches, `Primary` and `Accent`, each with its hex value or the word `Default` when you have not chosen one.
- **The logo row.** Your logo with its size and type, for example `400 × 120 PNG`, or a dashed box reading `No logo yet` with the line `PNG or JPEG, up to 2MB. A wide logo suits the top of an invoice best.` Owners see {button:Upload logo|outline|image-up} here, which becomes {button:Replace logo|outline|image-up} once there is a logo, and {button:Remove|ghost|trash} beside it.
- **`Business name`.** The name customers see on documents. The gray text in the box is what is used when you leave it blank: your business's name in Yosher. Up to 80 characters.
- **`Tagline`.** A line under the name on documents. Optional, up to 140 characters. Leave it blank and no line is printed.
- **`Primary color`.** A color swatch, a box for a hex value like `#1f6f5f`, and {button:Clear|ghost} once something is in the box. Click the swatch to pick a color, or type the value. The text under the box reads `Headings and rules on your documents. Blank keeps the default black.` Type something that is not a hex value and it reads `Needs to be a hex value like #1f6f5f.` instead, and the box is outlined.
- **`Accent color`.** The same controls. A second color for later: the website and highlights. Blank is fine; nothing uses it yet.
- **{button:Save|primary}.** Grayed out until you change something. While it saves it reads `Saving…`. {button:Discard changes|ghost} appears beside it once you have changed something and puts every field back to what was saved.
- **`Companies`.** Appears only when your business has more than one company on Accounting's Companies page, or when a company already has a look of its own. Under the heading: `Each company uses your brand unless you give it a look of its own. A company's own look fills in only what you set; anything left blank still comes from your brand.` Each company is a row reading `Uses your brand.` with {button:Give it its own look|outline}, or, once it has one, its own card with the same three parts as `Your brand` and {button:Use your brand instead|ghost} at the top right. A company's card that has no logo of its own shows your brand's logo in its preview with the note `Using your brand's logo.`

## How to upload a logo

1. Export the logo as a PNG or a JPEG, 2MB or smaller. A wide logo, roughly three times as wide as it is tall, fits the top of an invoice best. A PNG with a transparent background looks best on the page.
2. Click {button:Upload logo|outline|image-up} and choose the file. The button reads `Uploading…`.
3. You see `Logo updated.`, the logo appears in the row with its size, and the preview at the top shows it in place of the lettered square.
4. To see it on a document, open any invoice and click {button:PDF|outline}. See [An invoice's page](../accounting/invoice.md).

To swap it, click {button:Replace logo|outline|image-up} and choose the new file; the old one is removed. To go back to no logo, click {button:Remove|ghost|trash}; your browser asks `Remove the logo? Documents go back to the name on its own.` and you see `Logo removed.`

## How to set your name, tagline and colors

1. Type the name customers know you by in `Business name`, or leave it blank to use your business's name in Yosher.
2. Type a `Tagline` if you want one under the name.
3. For `Primary color`, click the swatch and pick a color, or type a hex value such as `#1f6f5f`. The preview at the top changes as you save, not as you type. A very pale color still colors the rules on the page, but the heading stays black so it can be read.
4. Set `Accent color` the same way if you already know your second color.
5. Click {button:Save|primary}. You see `Brand saved.` and the preview at the top updates.

## How to give a company its own look

1. In `Companies`, find the company and click {button:Give it its own look|outline}.
2. You see `[company] now has its own look. Fill in what should differ.` and the company gets a card of its own.
3. Fill in only what should be different for this company and click {button:Save|primary}. Anything you leave blank, including the logo, still comes from `Your brand`. The company's invoices carry its own look from the next PDF onward.

## How to go back to one look for every company

1. At the top right of the company's card, click {button:Use your brand instead|ghost}.
2. Your browser asks `Use your brand for [company]? Its own name, tagline, colors and logo are removed and its invoices carry your brand again.` Confirm.
3. You see `[company] uses your brand.` and the row reads `Uses your brand.` again.

## Messages

| Message | What it means |
| --- | --- |
| `Brand saved.` | The fields were saved. Invoices use them from now on. |
| `Logo updated.` | The logo was uploaded, checked and saved. |
| `Logo removed.` | There is no logo now. Documents show the name on its own. |
| `Choose a PNG or JPEG image.` | The file you picked is another type. Export the logo as a PNG or JPEG and try again. |
| `That file is over 2MB. Export the logo smaller and try again.` | The file is too big. A logo for documents does not need to be that large. |
| `That file isn't a PNG or JPEG image. Export the logo as one and try again.` | The file was named like an image but is not one. Yosher checks the file itself, not its name. |
| `That logo is over 2MB. Export it smaller and try again.` | The file arrived larger than allowed. |
| `The upload didn't finish. Try again.` | The file never reached storage. Check your connection and try again. |
| `A color needs to be a hex value like #1f6f5f, or left blank.` | One of the color boxes holds something that is not a color. Fix it or click {button:Clear|ghost}. |
| `Check the fields and try again.` | A field is over its length or the page is out of date. Reload and try again. |
| `That company no longer exists.` | The company was removed on Accounting's Companies page while this page was open. Reload. |
| `Only an owner can change how the business looks.` | You are signed in as staff. Ask an owner. |
| `Accountant access is read-only.` | You are signed in as the accountant. |
| `File storage isn't set up on this deployment yet.` | Uploads are not switched on for this installation of Yosher. Ask us. |
| `No logo yet` | Nothing has been uploaded. |
| `No tagline yet` | The tagline is blank. |
| `Default` | Under a swatch: no color chosen, so documents use black. |
| `Uses your brand.` | This company has no look of its own. |
| `Using your brand's logo.` | This company has its own look but no logo of its own, so the shared logo is used. |

## Not on this page

An SVG logo, or a logo Yosher draws for you from your name and colors. Fonts. Your website and your domain name. The logo in your email signature and on generated documents. Choosing a different logo for one invoice. Ask us if you need any of these; they are the next things this page grows.

## Who can do what

Owners can do everything here. Staff can open the page and see the kit, with the fields shown as text and the line `Only an owner can change these.`; they cannot upload, save or remove anything. Accountants see the same read-only view.
