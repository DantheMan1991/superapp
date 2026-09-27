# Importing a program

> Turn the PDF you were given into a program you can follow: it is read on your device, Claude drafts it, and you check the draft before anything is saved.
> **Route:** /personal/m/fitness/import
> **Order:** 10

Open **Workouts** and click {button:Import a program|primary|upload}. Choose the program's PDF. The page reads it, sends its words and links to be drafted, and opens the draft for you to check. Drafting takes about a minute.

## What you see

- **`Import a program`**, the title, with a line saying that nothing is saved until you have checked the draft.
- **`Choose the program PDF`.** Click it to pick the file from your device. Reading starts as soon as you choose one.
- **The file.** Once chosen, its name and size, and how many pages it has once it has been read.
- **`Reading page 12 of 59…`.** The page is reading the PDF on your device.
- **`Read 59 pages and 33 links`.** Reading is done. The links are the exercise videos and anything else the PDF links to.
- **`Drafting your program… about a minute (24s)`.** Claude is reading the words and links and putting the program together. The seconds count up so you can see it is working.
- **`You can leave this page. The draft will wait under Drafts on the Workouts page.`** Closing the page does not lose the draft.
- **The lock line**: `The file stays on your device. Only its words and links are sent, to draft the program.`
- **{button:Choose another file|outline}.** Starts again with a different PDF.
- **{button:Or build one by hand|ghost}.** Skips the import and opens an empty program instead.

## How to import a program

1. Click `Choose the program PDF` and pick the file.
2. Wait while it reads, then while it drafts. You see `Drafting your program… about a minute`.
3. The draft opens. Check it against the book, fix anything that is wrong, and click {button:Save program|primary}. See [Building and editing a program](editor.md).

## Messages

| Message | What it means |
| --- | --- |
| `This file could not be read as a PDF. Check it opens on your device, then choose it again.` | The file is not a PDF, or it is damaged. Open it on your device first, then choose it again. |
| `This PDF has 200 pages. That reads like a book rather than a program, so it cannot be drafted in one go. Build the program by hand instead.` | Programs up to 150 pages can be imported. Build this one by hand. |
| `This PDF has no words to read. It may be pictures of pages, which cannot be read yet. Build the program by hand instead.` | The PDF is scanned pictures, with no text in it. Build the program by hand. |
| `This PDF is too long to draft in one go. It reads like a book rather than a program. Build the program by hand, or import a shorter file.` | There is too much text to draft at once. |
| `A program is already being drafted. Give it a minute, then look under Drafts on the Workouts page.` | One import is still being drafted. Only one drafts at a time. |
| `No exercises could be found in this PDF. Build the program by hand instead.` | Claude read the PDF and found no exercises to put in a program. |
| `Claude would not draft this file. Build the program by hand instead.` | Claude declined to draft it. Build it by hand. |
| `The program was too long to draft in one go. Try a shorter file, or build it by hand.` | The draft ran out of room before it was finished. |
| `Claude did not return a program. Try again in a minute.` | Something went wrong while drafting. Choose the file again. |
| `The program could not be drafted. Try again in a minute.` | Something went wrong while drafting. Choose the file again. |
| `The draft was interrupted before it finished. Discard it and import the PDF again.` | Shown under Drafts on the Workouts page, and on the draft itself, when drafting stopped part way and never finished. Nothing from it was kept. Click {button:Discard draft|outline}, then import the PDF again. |
| `That file could not be read. Try choosing it again.` | What was read from the file could not be sent. Choose it again. |
| `The connection was lost while drafting. The draft may still arrive under Drafts on the Workouts page, so look there in a minute before trying again.` | This page stopped hearing back while Claude was reading, for example because the connection dropped. The draft may still finish. Look under Drafts on the Workouts page before you import the PDF again. |

## Not on this page

- **Keeping the PDF.** The file is never uploaded or stored. Keep your own copy.
- **Scanned PDFs.** A PDF made of pictures of pages cannot be read yet. Ask us if you need it.

## Who can do what

Only you. Imports live in your personal space.
