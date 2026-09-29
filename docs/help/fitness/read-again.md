# Reading the PDF again

> Add to a program you imported what the first read left out: the side self-assessment, and the exercises done on one side. You check what it finds before anything is saved, and your workouts stay with the program.
> **Route:** /personal/m/fitness/programs/*/read
> **Order:** 35

Open the program and click {button:Read the PDF again|outline|file-text}. Choose the PDF you imported it from. The page reads it on your device, Claude looks for the self-assessment and the exercises done on one side, and what it finds opens in the editor for you to check. It takes about a minute. Nothing changes until you click {button:Save program|primary}.

This is for a program imported before the app could read a self-assessment. Importing the PDF again would make a second program, with none of your workouts. Reading it again adds to the program you have.

## What you see

- **`Read the PDF again`**, the title, with a line naming the program, for example `Adds to Starter Mobility what the first read left out: the side self-assessment, and the exercises done on one side. Your workouts stay with the program.`
- **`Choose the program's PDF`**, with `The one this program was imported from.` Click it to pick the file from your device. Reading starts as soon as you choose one.
- **`Opening the PDF…`**, then **`Reading page 12 of 59…`.** The page is reading the PDF on your device.
- **`Read 59 pages`.** Reading is done. When a page shows a table as an image, such as the table of the self-assessment's tests, the line reads `Read 59 pages, and 1 page as a picture`: that page is sent as a picture too, so Claude can read the table.
- **`Finding the self-assessment and the one-sided exercises… about a minute (24s)`.** Claude is reading. The seconds count up so you can see it is working.
- **`Stay on this page: what it finds opens here, to check.`** What Claude finds is not kept anywhere else. If you leave, choose the PDF again.
- **The lock line**: `The file stays on your device. Only its words and links are sent, with a picture of any page that shows a table as an image.` Nothing of the file is kept.
- **{button:Back to the program|ghost}.** Goes back to the program without reading anything.
- **When something goes wrong**, the reason shows in red, with {button:Choose the PDF again|outline}. See [Messages](#messages).
- **What was found**, once Claude has read the PDF, in a box headed `Read from` and the file's name:
  - `A side self-assessment, with 5 tests.` when the PDF has one. It replaces any self-assessment the program already had.
  - `4 exercises done on one side, for someone who leans to a side.` Each of those exercises now has its side set. Exercises the PDF does not mention keep what they had.
  - `Nothing new was found: no self-assessment, and no exercise done on one side.` when the PDF has neither.
  - A line with {icon:triangle-alert} when the PDF names an exercise as done on one side that the program cannot take it on, for example `The PDF also names Heel slide as done on one side, which this program has no exercise to match. Set it by hand below if it is one of yours.` It names an exercise the program does not have, one it has in two places with no phase to tell them apart, or one without `Per side` ticked.
  - `Check them below: the self-assessment comes before the phases, and a one-sided exercise shows its side when you open it. Nothing is saved until you press Save program. Your workouts stay with the program.`
- **The editor**, under the box, with the program as it would be saved: everything it had, plus what was found. Every field works as it does when you edit the program. See [Building and editing a program](editor.md).

## How to add the self-assessment from your PDF

1. Open the program and click {button:Read the PDF again|outline|file-text}.
2. Click `Choose the program's PDF` and pick the file you imported the program from.
3. Wait while it reads, then while Claude looks. It takes about a minute.
4. Read the box above the editor. Then check `Side self-assessment` against the program's table: each test's name, which way it counts, and `Tests that must agree`.
5. Open each exercise the box counted, and check `Side, once yours is known` and `That side is` against the book.
6. Set any exercise the warning names by hand, if it is one of yours.
7. Click {button:Save program|primary}. You see `Program saved` and the program opens. Each one-sided exercise shows its side there.

To leave the program as it was, click {button:Cancel|ghost} instead. Nothing was saved.

## Messages

| Message | What it means |
| --- | --- |
| `This file could not be read as a PDF. Check it opens on your device, then choose it again.` | The file is not a PDF, or it is damaged. Open it on your device first, then choose it again. |
| `This PDF has 200 pages. That reads like a book rather than a program, so it cannot be read in one go.` | Programs up to 150 pages can be read. Choose the program's own PDF. |
| `This PDF has no words to read. It may be pictures of pages, which cannot be read yet. Nothing was changed.` | The PDF is scanned pictures, with no text in it. Add the self-assessment by hand in the editor. |
| `This PDF is too long to read in one go. It reads like a book rather than a program. Nothing was changed.` | There is too much text to read at once. Choose the program's own PDF. |
| `Claude would not read this file. Nothing was changed.` | Claude declined to read it. Add the self-assessment by hand in the editor. |
| `There was too much in this PDF to read in one go. Nothing was changed.` | Claude ran out of room before it finished. |
| `Claude did not answer with what it found. Nothing was changed. Try again in a minute.` | Something went wrong while reading. Choose the PDF again. |
| `The PDF could not be read again. Nothing was changed. Try again in a minute.` | Something went wrong while reading. Choose the PDF again. |
| `That file could not be read. Try choosing it again.` | What was read from the file could not be sent. Choose it again. |
| `The connection was lost while reading. Nothing was changed. Choose the PDF again to try again.` | This page stopped hearing back while Claude was reading, for example because the connection dropped. Choose the PDF again. |
| `That program is not here any more. It may have been deleted.` | The program was deleted after you opened this page. |
| `This program changed since you opened it. Reload the page to see the latest, then make your change again.` | Shown when you save, if the program was changed somewhere else, for example in another tab, while this page was open. Reload, and read the PDF again. |

## Not on this page

- **Reading anything else again.** Only the self-assessment and the exercises done on one side are read. To change sets, counts or videos, click {button:Edit program|outline|pencil} on the program.
- **Taking the self-assessment.** Not built yet. Until it is, a session has you do every exercise on both sides.
- **Keeping the PDF.** The file is never uploaded or stored. Keep your own copy.

## Who can do what

Only you. Programs live in your personal space.
