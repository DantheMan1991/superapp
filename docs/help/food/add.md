# Adding a recipe

> Bring a recipe in from a link, text you pasted, or photos of a page, or type it in. You check what was read before anything is saved.
> **Route:** /personal/m/food/add
> **Order:** 10

Click {button:Add a recipe|food|plus} on Food's `Recipes`. Pick how the recipe comes in, fill in its box, and click {button:Read it|primary}. When it has been read, the editor opens on it so you can check it and save it. See [Typing in and editing a recipe](editor.md).

## What you see

- **`Add a recipe`**, the title, with the line `You check what is read before anything is saved.`
- **Four choices.** The one you picked has a coloured outline.
  - **From a link**, `A recipe page's address`.
  - **Paste the text**, `From a note, a message, a caption`.
  - **A photo of a page**, `A cookbook page or a recipe card`.
  - **Type it in**, `The editor, empty`. It opens the editor straight away, with nothing filled in.
- **The box for your choice**, under the four:
  - For a link: **Link**, showing `https://` until you paste, and the line `Copy the address of the recipe's page and paste it here.`
  - For text: **The recipe**, a large box for the paste, and a count such as `1,250 of 30,000 characters.`
  - For photos: **Photos**, the line `Up to 4, in order, when a recipe runs over pages. They are read and not kept.`, and {button:Choose photos|outline|camera}. Each photo you choose shows as a small picture with {button:×|ghost|x} in its corner to take it out again, and the button becomes {button:Add another|outline|camera} until you have four.
- **{button:Read it|primary}.** While it works it says `Reading…`, with the line `This can take up to a minute. You can leave: the draft will wait in your recipes.` If something stops it, the reason shows above the button in red.

## How a link is read

1. On the recipe's page, copy its address: from the address bar, or with Share and then Copy link on a phone.
2. Pick **From a link**, paste the address into **Link**, and click {button:Read it|primary}.
3. Most recipe sites put the recipe on the page twice: once for people, and once as data for search engines. When the page has that data, the recipe is read from it exactly, in a second or two, with the page's photo and the nutrition per serving if the page lists it.
4. When a page has no such data, Claude reads the page's words and takes the recipe out of them. That takes up to a minute, and you can leave meanwhile: the draft waits under **Drafts** in your recipes.
5. The editor opens on the recipe, marked `Read from` and the site's name.

Some sites check that a visitor is a person before they show the page, with a "Just a moment" page or a puzzle to solve. Yosher does not try to get past those. When a site does that, copy the recipe from the page yourself and use **Paste the text**.

## How pasted text is read

1. Copy the recipe from wherever it is: a message, a note, a video's description, a post's caption.
2. Pick **Paste the text**, paste it into **The recipe**, and click {button:Read it|primary}.
3. Claude takes the recipe out of what you pasted and leaves the rest. It takes up to a minute.

Up to 30,000 characters can be read at once, which is a long recipe with its story around it.

## How photos of a page are read

1. Pick **A photo of a page** and click {button:Choose photos|outline|camera}. On a phone you can take a photo or pick one you already have.
2. Photograph each page straight on, in good light, with the whole recipe in the picture. A recipe over two pages takes two photos; add them in order.
3. Click {button:Read it|primary}. Claude reads the photos in order and takes the recipe from them, handwriting too, as well as it can be read.

Each photo is made smaller on your phone and sent to be read, then dropped. It is not kept: not with the recipe, not anywhere in Yosher. The recipe's own photo, the one at the top of its page, is separate; add it in the editor.

## What is copied, and what is not

The recipe is copied in its own words. Each ingredient line is kept as written, with its amount, its unit and any note, and each step in order. Nothing is converted, rounded or worked out: an amount the recipe does not give stays out. The story before a recipe, the comments and the reviews are left behind. Nutrition is kept only when the recipe states it per serving.

Always check the draft against the original before you save it. A misread amount is easiest to catch there.

## Messages

| Message | What it means |
| --- | --- |
| `That doesn't look like a web address. Copy the page's address and paste it here.` | What is in **Link** is not a web address that starts with `https://` or `http://`, or it points at a private address no recipe lives at. Copy the address again from the page. |
| `That page could not be reached. Check the link, or copy the recipe and use Paste the text.` | The site did not answer, answered with an error such as "not found", took too long, or sent you round too many redirects. Check the address, or copy the recipe and paste it. |
| `That site would not let the app read it. Copy the recipe from the page and use Paste the text.` | The site checks that a visitor is a person, or refused Yosher outright. Copy the recipe yourself and use **Paste the text**. |
| `That link is not a web page. Copy the recipe and use Paste the text.` | The address leads to a file, such as a picture or a PDF, not a page. |
| `That page is too large to read. Copy the recipe and use Paste the text.` | The page is bigger than 3 MB of text. Copy just the recipe and paste it. |
| `No recipe was found there. Copy it and use Paste the text, or type it in.` | The page, the text or the photos were read, and no recipe was in them. |
| `Paste a recipe first.` | **The recipe** is empty, or has only a word or two in it. |
| `That is too long to read at once. Paste just the recipe.` | The paste is over 30,000 characters. |
| `Choose one to four photos of the recipe.` | No photo is chosen, or you chose more than four at once. Only the first four are kept. |
| `That photo could not be used. Try another one, a JPEG or PNG.` | The phone could not open one of the photos as a picture. Some phones save photos in a format a browser cannot read; take the photo again, or choose a JPEG. |
| `A recipe is already being read. Wait for it to finish, then try again.` | Claude reads one recipe at a time for you. A link whose page has its own recipe data is not held up by this. |
| `The recipe could not be read this time. Try again, or type it in.` | The reading went wrong for a reason that is not yours. Try again in a minute, or use another way in. |

## Who can do what

Only you. Food is in your personal space, which nobody else can open.
